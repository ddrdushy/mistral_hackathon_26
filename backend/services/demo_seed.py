"""
Seed a fresh tenant with sample jobs, candidates, and applications so the
dashboard isn't empty on first login.

Idempotent — only seeds when the tenant has zero existing jobs. Tagged via
Job.description prefix "[DEMO]" so HR can clear them later.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import List

from sqlalchemy.orm import Session

from models import Tenant, Job, Candidate, Application, Event

DEMO_MARKER = "[DEMO]"


SAMPLE_JOBS = [
    {
        "title": "Senior Frontend Engineer",
        "department": "Engineering",
        "location": "Remote",
        "seniority": "senior",
        "skills": ["React", "TypeScript", "Next.js", "Tailwind CSS", "Jest"],
        "responsibilities": [
            "Build and maintain responsive web applications using React and TypeScript",
            "Implement pixel-perfect UI components from Figma designs",
            "Write comprehensive unit and integration tests with Jest",
            "Collaborate with UX designers and backend engineers",
        ],
        "qualifications": [
            "5+ years of professional frontend development",
            "Deep React + TypeScript expertise",
            "Strong understanding of accessibility and performance",
        ],
        "description": f"{DEMO_MARKER} We're hiring a senior frontend engineer to lead our web platform.",
    },
    {
        "title": "Data Analyst",
        "department": "Data & Analytics",
        "location": "Hybrid",
        "seniority": "mid",
        "skills": ["SQL", "Power BI", "Python", "Excel"],
        "responsibilities": [
            "Build dashboards in Power BI for business stakeholders",
            "Write SQL queries to investigate product and revenue questions",
            "Automate reporting using Python and scheduled jobs",
        ],
        "qualifications": [
            "3+ years of experience in analytics or BI",
            "Expert SQL skills",
            "Strong communication and stakeholder management",
        ],
        "description": f"{DEMO_MARKER} Looking for a data analyst to embed with our product team.",
    },
]


SAMPLE_CANDIDATES = [
    {
        "name": "Priya Kumar",
        "email": "priya.k@example.com",
        "phone": "+1 555 0101",
        "resume_text": (
            "Senior frontend engineer with 6 years of experience. "
            "Led the rebuild of a SaaS dashboard at Acme using React, TypeScript, "
            "Next.js and Tailwind. Strong testing discipline (Jest, Playwright). "
            "Mentored a team of 4 junior engineers."
        ),
        "match_job_idx": 0,  # Senior Frontend
        "resume_score": 87,
        "stage": "screened",
        "recommendation": "advance",
    },
    {
        "name": "Marcus Chen",
        "email": "marcus.chen@example.com",
        "phone": "+1 555 0102",
        "resume_text": (
            "Data analyst with 4 years experience at fintech startups. "
            "Heavy Power BI and SQL work. Built executive dashboards covering "
            "revenue, retention, and ops metrics. Some Python automation."
        ),
        "match_job_idx": 1,  # Data Analyst
        "resume_score": 78,
        "stage": "matched",
        "recommendation": "advance",
    },
    {
        "name": "Aisha Patel",
        "email": "aisha.patel@example.com",
        "phone": "+1 555 0103",
        "resume_text": (
            "Junior frontend developer with 2 years experience. Comfortable with "
            "React basics; learning TypeScript. Solid CSS and HTML."
        ),
        "match_job_idx": 0,  # Senior Frontend (mismatch — too junior)
        "resume_score": 52,
        "stage": "matched",
        "recommendation": "hold",
    },
    {
        "name": "Daniel O'Brien",
        "email": "daniel.obrien@example.com",
        "phone": "+1 555 0104",
        "resume_text": (
            "Marketing manager pivoting into data. Familiar with Google Analytics "
            "and basic SQL. No production analytics experience yet."
        ),
        "match_job_idx": 1,  # Data Analyst
        "resume_score": 35,
        "stage": "rejected",
        "recommendation": "reject",
    },
    {
        "name": "Sofia García",
        "email": "sofia.garcia@example.com",
        "phone": "+1 555 0105",
        "resume_text": (
            "Senior fullstack engineer (8 years). Heavy React and TypeScript. "
            "Built design systems at two scale-ups. Open to frontend-leaning roles."
        ),
        "match_job_idx": 0,  # Senior Frontend
        "resume_score": 91,
        "stage": "shortlisted",
        "recommendation": "advance",
    },
]


def seed_tenant(db: Session, tenant: Tenant) -> dict:
    """Seed sample data into a tenant. Idempotent — does nothing if the tenant
    already has any jobs.
    """
    existing = db.query(Job).filter(Job.tenant_id == tenant.id).count()
    if existing > 0:
        return {"seeded": False, "reason": "tenant already has jobs"}

    # Insert jobs
    jobs: List[Job] = []
    year = datetime.utcnow().year
    for i, jdata in enumerate(SAMPLE_JOBS):
        job = Job(
            tenant_id=tenant.id,
            job_id=f"DEMO-{year}-{i+1:03d}",
            title=jdata["title"],
            department=jdata["department"],
            location=jdata["location"],
            seniority=jdata["seniority"],
            skills=json.dumps(jdata["skills"]),
            responsibilities=json.dumps(jdata["responsibilities"]),
            qualifications=json.dumps(jdata["qualifications"]),
            description=jdata["description"],
            status="open",
        )
        db.add(job)
        jobs.append(job)
    db.flush()

    # Insert candidates + applications
    apps_created = 0
    for cdata in SAMPLE_CANDIDATES:
        candidate = Candidate(
            tenant_id=tenant.id,
            name=cdata["name"],
            email=cdata["email"],
            phone=cdata["phone"],
            resume_text=cdata["resume_text"],
            resume_filename="resume.pdf",
            notes="",
        )
        db.add(candidate)
        db.flush()

        job = jobs[cdata["match_job_idx"]]
        skills_list = json.loads(job.skills) if job.skills else []
        application = Application(
            tenant_id=tenant.id,
            candidate_id=candidate.id,
            job_id=job.id,
            stage=cdata["stage"],
            resume_score=cdata["resume_score"],
            resume_score_json=json.dumps({
                "score": cdata["resume_score"],
                "evidence": [
                    f"Strong skill alignment: {', '.join(skills_list[:2])}",
                    "Relevant experience for the role",
                ],
                "gaps": ["Could provide more depth on architecture"],
                "risks": [],
                "recommendation": cdata["recommendation"],
                "screening_questions": [
                    "Walk us through a recent project most similar to this role.",
                    "What's the most challenging technical decision you've made recently?",
                ],
                "summary": f"Resume scored {cdata['resume_score']}/100 against {job.title}.",
            }),
            recommendation=cdata["recommendation"],
            ai_next_action=(
                "Schedule screening" if cdata["recommendation"] == "advance"
                else "Manual review" if cdata["recommendation"] == "hold"
                else "Send rejection"
            ),
            ai_snippets=json.dumps({
                "why_shortlisted": ["Strong skill match", "Relevant experience"],
                "key_strengths": skills_list[:3],
                "main_gaps": [],
                "interview_focus": ["Verify hands-on depth", "Cultural fit"],
            }),
            created_at=datetime.utcnow() - timedelta(hours=apps_created * 2 + 1),
            updated_at=datetime.utcnow() - timedelta(minutes=apps_created * 30),
        )
        db.add(application)
        apps_created += 1

    db.commit()
    return {"seeded": True, "jobs": len(SAMPLE_JOBS), "candidates": len(SAMPLE_CANDIDATES)}


def clear_demo(db: Session, tenant: Tenant) -> dict:
    """Remove demo jobs/candidates/applications (anything tagged with DEMO_MARKER)."""
    demo_jobs = db.query(Job).filter(
        Job.tenant_id == tenant.id,
        Job.description.like(f"{DEMO_MARKER}%"),
    ).all()
    job_ids = [j.id for j in demo_jobs]

    if not job_ids:
        return {"cleared": False, "reason": "no demo data"}

    # Delete applications + their candidates first
    apps = db.query(Application).filter(
        Application.tenant_id == tenant.id,
        Application.job_id.in_(job_ids),
    ).all()
    candidate_ids = [a.candidate_id for a in apps]
    app_ids = [a.id for a in apps]

    db.query(Event).filter(Event.app_id.in_(app_ids)).delete(synchronize_session="fetch")
    db.query(Application).filter(Application.id.in_(app_ids)).delete(synchronize_session="fetch")
    db.query(Candidate).filter(
        Candidate.id.in_(candidate_ids),
        Candidate.tenant_id == tenant.id,
    ).delete(synchronize_session="fetch")
    db.query(Job).filter(Job.id.in_(job_ids)).delete(synchronize_session="fetch")
    db.commit()
    return {"cleared": True, "jobs": len(job_ids), "candidates": len(candidate_ids), "applications": len(app_ids)}
