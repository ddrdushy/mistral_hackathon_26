from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Float, DateTime, ForeignKey, Index, UniqueConstraint, Boolean
)
from sqlalchemy.orm import relationship
from database import Base


# ═══════════════════════════════════════════════════════════════════════════
# AUTH + MULTI-TENANCY
# ═══════════════════════════════════════════════════════════════════════════


class Tenant(Base):
    """A tenant = an organization signed up to HireOps. Each tenant has its
    own jobs, candidates, applications, etc. — fully isolated by tenant_id."""
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    slug = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    plan = Column(String, default="free", nullable=False)  # free/starter/pro

    # Stripe (filled in Phase 3 — billing)
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)
    subscription_status = Column(String, nullable=True)
    current_period_end = Column(DateTime, nullable=True)

    # Quota overrides — defaults defined in plans.py, persisted here when admin
    # gives a specific tenant a custom limit
    max_jobs = Column(Integer, nullable=True)
    max_candidates = Column(Integer, nullable=True)
    max_interviews_per_month = Column(Integer, nullable=True)

    suspended = Column(Boolean, default=False, nullable=False)
    # Soft-delete window: set when superadmin "deletes" the tenant. Hard-delete
    # is reserved for a periodic job (TODO) that runs ~30 days later. Until then
    # the tenant can be restored.
    deleted_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users = relationship("User", back_populates="tenant", foreign_keys="User.tenant_id")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    name = Column(String, default="")

    # Tenant-scoped role: owner (created the tenant) or member (invited)
    role = Column(String, default="owner", nullable=False)
    # Cross-tenant superadmin flag: only Symprio team members
    is_superadmin = Column(Boolean, default=False, nullable=False)

    email_verified_at = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    # Set when a superadmin individually disables a user (without suspending
    # the whole tenant). Disabled users can't log in but their data is kept.
    disabled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="users", foreign_keys=[tenant_id])

    __table_args__ = (
        Index("idx_users_tenant", "tenant_id"),
    )


class EmailVerification(Base):
    """Single-use tokens emailed at signup. Expire after 24h."""
    __tablename__ = "email_verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PasswordReset(Base):
    """Single-use tokens for password reset. Expire after 1h."""
    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class LlmUsage(Base):
    """Per-call LLM usage record. Used for tenant-level cost guards and reports.

    tenant_id is nullable for legacy/system calls. Daily spend is computed by
    summing cost_usd over (tenant_id, date).
    """
    __tablename__ = "llm_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    agent_name = Column(String, nullable=False)
    model = Column(String, default="")
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    latency_ms = Column(Integer, default=0)
    status = Column(String, default="success")  # success / error / blocked
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_llm_usage_tenant_day", "tenant_id", "created_at"),
    )


class AuditLog(Base):
    """Append-only record of every privileged super-admin action.

    Stored separately from Event (which is per-tenant). Audit log is global
    and read-only after creation.
    """
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    super_admin_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action_type = Column(String, nullable=False, index=True)
    # e.g. "tenant.suspend", "tenant.impersonate", "tenant.plan_change",
    #      "tenant.quota_change", "tenant.delete", "tenant.restore",
    #      "user.password_reset", "user.disable", "superadmin.grant"
    target_tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    payload = Column(Text, default="{}")  # JSON: {before:..., after:..., reason:...}
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_audit_action_time", "action_type", "created_at"),
    )


class TenantInvite(Base):
    """Tenant owner invites a teammate by email. Single-use token, expires in 7 days."""
    __tablename__ = "tenant_invites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    invited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    email = Column(String, nullable=False)
    role = Column(String, default="member", nullable=False)
    token = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_invites_tenant", "tenant_id"),
    )


# ═══════════════════════════════════════════════════════════════════════════
# TENANT-SCOPED RECRUITING DATA
# ═══════════════════════════════════════════════════════════════════════════


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    job_id = Column(String, unique=True, nullable=False)  # JOB-YYYY-NNN
    title = Column(String, nullable=False)
    department = Column(String, default="")
    location = Column(String, default="")
    seniority = Column(String, default="")  # junior/mid/senior/lead
    skills = Column(Text, default="[]")  # JSON array
    responsibilities = Column(Text, default="[]")  # JSON array
    qualifications = Column(Text, default="[]")  # JSON array
    description = Column(Text, default="")
    status = Column(String, default="open")  # open/closed/paused

    # Score thresholds for auto-decision
    resume_threshold_min = Column(Float, default=80.0)      # Min resume score to advance (80-100%)
    interview_threshold_min = Column(Float, default=75.0)   # Min interview score to advance (75-95%)
    final_threshold_reject = Column(Float, default=50.0)    # Below this → auto-reject

    # First-round interview mode: "voice" (ElevenLabs) or "qa" (LLM-generated written Q&A)
    interview_mode = Column(String, default="voice")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    applications = relationship("Application", back_populates="job")


class Email(Base):
    __tablename__ = "emails"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    message_id = Column(String, unique=True, nullable=True)
    from_address = Column(String, nullable=False)
    from_name = Column(String, default="")
    subject = Column(String, default="")
    body_snippet = Column(Text, default="")
    body_full = Column(Text, default="")
    attachments = Column(Text, default="[]")  # JSON array
    classification = Column(Text, nullable=True)  # Full JSON from classifier
    classified_as = Column(String, nullable=True)  # candidate_application/general/unknown
    confidence = Column(Float, nullable=True)
    processed = Column(Integer, default=0)  # 0=new, 1=classified, 2=candidate_created
    received_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    candidate = relationship("Candidate", back_populates="source_email", uselist=False)

    __table_args__ = (
        Index("idx_emails_classified", "classified_as"),
    )


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, default="")
    resume_text = Column(Text, default="")
    resume_filename = Column(String, default="")
    source_email_id = Column(Integer, ForeignKey("emails.id"), nullable=True)
    notes = Column(Text, default="")

    # Talent-bank profile — extracted once per resume so we can match against
    # future jobs by tag overlap without re-calling the LLM. Nullable while
    # extraction is pending; profile_extracted_at gates the suggested-
    # candidates endpoint (only profiled rows are searchable).
    profile_skills = Column(Text, default="")           # JSON array of strings
    profile_role = Column(String, default="")           # primary role title
    profile_seniority = Column(String, default="")      # junior/mid/senior/lead
    profile_years_experience = Column(Float, nullable=True)
    profile_summary = Column(Text, default="")
    profile_key_points = Column(Text, default="")    # JSON array of bullets
    profile_extracted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    source_email = relationship("Email", back_populates="candidate")
    applications = relationship("Application", back_populates="candidate")


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False)
    stage = Column(String, default="new")
    resume_score = Column(Float, nullable=True)
    resume_score_json = Column(Text, nullable=True)
    interview_score = Column(Float, nullable=True)
    interview_score_json = Column(Text, nullable=True)
    screening_transcript = Column(Text, nullable=True)
    screening_audio_path = Column(String, nullable=True)
    screening_status = Column(String, nullable=True)  # scheduled/in_progress/completed/no_answer/failed/voicemail
    screening_attempts = Column(Integer, default=0)
    screening_max_attempts = Column(Integer, default=3)
    screening_last_attempt_at = Column(DateTime, nullable=True)
    screening_failure_reason = Column(String, nullable=True)
    recommendation = Column(String, nullable=True)  # advance/hold/reject
    ai_next_action = Column(Text, nullable=True)
    ai_snippets = Column(Text, nullable=True)  # JSON
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Interview link tracking
    interview_link_status = Column(String, nullable=True)  # generated/sent/opened/interview_started/interview_completed/expired
    interview_face_tracking_json = Column(Text, nullable=True)  # JSON aggregate

    # Scheduling
    scheduled_interview_at = Column(DateTime, nullable=True)
    scheduled_interview_slot = Column(String, nullable=True)  # Human-readable slot text
    email_draft_sent = Column(Integer, default=0)  # 0=not sent, 1=sent

    # Final combined score (LLM-generated from resume + interview)
    final_score = Column(Float, nullable=True)
    final_summary = Column(Text, nullable=True)

    candidate = relationship("Candidate", back_populates="applications")
    job = relationship("Job", back_populates="applications")
    events = relationship("Event", back_populates="application")
    interview_links = relationship("InterviewLink", back_populates="application")

    __table_args__ = (
        UniqueConstraint("candidate_id", "job_id", name="uq_candidate_job"),
        Index("idx_applications_job", "job_id"),
        Index("idx_applications_stage", "stage"),
        Index("idx_applications_candidate", "candidate_id"),
    )


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=True)
    event_type = Column(String, nullable=False)
    payload = Column(Text, default="{}")  # JSON
    created_at = Column(DateTime, default=datetime.utcnow)

    application = relationship("Application", back_populates="events")

    __table_args__ = (
        Index("idx_events_app", "app_id"),
    )


class Setting(Base):
    """Key-value store for persistent app settings (e.g. Gmail credentials).

    Tenant-scoped: same key can exist for different tenants. tenant_id NULL
    is reserved for global settings (set by superadmin)."""
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    key = Column(String, nullable=False, index=True)
    value = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_settings_tenant_key"),
    )


class InterviewLink(Base):
    __tablename__ = "interview_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    token = Column(String, unique=True, nullable=False, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    status = Column(String, default="generated")  # generated/sent/opened/interview_started/interview_completed/expired
    round = Column(Integer, default=1)  # 1 = screening, 2 = in-person/follow-up
    elevenlabs_conversation_id = Column(String, nullable=True)
    scheduled_at = Column(DateTime, nullable=True)  # When the interview is scheduled to start
    face_tracking_json = Column(Text, nullable=True)  # JSON: {avg_attention, face_present_pct, snapshots}
    expires_at = Column(DateTime, nullable=False)
    opened_at = Column(DateTime, nullable=True)
    interview_started_at = Column(DateTime, nullable=True)
    interview_completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    application = relationship("Application", back_populates="interview_links")

    __table_args__ = (
        Index("idx_interview_links_app", "app_id"),
        Index("idx_interview_links_status", "status"),
    )


class QaSession(Base):
    """LLM-generated written Q&A interview, scoped to one application.

    Holds the 3-round question set (aptitude → reasoning → technical), the
    candidate's answers per round, per-round scores, and the final aggregate.
    """
    __tablename__ = "qa_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=False, unique=True)
    token = Column(String, ForeignKey("interview_links.token"), nullable=False, index=True)

    questions_json = Column(Text, nullable=False)  # {aptitude:[..], reasoning:[..], technical:[..]}
    answers_json = Column(Text, default="{}")      # {aptitude:[..], reasoning:[..], technical:[..]}
    scores_json = Column(Text, default="{}")       # {aptitude:{score,feedback}, reasoning:{...}, technical:{...}}
    # Per-round behavioural signals: focus loss, paste events, time per question.
    # Shape: {aptitude: {focus_loss_count, focus_loss_seconds, paste_count, paste_chars,
    #                    time_per_question_seconds: [..], total_time_seconds}}
    signals_json = Column(Text, default="{}")

    current_round = Column(String, default="aptitude")  # aptitude/reasoning/technical/completed
    final_score = Column(Float, nullable=True)
    final_summary = Column(Text, nullable=True)
    # Aggregated fraud risk derived from signals + face tracking. 0 (clean) - 100 (high risk).
    fraud_risk_score = Column(Float, nullable=True)

    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_qa_sessions_app", "app_id"),
    )


class MailAccount(Base):
    """Per-tenant inbound mailbox connection.

    A tenant can connect any number of mailboxes (jobs@, hr@, careers@, …).
    Each row stores the IMAP/POP3 configuration plus an encrypted credential
    (Fernet via services.secrets_crypto). The classifier reads from these
    accounts on a schedule or via the on-demand sync endpoint.

    Auth methods supported:
      - imap_password   : IMAP host + app password (Outlook, Yahoo, iCloud, AOL,
                          Gmail-via-app-password, Exchange, generic IMAP).
      - pop3_password   : POP3 host + app password (legacy, rarely used).

    Gmail OAuth lives in services/gmail_service.py and is platform-managed (env
    vars) — not stored here. Future: per-tenant OAuth refresh tokens land here
    with auth_method="gmail_oauth" / "ms_oauth".
    """
    __tablename__ = "mail_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    provider = Column(String, nullable=False)             # gmail|outlook|yahoo|icloud|exchange|aol|imap|pop3
    auth_method = Column(String, nullable=False)          # imap_password|pop3_password|gmail_oauth|ms_oauth
    email_address = Column(String, nullable=False)        # display label & login user

    imap_host = Column(String, nullable=False, default="")
    imap_port = Column(Integer, nullable=False, default=993)
    imap_ssl = Column(Boolean, nullable=False, default=True)
    imap_user = Column(String, nullable=False, default="")  # often == email_address

    secret_encrypted = Column(Text, nullable=False, default="")  # Fernet ciphertext

    status = Column(String, nullable=False, default="connected")  # connected|error|disconnected
    last_error = Column(Text, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_synced_count = Column(Integer, nullable=False, default=0)

    # When False the auto-pickup listener skips this mailbox — used by the
    # tenant-facing pause toggle so they can stop classifier LLM spend on a
    # noisy mailbox without disconnecting the credentials.
    listener_enabled = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "email_address", name="uq_mail_accounts_tenant_email"),
        Index("idx_mail_accounts_tenant", "tenant_id"),
    )


class JobBoardAccount(Base):
    """Per-tenant job-board / talent-source connection.

    The product story is the same as MailAccount:
      - Apollo is platform-managed (one APOLLO_API_KEY env var, every tenant
        can search through it; we don't store a row per tenant for Apollo).
      - LinkedIn / Indeed / JobStreet (SEEK) require partner agreements that
        most tenants don't have. But many *do* have their own paid recruiter
        seats — they BYO their API key / OAuth refresh token here, encrypted
        at rest with services.secrets_crypto, and search runs through their
        own subscription quota.

    capabilities tracks what the connected account can actually do, which
    differs by provider tier (e.g. LinkedIn Recruiter Lite ≠ Talent Solutions).
    """
    __tablename__ = "job_board_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)

    provider = Column(String, nullable=False)         # indeed | linkedin | jobstreet | apollo (BYO override)
    auth_method = Column(String, nullable=False)       # api_key | oauth
    account_label = Column(String, nullable=False, default="")  # "ACME LinkedIn Recruiter"
    external_user_id = Column(String, nullable=False, default="")

    # JSON array of capability flags: search_candidates | post_job | inbound_apply
    capabilities = Column(Text, nullable=False, default="[]")

    secret_encrypted = Column(Text, nullable=False, default="")  # Fernet ciphertext

    status = Column(String, nullable=False, default="connected")  # connected|error|disconnected
    last_error = Column(Text, nullable=True)
    last_used_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", "external_user_id",
                         name="uq_job_board_accounts_tenant_provider_user"),
        Index("idx_job_board_accounts_tenant", "tenant_id"),
    )


class Testimonial(Base):
    """Marketing testimonials shown on the public landing page.

    Global (no tenant_id). Only superadmins can create/edit/delete via the
    admin UI. The public landing page fetches active rows ordered by
    display_order.
    """
    __tablename__ = "testimonials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    quote = Column(Text, nullable=False)
    author_name = Column(String, nullable=False)
    author_role = Column(String, nullable=False, default="")
    avatar_url = Column(String, nullable=False, default="")  # path under /landing/ or full URL
    is_active = Column(Boolean, nullable=False, default=True)
    display_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_testimonials_active_order", "is_active", "display_order"),
    )
