"""HireOps AI — FastAPI Backend Entry Point."""
import os
import asyncio
import logging
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from database import init_db

# Merge DB-stored global secrets (Mistral / ElevenLabs keys managed by the
# superadmin via the UI) into os.environ BEFORE any router or agent module
# imports — those modules cache env values at import time.
from services.secrets import apply_db_secrets_to_env
_secret_sources = apply_db_secrets_to_env()

from app_limiter import limiter
from routers import inbox, jobs, candidates, applications, screening, reports, settings, auth, admin, team, billing, testimonials, metrics, talent, integrations, communications, calls, audit, tags, interview_questions, offer_templates, offers

logger = logging.getLogger("hireops")
logger.info("Global secrets sources: %s", _secret_sources)

# ── Sentry ────────────────────────────────────────────────────────────────
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
if SENTRY_DSN:
    import sentry_sdk
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        environment=os.getenv("ENV", "development"),
        send_default_pii=False,  # don't send IPs / cookies
    )
    logger.info("Sentry initialised")


app = FastAPI(
    title="HireOps AI",
    description="Agentic HR Automation Platform API",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: build the allow-list from env (FRONTEND_URL) plus dev defaults.
# Cookies require allow_credentials=True, which means we cannot use "*".
_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://dushy2009-hireops-ai.hf.space",
]
_extra = os.getenv("FRONTEND_URL", "").rstrip("/")
if _extra and _extra not in _origins:
    _origins.append(_extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(team.public_router)  # /auth/invite/{token}, /auth/accept-invite
app.include_router(team.router)
app.include_router(admin.router)
app.include_router(billing.public_router)  # /billing/webhook (signature-verified)
app.include_router(billing.router)
app.include_router(inbox.router)
app.include_router(jobs.router)
app.include_router(candidates.router)
app.include_router(applications.router)
app.include_router(screening.router)
app.include_router(reports.router)
app.include_router(settings.router)
app.include_router(testimonials.router)
app.include_router(metrics.router)
app.include_router(talent.router)
app.include_router(talent.jobs_router)
app.include_router(integrations.router)
app.include_router(communications.router)
app.include_router(calls.router)
app.include_router(audit.router)
app.include_router(tags.router)
app.include_router(tags.candidate_tags_router)
app.include_router(interview_questions.router)
app.include_router(offer_templates.router)
app.include_router(offers.router)
app.include_router(offers.app_offers_router)


@app.on_event("startup")
async def on_startup():
    init_db()

    # Auto-restore Gmail OAuth connection (legacy single-account path)
    try:
        from services.gmail_service import gmail_manager
        restored = gmail_manager.restore_from_db()
        if restored and gmail_manager._auto_start_listener:
            await asyncio.sleep(1)
            gmail_manager.start_idle_listener()
            logger.info("Gmail IDLE listener auto-started on boot")
    except Exception as e:
        logger.warning(f"Gmail auto-restore failed: {e}")

    # Spawn a per-MailAccount poller for every connected tenant mailbox.
    # New emails get pulled + classified automatically every ~20s — no manual
    # Sync clicks needed.
    try:
        from services import mailbox_listener
        await mailbox_listener.start_all_existing()
    except Exception as e:
        logger.warning(f"Mailbox listener startup failed: {e}")

    # One-shot backfill: classify any pre-existing unprocessed emails (e.g.
    # mail that arrived via the legacy Gmail listener before this code shipped).
    # Runs in background so startup isn't blocked by classifier latency.
    try:
        from services import mailbox_listener
        asyncio.create_task(mailbox_listener.backfill_unclassified(limit=200))
    except Exception as e:
        logger.warning(f"Backfill kickoff failed: {e}")

    # Phone queue worker — polls call_queue every 30s and dispatches due
    # outbound calls via Twilio. One worker per backend process.
    try:
        from services import call_queue
        await call_queue.start_worker()
    except Exception as e:
        logger.warning(f"Call queue worker startup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    try:
        from services import mailbox_listener
        await mailbox_listener.stop_all()
    except Exception as e:
        logger.warning(f"Mailbox listener shutdown failed: {e}")
    try:
        from services import call_queue
        await call_queue.stop_worker()
    except Exception as e:
        logger.warning(f"Call queue worker shutdown failed: {e}")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0", "service": "hireops-ai"}


@app.get("/api/v1/health")
async def api_health():
    return {"status": "ok", "version": "1.0.0", "service": "hireops-ai"}


@app.get("/api/v1/health/db")
async def api_health_db():
    """Verify the DB connection is alive. Returns 503 on failure."""
    from sqlalchemy import text
    from database import engine
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "service": "db"}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=f"db unhealthy: {e}")


@app.get("/api/v1/health/llm")
async def api_health_llm():
    """Verify the Mistral API key is set and the SDK loads. Doesn't make a real call."""
    if not os.getenv("MISTRAL_API_KEY"):
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="MISTRAL_API_KEY not configured")
    try:
        import mistralai  # noqa: F401
        return {"status": "ok", "service": "llm", "key_configured": True}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=f"mistral sdk error: {e}")
