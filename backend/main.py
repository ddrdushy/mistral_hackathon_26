"""HireOps AI — FastAPI Backend Entry Point."""
import os
import asyncio
import logging
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import inbox, jobs, candidates, applications, screening, reports, settings

logger = logging.getLogger("hireops")

app = FastAPI(
    title="HireOps AI",
    description="Agentic HR Automation Platform API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
