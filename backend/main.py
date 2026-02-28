"""HireOps AI — FastAPI Backend Entry Point."""
import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import inbox, jobs, candidates, applications, screening, reports, settings

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
def on_startup():
    init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0", "service": "hireops-ai"}


@app.get("/api/v1/health")
async def api_health():
    return {"status": "ok", "version": "1.0.0", "service": "hireops-ai"}
