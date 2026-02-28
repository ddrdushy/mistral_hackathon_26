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
from datetime import datetime
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
from models import Email, Candidate, Job, Application, Event
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
    open_jobs = db.query(Job).filter(Job.status == "open").all()
    if not open_jobs:
        result["steps"].append({"step": "match", "message": "No open jobs to match against"})
        return result

    # Find best matching job(s) based on detected role from classification
    classification = json.loads(em.classification) if em.classification else {}
    detected_role = classification.get("detected_role", "").lower()

    matched_jobs = _find_matching_jobs(open_jobs, detected_role, candidate.resume_text)
    if not matched_jobs:
        # Default: match to all open jobs
        matched_jobs = open_jobs[:3]  # Limit to top 3

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

        # Score resume
        skills = json.loads(job.skills) if job.skills else []
        scorer_input = ResumeScorerInput(
            resume_text=candidate.resume_text,
            job_id=job.job_id,
            job_title=job.title,
            job_description=job.description,
            must_have_skills=skills,
            nice_to_have_skills=[],
            seniority=job.seniority,
        )
        score_result = await score_resume(scorer_input)

        application = Application(
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
        )
        db.add(application)
        db.commit()
        db.refresh(application)

        # Log event
        event = Event(
            app_id=application.id,
            event_type="auto_workflow_matched",
            payload=json.dumps({
                "resume_score": score_result.score,
                "recommendation": score_result.recommendation,
                "trigger": "email_auto_workflow",
            }),
        )
        db.add(event)
        db.commit()

        result["applications"].append({
            "app_id": application.id,
            "job_id": job.id,
            "job_title": job.title,
            "resume_score": score_result.score,
            "recommendation": score_result.recommendation,
        })
        logger.info(
            f"Matched candidate {candidate.name} → {job.title} "
            f"(score: {score_result.score}, rec: {score_result.recommendation})"
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


def _create_candidate_from_email(em: Email, db: Session) -> Candidate:
    """Create a candidate record from a classified email."""
    classification = json.loads(em.classification) if em.classification else {}
    detected_name = classification.get("detected_name", "")

    body_text = em.body_full or em.body_snippet
    contact = parse_contact_info(body_text)

    name = (
        detected_name
        or contact.get("name", "")
        or em.from_name
        or em.from_address.split("@")[0].replace(".", " ").title()
    )
    candidate_email = contact.get("email", "") or em.from_address
    phone = contact.get("phone", "")

    resume_text = ""
    resume_filename = ""
    attachments = json.loads(em.attachments) if em.attachments else []
    for att in attachments:
        filename = att.get("filename", "")
        if filename.lower().endswith(('.pdf', '.docx', '.doc', '.txt')):
            resume_filename = filename
            resume_text = body_text
            break

    candidate = Candidate(
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

    return candidate


def _find_matching_jobs(jobs: List[Job], detected_role: str, resume_text: str) -> List[Job]:
    """Find jobs that best match the candidate's detected role and resume."""
    if not detected_role and not resume_text:
        return []

    scored = []
    search_text = f"{detected_role} {resume_text}".lower()

    for job in jobs:
        score = 0
        title_lower = job.title.lower()

        # Title similarity
        for word in detected_role.split():
            if word in title_lower:
                score += 10

        # Skills match
        skills = json.loads(job.skills) if job.skills else []
        for skill in skills:
            if skill.lower() in search_text:
                score += 5

        # Department keyword match
        if job.department.lower() in search_text:
            score += 3

        if score > 0:
            scored.append((score, job))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [job for _, job in scored[:3]]
