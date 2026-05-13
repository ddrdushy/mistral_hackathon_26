"""
Auto-Workflow Pipeline
When a new email arrives:
  1. Classify it (email_classifier agent)
  2. If candidate_application → Create candidate from email
  3. Auto-match to best job → Score resume
  4. Log all events
"""
import json
import logging
import base64
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
import os
import uuid
from database import SessionLocal
from models import Email, Candidate, Job, Application, Event, InterviewLink, ResumeFraudSignal
from agents.email_classifier import classify_email, EmailClassifierInput
from agents.resume_scorer import score_resume, ResumeScorerInput
from services.resume_service import parse_contact_info

logger = logging.getLogger("hireops.workflow")


async def run_email_workflow(email_id: int, db: Session) -> Dict:
    """Run the full auto-workflow for a single email."""
    em = db.query(Email).filter(Email.id == email_id).first()
    if not em:
        return {"status": "error", "message": "Email not found"}

    result = {
        "email_id": email_id,
        "steps": [],
        "candidate_id": None,
        "applications": [],
    }

    # ─── Step 1: Classify ───
    if em.classified_as is None:
        attachments = json.loads(em.attachments) if em.attachments else []
        attachment_names = [a.get("filename", "") for a in attachments]

        input_data = EmailClassifierInput(
            subject=em.subject,
            from_name=em.from_name,
            from_email=em.from_address,
            attachment_names=attachment_names,
            body_text=em.body_snippet,
        )
        output = await classify_email(input_data)

        em.classified_as = output.category
        em.confidence = output.confidence
        em.classification = json.dumps({
            "category": output.category,
            "confidence": output.confidence,
            "reasoning": output.reasoning,
            "suggested_action": output.suggested_action,
            "detected_name": output.detected_name,
            "detected_role": output.detected_role,
        })
        em.processed = 1
        db.commit()

        result["steps"].append({
            "step": "classify",
            "category": output.category,
            "confidence": output.confidence,
        })
        logger.info(f"Email {email_id} classified as {output.category} ({output.confidence:.0%})")
    else:
        result["steps"].append({
            "step": "classify",
            "category": em.classified_as,
            "confidence": em.confidence,
            "skipped": True,
        })

    # ─── Step 2: If not a candidate application, stop ───
    if em.classified_as != "candidate_application":
        result["steps"].append({"step": "skip", "reason": f"Not a candidate application ({em.classified_as})"})
        return result

    # ─── Step 3: Create Candidate ───
    candidate = None
    if em.processed < 2:
        candidate = _create_candidate_from_email(em, db)
        result["candidate_id"] = candidate.id
        result["steps"].append({
            "step": "create_candidate",
            "candidate_id": candidate.id,
            "candidate_name": candidate.name,
        })
        logger.info(f"Created candidate {candidate.id}: {candidate.name}")
    else:
        # Find existing candidate from this email
        candidate = db.query(Candidate).filter(Candidate.source_email_id == em.id).first()
        if candidate:
            result["candidate_id"] = candidate.id
            result["steps"].append({
                "step": "create_candidate",
                "candidate_id": candidate.id,
                "skipped": True,
            })

    if not candidate:
        result["steps"].append({"step": "error", "message": "Could not create candidate"})
        return result

    # ─── Step 4: Match to jobs + Score ───
    # Tenant-scope the lookup. Without this we'd match the email's candidate
    # against another tenant's open jobs and silently create cross-tenant
    # Applications that the dashboard can't see.
    # Respect expires_at: a job past its expiry is treated as closed so
    # the auto-pipeline doesn't keep matching candidates into a slot
    # that's no longer hiring. Jobs without an expiry behave as before.
    now = datetime.utcnow()
    job_query = (
        db.query(Job)
        .filter(Job.status == "open")
        .filter((Job.expires_at == None) | (Job.expires_at > now))  # noqa: E711
    )
    if em.tenant_id is not None:
        job_query = job_query.filter(Job.tenant_id == em.tenant_id)
    open_jobs = job_query.all()
    if not open_jobs:
        result["steps"].append({"step": "match", "message": "No open jobs to match against"})
        return result

    # Find best matching job(s) based on detected role from classification
    classification = json.loads(em.classification) if em.classification else {}
    detected_role = classification.get("detected_role", "").lower()

    best_job = _find_best_matching_job(open_jobs, detected_role, candidate.resume_text)
    if not best_job:
        # Default: pick the first open job as fallback
        best_job = open_jobs[0]

    matched_jobs = [best_job]

    for job in matched_jobs:
        # Check if application already exists
        existing = db.query(Application).filter(
            Application.candidate_id == candidate.id,
            Application.job_id == job.id,
        ).first()
        if existing:
            result["applications"].append({
                "job_id": job.id,
                "job_title": job.title,
                "skipped": True,
            })
            continue

        # Fraud detection (Feature 1) — runs on the email's CV attachment
        # bytes BEFORE scoring. Critical signals (white-on-white text,
        # prompt injection telling the LLM to score 100) skip the scorer
        # entirely so we don't reward adversarial CVs.
        fraud_signals, fraud_score, fraud_blocked = _check_resume_fraud(em)

        # Score resume — pass full job context including responsibilities.
        # Gate by plan: trial tenants have only the email_classifier; the
        # auto-pipeline still creates the candidate but skips the LLM
        # scorer and stamps the application with a "upgrade_required"
        # recommendation so HR sees a clear CTA instead of a 0/100 score.
        from billing.plans import is_agent_allowed
        from models import Tenant as _Tenant
        skills = json.loads(job.skills) if job.skills else []
        responsibilities = json.loads(job.responsibilities) if job.responsibilities else []
        tenant_row = db.query(_Tenant).filter(_Tenant.id == em.tenant_id).first() if em.tenant_id else None
        scorer_allowed = is_agent_allowed(tenant_row, "resume_scorer") if tenant_row else True
        if fraud_blocked or not scorer_allowed:
            score_result = None
        else:
            scorer_input = ResumeScorerInput(
                resume_text=candidate.resume_text,
                job_id=job.job_id,
                job_title=job.title,
                job_description=job.description,
                must_have_skills=skills,
                nice_to_have_skills=[],
                seniority=job.seniority,
                responsibilities=responsibilities,
            )
            score_result = await score_resume(scorer_input)

        if fraud_blocked:
            # Blocked path — no LLM call, application visible to HR with the
            # fraud banner so they can review the evidence before overriding.
            application = Application(
                tenant_id=em.tenant_id,
                candidate_id=candidate.id,
                job_id=job.id,
                stage="matched",
                resume_score=0,
                resume_score_json=json.dumps({
                    "score": 0,
                    "summary": "Scoring blocked — resume contains adversarial content",
                    "blocked_reason": "fraud_detected",
                }),
                recommendation="hold",
                ai_next_action="Review fraud signals before scoring or rejecting",
                ai_snippets=json.dumps({}),
                fraud_score=fraud_score,
                fraud_flags_count=len(fraud_signals),
                fraud_blocked=True,
            )
        elif score_result is None:
            # Trial-plan path — email_classifier ran (so the email made it
            # this far), but resume_scorer is locked. Create the
            # application with a soft hold + an "upgrade to score" CTA.
            application = Application(
                tenant_id=em.tenant_id,
                candidate_id=candidate.id,
                job_id=job.id,
                stage="matched",
                resume_score=0,
                resume_score_json=json.dumps({
                    "score": 0,
                    "summary": "Resume scoring requires an upgrade",
                    "blocked_reason": "agent_locked_by_plan",
                }),
                recommendation="hold",
                ai_next_action="Upgrade your plan to unlock AI resume scoring",
                ai_snippets=json.dumps({}),
            )
        else:
            application = Application(
                tenant_id=em.tenant_id,
                candidate_id=candidate.id,
                job_id=job.id,
                stage="matched",
                resume_score=score_result.score,
                resume_score_json=json.dumps({
                    "score": score_result.score,
                    "evidence": score_result.evidence,
                    "gaps": score_result.gaps,
                    "risks": score_result.risks,
                    "recommendation": score_result.recommendation,
                    "screening_questions": score_result.screening_questions,
                    "summary": score_result.summary,
                }),
                recommendation=score_result.recommendation,
                ai_next_action=(
                    "Schedule voice screening" if score_result.recommendation == "advance"
                    else "Review manually" if score_result.recommendation == "hold"
                    else "Send rejection email"
                ),
                ai_snippets=json.dumps({
                    "why_shortlisted": score_result.why_shortlisted,
                    "key_strengths": score_result.key_strengths,
                    "main_gaps": score_result.main_gaps,
                    "interview_focus": score_result.interview_focus,
                }),
                fraud_score=fraud_score,
                fraud_flags_count=len(fraud_signals),
                fraud_blocked=False,
            )
        db.add(application)
        db.commit()
        db.refresh(application)

        # Persist fraud signal rows (now that we have application.id) and
        # write an audit entry per blocked app so the tenant audit trail
        # captures it.
        if fraud_signals:
            for sig in fraud_signals:
                db.add(ResumeFraudSignal(
                    tenant_id=em.tenant_id,
                    application_id=application.id,
                    candidate_id=candidate.id,
                    signal_type=sig.signal_type,
                    severity=sig.severity,
                    evidence_json=json.dumps(sig.evidence, default=str),
                ))
            db.commit()
            try:
                from services.audit import write_audit
                write_audit(
                    db,
                    action="fraud.detected" if not fraud_blocked else "fraud.blocked",
                    actor=None,
                    tenant_id=em.tenant_id,
                    resource_type="application",
                    resource_id=application.id,
                    payload={
                        "fraud_score": fraud_score,
                        "flags": len(fraud_signals),
                        "blocked": fraud_blocked,
                        "signal_types": sorted({s.signal_type for s in fraud_signals}),
                    },
                    severity="critical" if fraud_blocked else "warning",
                )
            except Exception:
                pass

        # Log event
        event = Event(
            tenant_id=em.tenant_id,
            app_id=application.id,
            event_type="auto_workflow_matched" if not fraud_blocked else "auto_workflow_fraud_blocked",
            payload=json.dumps({
                "resume_score": score_result.score if score_result else 0,
                "recommendation": score_result.recommendation if score_result else "hold",
                "fraud_score": fraud_score,
                "fraud_blocked": fraud_blocked,
                "trigger": "email_auto_workflow",
            }),
        )
        db.add(event)
        db.commit()

        # AUTO-INTERVIEW: If recommendation is "advance", auto-generate interview link
        # (Skipped when fraud_blocked OR when the tenant's plan doesn't
        # include the relevant interview agent — they need an upgrade
        # before voice/Q&A interviews can run.)
        from billing.plans import is_agent_allowed as _is_allowed
        _interview_mode = (job.interview_mode or "voice")
        _interview_agent = "qa_interview_generate" if _interview_mode == "qa" else "voice_screener"
        _interview_allowed = _is_allowed(tenant_row, _interview_agent) if tenant_row else True
        interview_url = None
        if not fraud_blocked and score_result and score_result.recommendation == "advance" and _interview_allowed:
            token = uuid.uuid4().hex
            link = InterviewLink(
                tenant_id=em.tenant_id,
                token=token,
                app_id=application.id,
                status="generated",
                expires_at=datetime.utcnow() + timedelta(hours=72),
            )
            db.add(link)

            base_url = os.getenv("FRONTEND_URL", "").rstrip("/")
            interview_url = f"{base_url}/interview/{token}"

            application.interview_link_status = "generated"
            application.stage = "screening_scheduled"
            application.screening_status = "link_generated"
            application.ai_next_action = f"Interview link auto-generated — ready to send to {candidate.name}"

            auto_event = Event(
                tenant_id=em.tenant_id,
                app_id=application.id,
                event_type="auto_interview_link_generated",
                payload=json.dumps({
                    "token": token,
                    "interview_url": interview_url,
                    "candidate_email": candidate.email,
                    "trigger": "auto_advance",
                }),
            )
            db.add(auto_event)
            db.commit()
            db.refresh(link)

            logger.info(f"Auto-generated interview link for {candidate.name}: {interview_url}")

            # AUTO-SEND: Email the interview link to the candidate
            try:
                from services.smtp_service import send_interview_link_email
                company = os.getenv("COMPANY_NAME", "HireOps AI")
                email_result = send_interview_link_email(
                    to_email=candidate.email,
                    candidate_name=candidate.name.split()[0],
                    job_title=job.title,
                    company_name=company,
                    interview_url=interview_url,
                )
                if email_result["success"]:
                    link.status = "sent"
                    application.interview_link_status = "sent"
                    application.ai_next_action = f"Interview link emailed to {candidate.email} — waiting for candidate"
                    send_event = Event(
                        tenant_id=em.tenant_id,
                        app_id=application.id,
                        event_type="auto_interview_link_emailed",
                        payload=json.dumps({
                            "to_email": candidate.email,
                            "interview_url": interview_url,
                        }),
                    )
                    db.add(send_event)
                    db.commit()
                    logger.info(f"Auto-emailed interview link to {candidate.email}")
                else:
                    logger.warning(f"Failed to email interview link: {email_result['message']}")
            except Exception as e:
                logger.warning(f"Auto-email failed (link still generated): {e}")

        result["applications"].append({
            "app_id": application.id,
            "job_id": job.id,
            "job_title": job.title,
            "resume_score": score_result.score if score_result else 0,
            "recommendation": score_result.recommendation if score_result else "hold",
            "fraud_score": fraud_score,
            "fraud_blocked": fraud_blocked,
            "interview_url": interview_url,
        })
        if score_result:
            logger.info(
                f"Matched candidate {candidate.name} → {job.title} "
                f"(score: {score_result.score}, rec: {score_result.recommendation})"
            )
        else:
            logger.warning(
                f"Fraud-blocked candidate {candidate.name} → {job.title} "
                f"(fraud_score: {fraud_score}, flags: {len(fraud_signals)})"
            )

    result["steps"].append({
        "step": "match_and_score",
        "matched_count": len(result["applications"]),
    })

    return result


async def run_workflow_for_new_emails(db: Session) -> List[Dict]:
    """Run auto-workflow for all unprocessed emails."""
    unprocessed = db.query(Email).filter(
        Email.processed == 0
    ).order_by(Email.received_at.desc()).all()

    results = []
    for em in unprocessed:
        try:
            result = await run_email_workflow(em.id, db)
            results.append(result)
        except Exception as e:
            logger.error(f"Workflow failed for email {em.id}: {e}")
            results.append({
                "email_id": em.id,
                "status": "error",
                "message": str(e),
            })

    return results


def _check_resume_fraud(em: Email):
    """Run the fraud detector against the email's CV attachment bytes.

    Returns (signals, fraud_score, fraud_blocked). Empty / unblockable
    when the email has no parsable attachment — caller treats that as
    'no fraud signal' rather than a missing check.
    """
    try:
        from services.fraud_detector import detect_fraud, compute_fraud_score
    except Exception as e:
        logger.warning("fraud_detector import failed: %s", e)
        return [], 0, False

    attachments = json.loads(em.attachments) if em.attachments else []
    for att in attachments:
        filename = att.get("filename", "")
        content_b64 = att.get("content_b64", "")
        if not content_b64:
            continue
        if not filename.lower().endswith(('.pdf', '.docx', '.doc', '.txt', '.tex')):
            continue
        try:
            file_bytes = base64.b64decode(content_b64)
        except Exception:
            continue
        try:
            signals = detect_fraud(filename, file_bytes)
        except Exception as e:
            logger.warning("fraud detection failed for %s: %s", filename, e)
            return [], 0, False
        score = compute_fraud_score(signals)
        blocked = any(s.severity == "critical" for s in signals)
        return signals, score, blocked

    return [], 0, False


def _pick_candidate_email(
    *,
    cv_contact: dict,
    body_contact: dict,
    sender_email: str,
    recipient_email: str,
    email_id: int,
) -> str:
    """Choose the candidate's email address from CV + body, never the
    recruiter's own.

    When a recruiter forwards a CV, both `sender_email` and
    `recipient_email` end up being their own mailbox (or a colleague's).
    Picking either would alias every forwarded CV onto the same
    candidate row via the unique (tenant_id, email) index, which is
    exactly the "3 CVs collapsed into 1 with cv_version=3" bug HR hit.

    Rules:
      1. CV-extracted email wins if it's not the sender/recipient.
      2. Otherwise body-extracted email if it's not the sender/recipient.
      3. Otherwise a placeholder unique per email_id so each forwarded
         CV becomes its own candidate. The placeholder uses
         `forwarded+{email_id}@uploaded.local`, matching the bulk-upload
         pattern downstream consumers already handle.
    """
    blocked = {
        (sender_email or "").strip().lower(),
        (recipient_email or "").strip().lower(),
        "",  # excludes None / empty matches
    }

    def _ok(addr: str) -> bool:
        a = (addr or "").strip().lower()
        return a not in blocked

    cv_email = (cv_contact.get("email") or "").strip()
    if _ok(cv_email):
        return cv_email

    body_email = (body_contact.get("email") or "").strip()
    if _ok(body_email):
        return body_email

    return f"forwarded+{email_id}@uploaded.local"


def _create_candidate_from_email(em: Email, db: Session) -> Candidate:
    """Create a candidate record from a classified email."""
    classification = json.loads(em.classification) if em.classification else {}
    detected_name = classification.get("detected_name", "")

    body_text = em.body_full or em.body_snippet

    # Extract the CV attachment BEFORE picking a candidate email so we can
    # parse the resume's contact section first. Email forwarding stuffs
    # the inbox owner's address into the visible body (the "To:"
    # forwarded-header line), which means parsing only the body picks up
    # the recruiter's email instead of the candidate's — every forwarded
    # CV then collapses onto the same candidate row via the unique
    # (tenant, email) index. Parsing the CV text avoids that.
    cv_text = ""
    resume_filename = ""
    attachments = json.loads(em.attachments) if em.attachments else []
    for att in attachments:
        filename = att.get("filename", "")
        if filename.lower().endswith(('.pdf', '.docx', '.doc', '.txt', '.tex')):
            resume_filename = filename
            content_b64 = att.get("content_b64", "")
            if content_b64:
                try:
                    from services.resume_service import extract_resume_text
                    file_bytes = base64.b64decode(content_b64)
                    cv_text = extract_resume_text(filename, file_bytes=file_bytes)
                    logger.info(f"Extracted {len(cv_text)} chars from attachment: {filename}")
                except Exception as e:
                    logger.warning(f"Failed to extract text from {filename}: {e}")
            break

    # Try CV first, fall back to email body. _pick_candidate_email filters
    # out the sender's / recipient's own address so a forwarded CV doesn't
    # alias onto the recruiter.
    cv_contact = parse_contact_info(cv_text) if cv_text else {}
    body_contact = parse_contact_info(body_text) if body_text else {}
    candidate_email = _pick_candidate_email(
        cv_contact=cv_contact,
        body_contact=body_contact,
        sender_email=em.from_address,
        recipient_email=getattr(em, "to_address", "") or "",
        email_id=em.id,
    )

    # Pick the candidate's name. Crucially we DROP `em.from_name` and the
    # email-address local-part as fallbacks: when a recruiter forwards a
    # CV from their own inbox the sender is the recruiter, not the
    # candidate, and we'd end up labelling someone else's CV with the
    # recruiter's name. If we can't find the name in the CV/body or via
    # the classifier, fall back to the CV filename (minus extension) so
    # the row is still usable and HR can rename in the UI.
    name = (
        detected_name
        or cv_contact.get("name", "")
        or body_contact.get("name", "")
        or ((resume_filename or "").rsplit(".", 1)[0].replace("_", " ").strip())
        or "Unnamed candidate"
    )
    phone = cv_contact.get("phone", "") or body_contact.get("phone", "")

    parts = []
    body_clean = (body_text or "").strip()
    if body_clean:
        parts.append(f"--- Email body ---\n{body_clean}")
    cv_clean = (cv_text or "").strip()
    if cv_clean:
        parts.append(f"--- CV ({resume_filename}) ---\n{cv_clean}")
    resume_text = "\n\n".join(parts)
    if not resume_text:
        # No body, no extractable CV — fall back to whatever we have so the
        # scorer at least sees the from-address / subject context.
        resume_text = em.subject or em.from_address or ""

    # Strict same-person dedup. Re-uploaded CV from the same human
    # (name + email/phone match) bumps cv_version; otherwise create a
    # fresh row even when the email happens to be the recruiter's
    # placeholder forwarded+N@uploaded.local.
    from routers.candidates import _find_same_person, _archive_current_cv

    existing = _find_same_person(
        db, em.tenant_id, name=name, email=candidate_email, phone=phone,
    )
    if existing:
        _archive_current_cv(db, existing, source="email_forward", user_id=None)
        existing.resume_text = resume_text
        existing.resume_filename = resume_filename
        existing.cv_version = (existing.cv_version or 1) + 1
        if phone and not existing.phone:
            existing.phone = phone
        existing.source_email_id = em.id
        existing.profile_extracted_at = None  # re-extract tags on new CV
        existing.updated_at = datetime.utcnow()
        em.processed = 2
        db.commit()
        db.refresh(existing)
        candidate = existing
    else:
        candidate = Candidate(
            tenant_id=em.tenant_id,
            name=name,
            email=candidate_email,
            phone=phone,
            resume_text=resume_text,
            resume_filename=resume_filename,
            source_email_id=em.id,
        )
        db.add(candidate)
        em.processed = 2
        db.commit()
        db.refresh(candidate)

    # Talent-bank: extract a structured profile so this candidate is
    # searchable for FUTURE jobs without re-calling the LLM. Fire-and-forget
    # so the workflow doesn't block on a second LLM call. The suggested-
    # candidates endpoint also lazy-fills, so a missed schedule isn't fatal.
    try:
        import asyncio as _asyncio
        loop = _asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_async_apply_profile(candidate.id))
    except Exception as e:
        logger.warning("Profile extraction kickoff failed for %s: %s", candidate.id, e)

    return candidate


def _apply_profile(db: Session, candidate: Candidate, prof) -> None:
    candidate.profile_skills = json.dumps(prof.skills)
    candidate.profile_role = prof.role
    candidate.profile_seniority = prof.seniority
    candidate.profile_years_experience = prof.years_experience
    candidate.profile_summary = prof.summary
    candidate.profile_key_points = json.dumps(getattr(prof, "key_points", []))
    candidate.profile_extracted_at = datetime.utcnow()
    db.commit()


async def _async_apply_profile(candidate_id: int) -> None:
    """Background fire-and-forget profile extraction for a freshly-created
    candidate. Opens its own DB session because the caller's session likely
    closed by the time this runs.

    Skipped silently when the candidate's tenant plan doesn't include the
    profile_extractor agent — talent-bank tagging is a paid feature.
    """
    from agents.profile_extractor import extract_profile
    from billing.plans import is_agent_allowed
    from models import Tenant as _Tenant
    db = SessionLocal()
    try:
        cand = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not cand or cand.profile_extracted_at is not None:
            return
        if cand.tenant_id:
            tenant_row = db.query(_Tenant).filter(_Tenant.id == cand.tenant_id).first()
            if tenant_row and not is_agent_allowed(tenant_row, "profile_extractor"):
                return
        prof = await extract_profile(cand.resume_text or "")
        _apply_profile(db, cand, prof)
        logger.info("Profiled candidate %s: %d skills, role=%s",
                    candidate_id, len(prof.skills), prof.role)
    except Exception as e:
        logger.warning("Async profile extraction failed for %s: %s", candidate_id, e)
    finally:
        db.close()


def _find_best_matching_job(jobs: List[Job], detected_role: str, resume_text: str) -> Optional[Job]:
    """Find the single best matching job for this candidate."""
    if not detected_role and not resume_text:
        return None

    scored = []
    search_text = f"{detected_role} {resume_text}".lower()

    for job in jobs:
        score = 0
        title_lower = job.title.lower()

        # Title similarity — strong signal
        for word in detected_role.split():
            if len(word) > 2 and word in title_lower:
                score += 10

        # Skills match
        skills = json.loads(job.skills) if job.skills else []
        for skill in skills:
            if skill.lower() in search_text:
                score += 5

        # Department keyword match
        if job.department and job.department.lower() in search_text:
            score += 3

        if score > 0:
            scored.append((score, job))

    if not scored:
        return None

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_job = scored[0]
    logger.info(f"Best job match: {best_job.title} (score={best_score})")
    return best_job
