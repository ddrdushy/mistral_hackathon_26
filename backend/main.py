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
from app_limiter import limiter
from routers import inbox, jobs, candidates, applications, screening, reports, settings, auth, admin, team, billing

logger = logging.getLogger("hireops")

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


@app.on_event("startup")
async def on_startup():
    init_db()

    # Auto-restore Gmail connection from saved credentials
    try:
        from services.gmail_service import gmail_manager
        restored = gmail_manager.restore_from_db()
        if restored and gmail_manager._auto_start_listener:
            # Small delay to let the event loop fully initialize
            await asyncio.sleep(1)
            gmail_manager.start_idle_listener()
            logger.info("Gmail IDLE listener auto-started on boot")
    except Exception as e:
        logger.warning(f"Gmail auto-restore failed: {e}")


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
