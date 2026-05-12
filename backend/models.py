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
    # Per-tenant agent overrides on top of plan defaults. Stored as JSON
    # of {"add": [...], "remove": [...]} — superadmin can grant or revoke
    # individual agents without changing the tenant's plan tier.
    agent_overrides_json = Column(Text, default='{"add": [], "remove": []}')

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

    # Organization profile — collected at onboarding so AI features (JD
    # generator, outreach, etc.) ground prompts in real company data
    # instead of inventing "San Francisco, CA" / "TechCorp" placeholders.
    industry = Column(String, nullable=True)
    headquarters = Column(String, nullable=True)
    company_size = Column(String, nullable=True)
    website = Column(String, nullable=True)
    about = Column(Text, nullable=True)
    default_work_mode = Column(String, nullable=True)
    default_currency = Column(String, nullable=True)
    profile_completed_at = Column(DateTime, nullable=True)

    # Branding — applied to every email the platform sends. Each field
    # falls back to a sensible default when empty (logo to the HireOps
    # mark, colour to indigo, from-name to the tenant.name). Logo is
    # stored as a URL (CDN-hosted or pasted external URL); v2 will add
    # direct upload.
    brand_logo_url = Column(String, nullable=True)
    brand_primary_color = Column(String, nullable=True)   # hex incl. '#'
    brand_from_name = Column(String, nullable=True)       # display name on outbound emails
    brand_signature = Column(Text, nullable=True)         # plain or basic HTML

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

    user_id (Feature 5) attributes the call to the recruiter that triggered
    it, so the recruiter leaderboard can show per-person AI spend. Nullable
    because background workers + auto-pipeline runs aren't user-driven.
    """
    __tablename__ = "llm_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
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
        Index("idx_llm_usage_user_day", "user_id", "created_at"),
    )


class AuditLog(Base):
    """Append-only record of every privileged action — super-admin AND
    tenant-level (Feature 0 of ENTERPRISE_FEATURES.md).

    Originally super-admin-only (super_admin_user_id NOT NULL). Broadened
    to a generic actor model: actor_user_id is nullable so platform actions
    can be recorded with NULL actor; super_admin_user_id is now an alias /
    legacy column kept for back-compat with existing rows.

    Records are immutable — no router writes UPDATE/DELETE.
    """
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # NEW broad actor identity (preferred). actor_email is a snapshot so
    # the record survives user deletion.
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    actor_email = Column(String, nullable=True)
    actor_user_agent = Column(String, nullable=True)

    # Legacy super-admin column — nullable now. Older rows still populate it.
    super_admin_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Action namespace — verb-style, e.g. "tenant.suspend", "candidate.tag.add",
    # "offer.send", "fraud.detected".
    action_type = Column(String, nullable=False, index=True)

    # Generic resource pointer. Coexists with target_tenant_id/target_user_id
    # for back-compat — new code should populate resource_type + resource_id.
    resource_type = Column(String, nullable=True, index=True)  # tenant | application | offer | ...
    resource_id = Column(String, nullable=True, index=True)    # string to support int + uuid

    target_tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    payload = Column(Text, default="{}")  # JSON: {before:..., after:..., reason:...}
    severity = Column(String, default="info", index=True)  # info | warning | critical
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_audit_action_time", "action_type", "created_at"),
    )


class EmailTemplate(Base):
    """Per-tenant email template overrides. One row per (tenant_id,
    category). Falls back to the platform default in services/email_templates.py
    when no row exists for a category.

    Body is plain HTML (we render the email as HTML with a text fallback
    auto-derived). Variables use {token} syntax — see the renderer for
    the supported tokens per category.
    """
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    category = Column(String, nullable=False)
    # interview_invite | interview_reschedule | availability_check | rejection | offer_email
    subject = Column(String, nullable=False)
    body_html = Column(Text, nullable=False)
    body_text = Column(Text, default="")  # optional plain-text variant
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "category", name="uq_email_template_tenant_category"),
    )


class UserCalendarConnection(Base):
    """Per-user OAuth tokens for the recruiter's external calendar
    (currently Google Calendar). The freebusy reader uses these to
    filter out interview slots that would clash with the recruiter's
    existing meetings.

    Stored per user (not per tenant) because two recruiters on the
    same tenant will each have their own Google account.
    """
    __tablename__ = "user_calendar_connections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    provider = Column(String, nullable=False, default="google")
    email_address = Column(String, nullable=False)
    refresh_token_encrypted = Column(Text, nullable=False)
    access_token_encrypted = Column(Text, default="")
    access_token_expires_at = Column(DateTime, nullable=True)
    scopes = Column(Text, default="")  # space-separated
    connected_at = Column(DateTime, default=datetime.utcnow)
    last_refreshed_at = Column(DateTime, nullable=True)


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


class JobBoardConnection(Base):
    """Per-tenant credentials for a job-board provider (LinkedIn, Indeed,
    Facebook Jobs, MyFutureJobs, etc).

    Same encryption-at-rest pattern as ExternalIntegration: Fernet-
    encrypted blob in `encrypted_credentials`. settings_json carries
    board-specific config (default location, company id, etc).
    """
    __tablename__ = "job_board_connections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    provider = Column(String, nullable=False)
    # linkedin | indeed | facebook | myfuturejobs | mock
    encrypted_credentials = Column(Text, default="")
    settings_json = Column(Text, default="{}")
    enabled = Column(Boolean, default=True)
    last_error = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_jbc_tenant_provider"),
    )


class JobBoardPosting(Base):
    """One row per (job, board) pair. Tracks where a job is published,
    the external id assigned by the board, the live URL, and the most
    recent sync status.
    """
    __tablename__ = "job_board_postings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String, nullable=False)
    external_id = Column(String, default="")
    external_url = Column(String, default="")
    # pending | published | failed | unpublished | expired
    status = Column(String, default="pending", index=True)
    last_error = Column(Text, default="")
    posted_at = Column(DateTime, nullable=True)
    unposted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("job_id", "provider", name="uq_jbp_job_provider"),
    )


class SupportTicket(Base):
    """Tenant-raised support / bug request.

    Tenant owners + members can create tickets. Super-admins read them
    to triage, but the tenant-private body stays in this table — no
    candidate / CV / transcript bleeds in unless the tenant types it
    themselves into the description.
    """
    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # bug | feature_request | billing | other
    category = Column(String, default="other", nullable=False)
    # low | normal | high | urgent
    priority = Column(String, default="normal", nullable=False)
    subject = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    # open | in_progress | waiting_tenant | resolved | closed
    status = Column(String, default="open", nullable=False, index=True)
    admin_reply = Column(Text, default="")
    admin_replied_at = Column(DateTime, nullable=True)
    admin_replied_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TenantFeedback(Base):
    """Lightweight 'how are we doing' feedback. Optional rating + free
    text. Distinct from support tickets — no reply loop, no state
    machine, just a stream platform owners read for product signal.
    """
    __tablename__ = "tenant_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # nps (0–10) or csat (1–5) — caller picks; null if user only left text.
    rating = Column(Integer, nullable=True)
    rating_scale = Column(String, default="csat")  # csat | nps
    # praise | suggestion | bug | other
    category = Column(String, default="suggestion")
    message = Column(Text, nullable=False)
    # platform-side flag — has the team triaged this yet
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


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

    # Optional expiry date. When set and in the past, the auto-pipeline +
    # /jobs?status=open queries treat the job as closed. Recruiters can
    # still reopen it by clearing the date or extending it.
    expires_at = Column(DateTime, nullable=True)

    # Score thresholds for auto-decision
    resume_threshold_min = Column(Float, default=80.0)      # Min resume score to advance (80-100%)
    interview_threshold_min = Column(Float, default=75.0)   # Min interview score to advance (75-95%)
    final_threshold_reject = Column(Float, default=50.0)    # Below this → auto-reject

    # First-round interview mode: "voice" (ElevenLabs) or "qa" (LLM-generated written Q&A)
    interview_mode = Column(String, default="voice")

    # Custom hiring stages (Feature 3). Nullable so existing jobs keep
    # working via the legacy string-stage path until they're migrated to
    # a template.
    pipeline_template_id = Column(Integer, ForeignKey("pipeline_templates.id"), nullable=True)

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
    cv_version = Column(Integer, default=1, nullable=False)  # bumps on re-upload
    source_email_id = Column(Integer, ForeignKey("emails.id"), nullable=True)
    notes = Column(Text, default="")

    # Talent-bank availability flag — set by the WhatsApp inbound bot
    # when a candidate replies that they're not interested / joined
    # another company. Lets the match engine grey them out instead of
    # surfacing them again on the next role.
    # Values: "available" (default), "joined_another", "not_available", "hired_elsewhere"
    talent_bank_status = Column(String, default="available", nullable=False)
    talent_bank_status_reason = Column(String, default="")  # snippet from their reply
    talent_bank_status_updated_at = Column(DateTime, nullable=True)

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
    cv_versions = relationship(
        "CandidateCvVersion",
        back_populates="candidate",
        cascade="all, delete-orphan",
    )


class CallQueue(Base):
    """Outbound voice calls queued for dispatch.

    Each row is a single attempt to dial a candidate at a specific time.
    A worker polls for status='pending' AND scheduled_for <= now(), marks
    in_progress, dispatches via Twilio (with ElevenLabs agent in the loop
    when configured), and reconciles status from Twilio's status webhook.

    Reschedule flow: when an outcome of 'reschedule' is detected (manually
    via UI or by parsing the conversation), we mark the original row
    'rescheduled' and enqueue a NEW pending row at the new time. Keeps the
    full attempt history visible.
    """
    __tablename__ = "call_queue"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=True, index=True)

    purpose = Column(String, default="screening")
    # screening | reschedule | reminder | availability_check | custom
    status = Column(String, default="pending", index=True)
    # pending | in_progress | completed | failed | cancelled | rescheduled

    scheduled_for = Column(DateTime, nullable=False, index=True)
    attempted_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    to_phone = Column(String, nullable=False, default="")
    from_phone = Column(String, default="")

    twilio_call_sid = Column(String, default="")
    elevenlabs_conversation_id = Column(String, default="")

    script_prompt = Column(Text, default="")
    transcript = Column(Text, default="")
    outcome = Column(String, default="")
    # confirmed | reschedule | declined | no_answer | voicemail | error
    outcome_details_json = Column(Text, default="{}")

    rescheduled_to_id = Column(Integer, ForeignKey("call_queue.id"), nullable=True)
    retry_count = Column(Integer, default=0)
    last_error = Column(Text, default="")

    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TenantIntegration(Base):
    """Per-tenant integration credentials (Twilio, Slack, etc.).

    config_json holds public/non-secret config (account SID, from-number);
    secret_encrypted holds anything that must stay encrypted at rest
    (auth token, OAuth refresh token). Both are tenant-scoped — multi-
    tenant isolation lives at the DB layer.
    """
    __tablename__ = "tenant_integrations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    provider = Column(String, nullable=False)  # twilio | slack | ...
    enabled = Column(Boolean, default=True, nullable=False)
    config_json = Column(Text, default="{}")
    secret_encrypted = Column(Text, default="")
    last_error = Column(Text, default="")
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_tenant_integrations_tenant_provider"),
    )


class Communication(Base):
    """One row per outbound (or inbound) message to a candidate.

    Channel-agnostic so email, WhatsApp, and voice calls all live in the
    same audit log. Surfaces in the candidate timeline so HR can see a
    single chronological view of every touchpoint."""
    __tablename__ = "communications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=True, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=True, index=True)

    channel = Column(String, nullable=False)              # email | whatsapp | voice
    direction = Column(String, default="outbound")        # outbound | inbound
    status = Column(String, default="pending")            # pending | sent | delivered | failed | read
    to_address = Column(String, default="")
    from_address = Column(String, default="")
    subject = Column(String, default="")
    body = Column(Text, default="")
    metadata_json = Column(Text, default="{}")            # provider message id, etc.
    error = Column(Text, default="")

    sent_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    delivered_at = Column(DateTime, nullable=True)


class ExternalIntegration(Base):
    """HRIS / ATS integration credentials (Feature 9).

    One row per (tenant, provider) connection. Credentials Fernet-
    encrypted via services.secrets_crypto — same path as MailAccount.
    settings_json carries the provider-specific field/stage mappings
    so the sync engine knows how to translate.
    """
    __tablename__ = "external_integrations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    provider = Column(String, nullable=False)
    # mock | merge | greenhouse | lever | workday | bamboohr | ...
    provider_account_id = Column(String, default="")
    encrypted_credentials = Column(Text, default="")  # Fernet JSON blob
    sync_enabled = Column(Boolean, default=True)
    sync_status = Column(String, default="active")
    # active | paused | error | auth_failed | disconnected
    last_synced_at = Column(DateTime, nullable=True)
    last_error = Column(Text, default="")
    settings_json = Column(Text, default="{}")
    push_ai_signals = Column(Boolean, default=False)  # privacy default: off
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_external_int_tenant_provider"),
    )


class ExternalIdMapping(Base):
    """Maps a HireOps entity (candidate/job/application) to its
    counterpart in an external system. Used by the sync engine to
    decide create-vs-update on every push."""
    __tablename__ = "external_id_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    integration_id = Column(Integer, ForeignKey("external_integrations.id", ondelete="CASCADE"), nullable=False, index=True)
    internal_type = Column(String, nullable=False)  # candidate | job | application
    internal_id = Column(String, nullable=False)    # stored as string to support int + uuid
    external_id = Column(String, nullable=False)
    last_synced_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "internal_type", "internal_id", name="uq_idmap_internal"),
        UniqueConstraint("integration_id", "internal_type", "external_id", name="uq_idmap_external"),
    )


class IntegrationSyncLog(Base):
    """One row per sync run (pull or push). Surfaces in the integration
    detail UI as a run history."""
    __tablename__ = "integration_sync_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    integration_id = Column(Integer, ForeignKey("external_integrations.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at = Column(DateTime, nullable=True)
    direction = Column(String, default="pull")   # pull | push
    status = Column(String, default="running")   # running | success | partial | failed
    records_processed = Column(Integer, default=0)
    records_failed = Column(Integer, default=0)
    error_summary = Column(Text, default="")
    payload_summary_json = Column(Text, default="{}")


class PipelineForecast(Base):
    """Cached forecast result (Feature 8).

    `forecast_service.forecast_pipeline()` reads from the latest row for
    (tenant_id, job_id, window_days) and recomputes when older than 6h.
    Manual recompute writes a fresh row regardless of staleness.
    """
    __tablename__ = "pipeline_forecasts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=True, index=True)
    window_days = Column(Integer, nullable=False)
    run_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    expected_hires = Column(Float, default=0.0)
    confidence_low = Column(Float, default=0.0)
    confidence_high = Column(Float, default=0.0)
    open_applications = Column(Integer, default=0)
    breakdown_json = Column(Text, default="{}")
    notes = Column(Text, default="")


class PipelineTemplate(Base):
    """Tenant-defined hiring pipeline (Feature 3).

    Each tenant gets one auto-seeded default template at signup with the
    legacy 7-stage flow (new → classified → matched → screening_scheduled
    → screened → shortlisted | rejected) so existing string-based code
    keeps working. Custom templates can be cloned from any other.

    The KEY CONTRACT: every system / default template carries the legacy
    keys above as `key`. The auto-pipeline (workflow_service) looks up
    stages by key, so as long as a template exposes those keys it stays
    compatible. Custom-key-only templates will fall back to writing the
    string `Application.stage` and the auto-pipeline will skip the
    current_stage_id update (graceful degradation).
    """
    __tablename__ = "pipeline_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    is_default = Column(Boolean, default=False)
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_pipeline_template_tenant_name"),
    )


class PipelineStage(Base):
    """One stage inside a PipelineTemplate. Unique on (template, key)
    so existing code can look up by stable key string."""
    __tablename__ = "pipeline_stages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    template_id = Column(Integer, ForeignKey("pipeline_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String, nullable=False)
    label = Column(String, nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    is_terminal = Column(Boolean, default=False)
    terminal_outcome = Column(String, default="")  # hired | rejected | withdrawn | ""
    auto_advance_threshold = Column(Integer, nullable=True)
    color = Column(String, default="slate")  # palette key, mirrors Tag colors

    __table_args__ = (
        UniqueConstraint("template_id", "key", name="uq_stage_template_key"),
    )


class ApplicationStageTransition(Base):
    """Audit trail of every stage move for an application. Driven by the
    PATCH /applications/{id}/stage endpoint (and the auto-pipeline)."""
    __tablename__ = "application_stage_transitions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True)
    from_stage_id = Column(Integer, ForeignKey("pipeline_stages.id"), nullable=True)
    to_stage_id = Column(Integer, ForeignKey("pipeline_stages.id"), nullable=False)
    # Snapshot of the string keys at the time of transition — survives
    # template stage renames/reorders.
    from_stage_key = Column(String, default="")
    to_stage_key = Column(String, default="")
    transitioned_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    actioned_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    note = Column(Text, default="")


class OutreachSequence(Base):
    """A multi-step outbound sequence (Feature 6).

    HR creates a sequence ("Cold candidate outreach"), defines its steps
    (Day 0 email → Day 3 SMS → Day 7 WhatsApp), then enrolls candidates.
    The outreach worker dispatches each step at the configured delay.
    Reply detection auto-stops the enrollment when stop_on_reply is set.
    """
    __tablename__ = "outreach_sequences"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    is_active = Column(Boolean, default=True)
    stop_on_reply = Column(Boolean, default=True)
    stop_on_meeting_booked = Column(Boolean, default=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_outreach_seq_tenant_name"),
    )


class OutreachStep(Base):
    """One step within an outreach sequence."""
    __tablename__ = "outreach_steps"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sequence_id = Column(Integer, ForeignKey("outreach_sequences.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index = Column(Integer, nullable=False, default=0)
    channel = Column(String, nullable=False)  # email | sms | whatsapp
    # Delay relative to the previous step's send_at. Step 0 fires
    # delay_hours after enrollment.
    delay_hours = Column(Integer, default=0, nullable=False)
    template_subject = Column(String, default="")  # email only
    template_body = Column(Text, nullable=False, default="")
    conditions_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class OutreachEnrollment(Base):
    """A candidate's run through an outreach sequence."""
    __tablename__ = "outreach_enrollments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    sequence_id = Column(Integer, ForeignKey("outreach_sequences.id"), nullable=False, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=True)

    # Index of the most recently SCHEDULED step. Worker advances this
    # forward after each successful send.
    current_step_index = Column(Integer, default=0)
    status = Column(String, default="active")
    # active | completed | stopped | failed | paused
    paused_reason = Column(String, default="")
    # replied | meeting_booked | manual | error

    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    enrolled_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        # A candidate can only be in a given sequence once at a time —
        # unique on (sequence, candidate, status='active'). Postgres
        # partial unique indexes are nice but SQLite doesn't support
        # them, so we enforce in the router instead.
        Index("idx_outreach_enroll_status", "tenant_id", "status"),
    )


class OutreachMessage(Base):
    """One message dispatched (or scheduled) for an enrollment."""
    __tablename__ = "outreach_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    enrollment_id = Column(Integer, ForeignKey("outreach_enrollments.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id = Column(Integer, ForeignKey("outreach_steps.id"), nullable=False)
    channel = Column(String, nullable=False)

    scheduled_for = Column(DateTime, nullable=False, index=True)
    sent_at = Column(DateTime, nullable=True, index=True)
    delivery_status = Column(String, default="scheduled")
    # scheduled | sent | delivered | failed | skipped
    external_message_id = Column(String, default="")
    error_message = Column(Text, default="")
    rendered_subject = Column(String, default="")
    rendered_body = Column(Text, default="")
    to_address = Column(String, default="")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class OfferTemplate(Base):
    """Tenant-defined offer letter template (Feature 7).

    body_markdown supports {{merge_tag}} substitution at render time.
    fields_json is a list[dict] describing the fields the template asks
    for; the UI renders inputs from this schema.
    """
    __tablename__ = "offer_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    body_markdown = Column(Text, nullable=False, default="")
    fields_json = Column(Text, default="[]")
    # [{key:"salary", label:"Salary", type:"currency", required:true}, ...]
    requires_approval = Column(Boolean, default=False)
    approval_chain_user_ids_json = Column(Text, default="[]")
    is_default = Column(Boolean, default=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_offer_templates_tenant_name"),
    )


class Offer(Base):
    """A generated offer letter for a specific application/candidate.

    Lifecycle:
      draft → pending_approval → approved → sent → viewed → signed
            ↘                                    ↘ declined / expired / withdrawn
    """
    __tablename__ = "offers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("offer_templates.id"), nullable=True)

    salary_amount = Column(Float, nullable=True)
    salary_currency = Column(String, default="USD")
    bonus_amount = Column(Float, nullable=True)
    equity_description = Column(Text, default="")
    employment_type = Column(String, default="full_time")  # full_time|part_time|contract
    start_date = Column(DateTime, nullable=True)
    location = Column(String, default="")
    custom_fields_json = Column(Text, default="{}")

    rendered_markdown = Column(Text, default="")  # post-merge body
    rendered_html = Column(Text, default="")      # rendered HTML (acts as PDF surrogate in v1)
    signed_html = Column(Text, default="")        # rendered_html + signature footer

    esign_provider = Column(String, default="mock")  # mock|docusign|hellosign
    esign_envelope_id = Column(String, default="")
    esign_signing_token = Column(String, index=True, default="")
    signature_name = Column(String, default="")
    signature_ip = Column(String, default="")

    status = Column(String, default="draft", index=True)
    # draft | pending_approval | approved | sent | viewed | signed | declined | expired | withdrawn
    sent_at = Column(DateTime, nullable=True)
    viewed_at = Column(DateTime, nullable=True)
    signed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    declined_reason = Column(Text, default="")

    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class OfferApproval(Base):
    """Approval chain step for offers requiring sign-off."""
    __tablename__ = "offer_approvals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    offer_id = Column(Integer, ForeignKey("offers.id", ondelete="CASCADE"), nullable=False, index=True)
    approver_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String, default="pending")  # pending | approved | rejected
    comment = Column(Text, default="")
    actioned_at = Column(DateTime, nullable=True)
    order_index = Column(Integer, default=0)


class TenantESignConfig(Base):
    """Per-tenant e-sign provider credentials (DocuSign/HelloSign).

    Only used when provider != 'mock'. Mock signing is the v1 default
    and doesn't need any external integration.
    """
    __tablename__ = "tenant_esign_config"

    tenant_id = Column(Integer, ForeignKey("tenants.id"), primary_key=True)
    provider = Column(String, nullable=False)  # docusign | hellosign
    secret_encrypted = Column(Text, default="")  # Fernet-encrypted JSON
    account_id = Column(String, default="")
    is_sandbox = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class JobInterviewQuestion(Base):
    """Per-job custom interview question (Feature 4 of ENTERPRISE_FEATURES.md).

    The Q&A agent prepends required questions to its technical round. The
    voice agent (ElevenLabs) receives them via dynamic_variables so the
    Conversational AI agent's prompt template (configured in the
    ElevenLabs console — operator action) can reference them.

    Per-question scoring uses expected_keywords (overlap × weight) and
    optionally an expected_answer_summary as a reference.
    """
    __tablename__ = "job_interview_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)

    question_text = Column(Text, nullable=False)
    question_type = Column(String, default="behavioural")
    # behavioural | technical | situational | culture_fit | custom

    order_index = Column(Integer, default=0)
    is_required = Column(Boolean, default=False)
    weight = Column(Integer, default=3)  # 1-5
    expected_keywords = Column(Text, default="[]")  # JSON array of strings
    expected_answer_summary = Column(Text, default="")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_job_interview_questions_job_order", "job_id", "order_index"),
    )


class Tag(Base):
    """Tenant-scoped candidate tag.

    Feature 2 of ENTERPRISE_FEATURES.md. Distinct from profile_skills
    (auto LLM tags) — these are manually applied by HR for filtering and
    bulk operations. Names are unique per tenant (case-sensitive on
    storage, case-insensitive on lookup is the UI's job)."""
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    color = Column(String, default="indigo")  # palette key, not raw hex
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_tags_tenant_name"),
        Index("idx_tags_tenant", "tenant_id"),
    )


class CandidateTag(Base):
    """Many-to-many link between candidates and tags.

    Composite primary key (candidate_id, tag_id) — same tag can't be
    applied to the same candidate twice. ORM-level cascade on candidate
    delete is enforced by the relationship; tag delete cascade is
    enforced via DB DELETE CASCADE in the migration.
    """
    __tablename__ = "candidate_tags"

    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)
    applied_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    applied_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_candidate_tags_tag", "tag_id"),
    )


class ResumeFraudSignal(Base):
    """One row per fraud signal detected in a candidate's resume.

    Feature 1 of ENTERPRISE_FEATURES.md. Detector runs on PDF/DOCX bytes
    and emits zero or more signals; each is persisted here so HR can
    audit AND so the timeline shows exactly what was flagged.

    Severity weighting feeds Application.fraud_score:
      critical=40, high=20, medium=10, low=5  (capped at 100)
    Any 'critical' signal sets Application.fraud_blocked=True and the
    workflow skips LLM scoring until an owner manually overrides.
    """
    __tablename__ = "resume_fraud_signals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False, index=True)
    cv_version_id = Column(Integer, ForeignKey("candidate_cv_versions.id"), nullable=True)

    signal_type = Column(String, nullable=False, index=True)
    # hidden_text_color | microtext | offpage_text | transparent_text |
    # behind_image | prompt_injection | duplicate_content_glyph
    severity = Column(String, nullable=False)  # low | medium | high | critical
    evidence_json = Column(Text, default="{}")  # JSON-as-text for portability
    detected_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    application = relationship("Application", back_populates="fraud_signals")


class CandidateCvVersion(Base):
    """Archive of a candidate's prior CV every time it's replaced.

    When a re-upload bumps cv_version, we snapshot the old resume_text +
    filename + extracted_at into this table BEFORE overwriting. Lets HR
    diff between versions and recover the previous resume for context."""
    __tablename__ = "candidate_cv_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    filename = Column(String, default="")
    resume_text = Column(Text, default="")
    source = Column(String, default="manual_upload")  # email | manual_upload | imported | api
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    candidate = relationship("Candidate", back_populates="cv_versions")


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id"), nullable=False)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False)
    stage = Column(String, default="new")  # legacy string stage — kept for back-compat
    # Feature 3: pointer to a PipelineStage row. Populated when the
    # application's job uses a custom template; nullable for old apps.
    current_stage_id = Column(Integer, ForeignKey("pipeline_stages.id"), nullable=True, index=True)
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

    # Resume fraud detection (Feature 1).
    # 0-100, higher = more suspicious. >=20 surfaces a yellow banner; any
    # critical signal sets fraud_blocked=True so the LLM scorer is skipped.
    fraud_score = Column(Integer, default=0)
    fraud_flags_count = Column(Integer, default=0)
    fraud_blocked = Column(Boolean, default=False)
    # Owner override — non-null when an owner manually unblocks an app.
    fraud_overridden_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    fraud_override_reason = Column(Text, default="")
    fraud_overridden_at = Column(DateTime, nullable=True)

    candidate = relationship("Candidate", back_populates="applications")
    job = relationship("Job", back_populates="applications")
    events = relationship("Event", back_populates="application")
    interview_links = relationship("InterviewLink", back_populates="application")
    fraud_signals = relationship(
        "ResumeFraudSignal",
        back_populates="application",
        cascade="all, delete-orphan",
    )

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
    # Recruiter who triggered this event. Nullable for system-generated
    # events (auto-pipeline, listeners) and for the historical rows that
    # predate Feature 5. Drives /reports/recruiters productivity metrics.
    actioned_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    application = relationship("Application", back_populates="events")

    __table_args__ = (
        Index("idx_events_app", "app_id"),
        Index("idx_events_actor_created", "actioned_by_user_id", "created_at"),
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
