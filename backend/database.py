import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./hireops.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    echo=False,
)

# Enable WAL mode and foreign keys for SQLite
if "sqlite" in DATABASE_URL:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import (  # noqa: F401
        Job, Email, Candidate, CandidateCvVersion, Application, Event, InterviewLink, Setting, QaSession,
        Tenant, User, EmailVerification, PasswordReset, TenantInvite, LlmUsage,
        AuditLog, Testimonial, MailAccount, JobBoardAccount, TenantIntegration, Communication,
        CallQueue, ResumeFraudSignal, Tag, CandidateTag, JobInterviewQuestion,
        OfferTemplate, Offer, OfferApproval, TenantESignConfig,
        OutreachSequence, OutreachStep, OutreachEnrollment, OutreachMessage,
        PipelineTemplate, PipelineStage, ApplicationStageTransition,
        PipelineForecast,
        ExternalIntegration, ExternalIdMapping, IntegrationSyncLog,
        SupportTicket, TenantFeedback,
        JobBoardConnection, JobBoardPosting,
    )
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    _backfill_demo_tenant()
    _apply_superadmin_emails()
    _seed_default_testimonials()
    _seed_default_pipeline_templates()


def _run_migrations():
    """Add missing columns to existing tables (safe to run multiple times)."""
    from sqlalchemy import text, inspect as sa_inspect
    insp = sa_inspect(engine)

    new_cols = {
        "scheduled_interview_at": "TIMESTAMP",
        "scheduled_interview_slot": "VARCHAR",
        "email_draft_sent": "INTEGER DEFAULT 0",
        "final_score": "FLOAT",
        "final_summary": "TEXT",
    }

    if "applications" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("applications")}
        with engine.begin() as conn:
            for col_name, col_type in new_cols.items():
                if col_name not in existing:
                    try:
                        conn.execute(text(
                            f"ALTER TABLE applications ADD COLUMN {col_name} {col_type}"
                        ))
                    except Exception:
                        pass

    # InterviewLink columns
    link_cols = {
        "round": "INTEGER DEFAULT 1",
        "scheduled_at": "TIMESTAMP",
    }
    if "interview_links" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("interview_links")}
        with engine.begin() as conn:
            for col_name, col_type in link_cols.items():
                if col_name not in existing:
                    try:
                        conn.execute(text(
                            f"ALTER TABLE interview_links ADD COLUMN {col_name} {col_type}"
                        ))
                    except Exception:
                        pass

    # Job threshold + interview_mode columns
    job_cols = {
        "resume_threshold_min": "FLOAT DEFAULT 80.0",
        "interview_threshold_min": "FLOAT DEFAULT 75.0",
        "final_threshold_reject": "FLOAT DEFAULT 50.0",
        "interview_mode": "VARCHAR DEFAULT 'voice'",
    }
    if "jobs" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("jobs")}
        with engine.begin() as conn:
            for col_name, col_type in job_cols.items():
                if col_name not in existing:
                    try:
                        conn.execute(text(
                            f"ALTER TABLE jobs ADD COLUMN {col_name} {col_type}"
                        ))
                    except Exception:
                        pass

    # QaSession new columns (signals + fraud_risk_score)
    qa_cols = {
        "signals_json": "TEXT DEFAULT '{}'",
        "fraud_risk_score": "FLOAT",
    }
    if "qa_sessions" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("qa_sessions")}
        with engine.begin() as conn:
            for col_name, col_type in qa_cols.items():
                if col_name not in existing:
                    try:
                        conn.execute(text(
                            f"ALTER TABLE qa_sessions ADD COLUMN {col_name} {col_type}"
                        ))
                    except Exception:
                        pass

    # MailAccount listener_enabled — added in the auto-pickup work. Defaults
    # to true so existing rows continue to behave as before.
    if "mail_accounts" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("mail_accounts")}
        if "listener_enabled" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text(
                        "ALTER TABLE mail_accounts ADD COLUMN listener_enabled BOOLEAN NOT NULL DEFAULT TRUE"
                    ))
                except Exception:
                    pass

    # Multi-tenancy: add tenant_id to every tenant-scoped table
    tenant_scoped_tables = [
        "jobs", "emails", "candidates", "applications", "events",
        "interview_links", "qa_sessions", "settings",
    ]
    for tbl in tenant_scoped_tables:
        if tbl not in insp.get_table_names():
            continue
        cols = {c["name"] for c in insp.get_columns(tbl)}
        if "tenant_id" in cols:
            continue
        with engine.begin() as conn:
            try:
                conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN tenant_id INTEGER"))
            except Exception:
                pass

    # Phase 6 super-admin: soft-delete column on tenants
    if "tenants" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("tenants")}
        if "deleted_at" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text("ALTER TABLE tenants ADD COLUMN deleted_at TIMESTAMP"))
                except Exception:
                    pass
        if "agent_overrides_json" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text(
                        "ALTER TABLE tenants ADD COLUMN agent_overrides_json TEXT "
                        "DEFAULT '{\"add\": [], \"remove\": []}'"
                    ))
                except Exception:
                    pass

    # Milestone 3: per-user disable
    if "users" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("users")}
        if "disabled_at" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN disabled_at TIMESTAMP"))
                except Exception:
                    pass

    # CV version counter — bumps when HR re-uploads a CV for an existing
    # candidate (matched by email), so we don't create duplicates and the UI
    # can show "v2", "v3" etc.
    if "candidates" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("candidates")}
        if "cv_version" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text(
                        "ALTER TABLE candidates ADD COLUMN cv_version INTEGER NOT NULL DEFAULT 1"
                    ))
                except Exception:
                    pass

    # Talent-bank profile fields on candidates — added so HR can suggest
    # past resumes for new jobs without re-running the LLM scorer.
    if "candidates" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("candidates")}
        profile_cols = {
            "profile_skills":           "TEXT DEFAULT ''",
            "profile_role":             "VARCHAR DEFAULT ''",
            "profile_seniority":        "VARCHAR DEFAULT ''",
            "profile_years_experience": "FLOAT",
            "profile_summary":          "TEXT DEFAULT ''",
            "profile_key_points":       "TEXT DEFAULT ''",
            "profile_extracted_at":     "TIMESTAMP",
        }
        with engine.begin() as conn:
            for col_name, col_type in profile_cols.items():
                if col_name not in existing:
                    try:
                        conn.execute(text(
                            f"ALTER TABLE candidates ADD COLUMN {col_name} {col_type}"
                        ))
                    except Exception:
                        pass

    # Fraud detection columns on Application + new resume_fraud_signals
    # table (Feature 1 of ENTERPRISE_FEATURES.md).
    if "applications" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("applications")}
        fraud_cols = {
            "fraud_score":                 "INTEGER DEFAULT 0",
            "fraud_flags_count":           "INTEGER DEFAULT 0",
            "fraud_blocked":               "BOOLEAN DEFAULT FALSE",
            "fraud_overridden_by_user_id": "INTEGER",
            "fraud_override_reason":       "TEXT DEFAULT ''",
            "fraud_overridden_at":         "TIMESTAMP",
        }
        with engine.begin() as conn:
            for col_name, col_type in fraud_cols.items():
                if col_name not in existing:
                    try:
                        conn.execute(text(
                            f"ALTER TABLE applications ADD COLUMN {col_name} {col_type}"
                        ))
                    except Exception:
                        pass

    # Audit log broadening (Feature 0): the original schema was super-admin
    # only. Add columns for tenant-level actions, generic resource pointers,
    # severity, and a snapshot of actor_email. Make super_admin_user_id
    # nullable in Postgres (SQLite doesn't enforce, so no-op there).
    if "audit_log" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("audit_log")}
        new_cols = {
            "tenant_id":         "INTEGER",
            "actor_user_id":     "INTEGER",
            "actor_email":       "VARCHAR",
            "actor_user_agent":  "VARCHAR",
            "resource_type":     "VARCHAR",
            "resource_id":       "VARCHAR",
            "severity":          "VARCHAR DEFAULT 'info'",
        }
        with engine.begin() as conn:
            for col_name, col_type in new_cols.items():
                if col_name not in existing:
                    try:
                        conn.execute(text(
                            f"ALTER TABLE audit_log ADD COLUMN {col_name} {col_type}"
                        ))
                    except Exception:
                        pass
        # Drop NOT NULL on super_admin_user_id (Postgres only — SQLite
        # treats this as no-op since it never enforced anyway). Best-effort.
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE audit_log ALTER COLUMN super_admin_user_id DROP NOT NULL"
                ))
        except Exception:
            pass

    # Feature 3: jobs.pipeline_template_id + applications.current_stage_id
    if "jobs" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("jobs")}
        if "pipeline_template_id" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text("ALTER TABLE jobs ADD COLUMN pipeline_template_id INTEGER"))
                except Exception:
                    pass
    if "applications" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("applications")}
        if "current_stage_id" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text("ALTER TABLE applications ADD COLUMN current_stage_id INTEGER"))
                except Exception:
                    pass

    # jobs.expires_at — optional auto-close date (recruiter productivity
    # follow-up). Nullable; existing rows stay open until manually closed.
    if "jobs" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("jobs")}
        if "expires_at" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text("ALTER TABLE jobs ADD COLUMN expires_at TIMESTAMP"))
                except Exception:
                    pass

    # Feature 5: events.actioned_by_user_id (per-recruiter productivity).
    # Nullable so historical rows survive untouched.
    if "events" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("events")}
        if "actioned_by_user_id" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text(
                        "ALTER TABLE events ADD COLUMN actioned_by_user_id INTEGER"
                    ))
                except Exception:
                    pass

    # Feature 5: llm_usage.user_id (per-recruiter LLM cost attribution).
    # Nullable — historical rows + background-worker rows have no actor.
    if "llm_usage" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("llm_usage")}
        if "user_id" not in existing:
            with engine.begin() as conn:
                try:
                    conn.execute(text(
                        "ALTER TABLE llm_usage ADD COLUMN user_id INTEGER"
                    ))
                except Exception:
                    pass

    # Heal orphaned candidate/application/event rows from the workflow bug:
    # the auto-pipeline used to create Candidate/Application/Event rows with
    # tenant_id=NULL, so the dashboard never saw them. Walk the ownership
    # chain (email → candidate → application → event/link) and copy the
    # tenant_id down. Idempotent — only touches rows that are still NULL.
    with engine.begin() as conn:
        try:
            conn.execute(text(
                "UPDATE candidates SET tenant_id = ("
                "  SELECT e.tenant_id FROM emails e WHERE e.id = candidates.source_email_id"
                ") WHERE tenant_id IS NULL AND source_email_id IS NOT NULL"
            ))
        except Exception:
            pass
        try:
            conn.execute(text(
                "UPDATE applications SET tenant_id = ("
                "  SELECT c.tenant_id FROM candidates c WHERE c.id = applications.candidate_id"
                ") WHERE tenant_id IS NULL"
            ))
        except Exception:
            pass
        try:
            conn.execute(text(
                "UPDATE events SET tenant_id = ("
                "  SELECT a.tenant_id FROM applications a WHERE a.id = events.app_id"
                ") WHERE tenant_id IS NULL AND app_id IS NOT NULL"
            ))
        except Exception:
            pass
        try:
            conn.execute(text(
                "UPDATE interview_links SET tenant_id = ("
                "  SELECT a.tenant_id FROM applications a WHERE a.id = interview_links.app_id"
                ") WHERE tenant_id IS NULL"
            ))
        except Exception:
            pass


def _apply_superadmin_emails():
    """Promote any user listed in SUPERADMIN_EMAILS env var to is_superadmin=True.

    Comma-separated list. Idempotent — runs on every startup. Users not yet signed up
    are skipped silently (will be promoted next startup if they sign up).
    """
    raw = os.getenv("SUPERADMIN_EMAILS", "").strip()
    if not raw:
        return
    emails = [e.strip().lower() for e in raw.split(",") if e.strip()]
    if not emails:
        return

    from models import User
    db = SessionLocal()
    try:
        promoted = []
        for email in emails:
            user = db.query(User).filter(User.email == email).first()
            if user and not user.is_superadmin:
                user.is_superadmin = True
                promoted.append(email)
        if promoted:
            db.commit()
            print(f"[auth] Promoted to superadmin: {', '.join(promoted)}")
    finally:
        db.close()


def _backfill_demo_tenant():
    """Ensure a 'demo' tenant exists and every legacy tenant_id-NULL row is owned by it.

    Runs on every startup but is idempotent: skips work when nothing's NULL.
    """
    from models import Tenant
    db = SessionLocal()
    try:
        demo = db.query(Tenant).filter(Tenant.slug == "demo").first()
        if not demo:
            demo = Tenant(slug="demo", name="Demo Tenant", plan="pro")
            db.add(demo)
            db.commit()
            db.refresh(demo)

        # Backfill any existing rows that predate multi-tenancy
        tenant_scoped_tables = [
            "jobs", "emails", "candidates", "applications", "events",
            "interview_links", "qa_sessions", "settings",
        ]
        from sqlalchemy import text, inspect as sa_inspect
        insp = sa_inspect(engine)
        with engine.begin() as conn:
            for tbl in tenant_scoped_tables:
                if tbl not in insp.get_table_names():
                    continue
                cols = {c["name"] for c in insp.get_columns(tbl)}
                if "tenant_id" not in cols:
                    continue
                try:
                    conn.execute(
                        text(f"UPDATE {tbl} SET tenant_id = :tid WHERE tenant_id IS NULL"),
                        {"tid": demo.id},
                    )
                except Exception:
                    pass
    finally:
        db.close()


def _seed_default_pipeline_templates():
    """Feature 3: each tenant gets one auto-seeded default pipeline
    template matching the legacy 7-stage flow. Idempotent — only runs
    for tenants that don't already have a default template.

    Stage keys are stable identifiers used by the auto-pipeline
    (workflow_service) to look up "matched", "screening_scheduled",
    "shortlisted" etc. Tenants can edit / clone the template freely; as
    long as their custom template exposes those keys the auto-pipeline
    keeps working.

    Also backfills jobs.pipeline_template_id and applications.current_
    stage_id from their existing string `stage` column.
    """
    from models import Tenant, PipelineTemplate, PipelineStage, Job, Application
    db = SessionLocal()
    try:
        # Default stage definitions — must include every legacy enum value
        # plus their colours / terminal flags.
        legacy_stages = [
            ("new", "New", "slate", False, ""),
            ("classified", "Classified", "slate", False, ""),
            ("matched", "Matched", "indigo", False, ""),
            ("screening_scheduled", "Screening scheduled", "violet", False, ""),
            ("screened", "Screened", "amber", False, ""),
            ("shortlisted", "Shortlisted", "emerald", True, "hired"),
            ("rejected", "Rejected", "rose", True, "rejected"),
        ]

        for tenant in db.query(Tenant).all():
            existing_default = db.query(PipelineTemplate).filter(
                PipelineTemplate.tenant_id == tenant.id,
                PipelineTemplate.is_default == True,  # noqa: E712
            ).first()
            if existing_default:
                continue

            tmpl = PipelineTemplate(
                tenant_id=tenant.id,
                name="Default",
                description="Auto-seeded legacy 7-stage pipeline.",
                is_default=True,
                is_system=True,
            )
            db.add(tmpl)
            db.flush()

            for idx, (key, label, color, is_terminal, outcome) in enumerate(legacy_stages):
                db.add(PipelineStage(
                    template_id=tmpl.id,
                    key=key,
                    label=label,
                    order_index=idx,
                    is_terminal=is_terminal,
                    terminal_outcome=outcome,
                    color=color,
                ))
            db.flush()

            # Build stage-key → stage-id lookup for the backfills below.
            stages_by_key = {
                s.key: s.id
                for s in db.query(PipelineStage).filter(
                    PipelineStage.template_id == tmpl.id
                ).all()
            }

            # Backfill Job.pipeline_template_id for this tenant's jobs
            db.query(Job).filter(
                Job.tenant_id == tenant.id,
                Job.pipeline_template_id.is_(None),
            ).update({Job.pipeline_template_id: tmpl.id}, synchronize_session=False)

            # Backfill Application.current_stage_id from its string stage.
            # Done one stage at a time (cheap; few rows).
            for key, sid in stages_by_key.items():
                db.query(Application).filter(
                    Application.tenant_id == tenant.id,
                    Application.stage == key,
                    Application.current_stage_id.is_(None),
                ).update({Application.current_stage_id: sid}, synchronize_session=False)

        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _seed_default_testimonials():
    """Insert the 4 default testimonials on first boot. Idempotent — only
    seeds when the table is empty so superadmin edits aren't overwritten."""
    from models import Testimonial
    db = SessionLocal()
    try:
        if db.query(Testimonial).count() > 0:
            return
        defaults = [
            ("We used to spend Mondays clearing the inbox. HireOps did it before our coffee was cold.",
             "Priya Anand", "Head of Talent", "/landing/avatar-asian-woman.webp", 1),
            ("The voice interview catches things a phone screen never would. Fraud signals are gold.",
             "Marcus Thompson", "Recruiting Lead", "/landing/avatar-black-man.webp", 2),
            ("Set thresholds once, watch the queue self-organize. We hired three engineers in two weeks.",
             "James Reeves", "VP People", "/landing/avatar-man-40s.webp", 3),
            ("It actually feels like a teammate. The shortlist it surfaces is the shortlist I'd build.",
             "Sara Mitchell", "Senior Recruiter", "/landing/avatar-woman-30s.webp", 4),
        ]
        for quote, name, role, avatar, order in defaults:
            db.add(Testimonial(
                quote=quote, author_name=name, author_role=role,
                avatar_url=avatar, display_order=order, is_active=True,
            ))
        db.commit()
    finally:
        db.close()
