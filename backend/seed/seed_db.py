"""Seed the database with sample data for development/demo."""
import sys
import os
import json
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal, init_db
from models import Job, Email, Candidate, Application, Event
from services.email_service import load_sample_inbox


def seed():
    init_db()
    db = SessionLocal()

    try:
        # 1. Load sample emails
        print("Loading sample emails...")
        load_sample_inbox(db)
        email_count = db.query(Email).count()
        print(f"  {email_count} emails loaded")

        # 2. Create sample jobs
        print("Creating sample jobs...")
        jobs_data = [
            {
                "job_id": "JOB-2026-001",
                "title": "Data Analyst",
                "department": "Analytics",
                "location": "Singapore",
                "seniority": "mid",
                "skills": json.dumps(["SQL", "Power BI", "Python", "Data cleaning", "Statistics"]),
                "description": "We are looking for a Data Analyst to join our analytics team. You will build dashboards, write SQL queries, and deliver data-driven insights to stakeholders.",
            },
            {
                "job_id": "JOB-2026-002",
                "title": "Software Engineer",
                "department": "Engineering",
                "location": "San Francisco",
                "seniority": "senior",
                "skills": json.dumps(["React", "TypeScript", "Node.js", "AWS", "PostgreSQL", "Docker"]),
                "description": "Join our engineering team to build scalable web applications. You will work on frontend and backend systems serving millions of users.",
            },
            {
                "job_id": "JOB-2026-003",
                "title": "Product Manager",
                "department": "Product",
                "location": "New York",
                "seniority": "senior",
                "skills": json.dumps(["Product Strategy", "User Research", "Agile", "SQL", "Data Analytics"]),
                "description": "Lead product strategy and execution for our core platform. You will work closely with engineering, design, and business teams.",
            },
            {
                "job_id": "JOB-2026-004",
                "title": "UX Designer",
                "department": "Design",
                "location": "Singapore",
                "seniority": "mid",
                "skills": json.dumps(["Figma", "User Research", "Design Systems", "Prototyping", "Usability Testing"]),
                "description": "Design intuitive user experiences for our products. You will conduct user research, create wireframes, and build design systems.",
            },
            {
                "job_id": "JOB-2026-005",
                "title": "DevOps Engineer",
                "department": "Infrastructure",
                "location": "Remote",
                "seniority": "senior",
                "skills": json.dumps(["Kubernetes", "Terraform", "AWS", "CI/CD", "Docker", "Monitoring"]),
                "description": "Build and maintain our cloud infrastructure. You will implement CI/CD pipelines, manage Kubernetes clusters, and ensure 99.99% uptime.",
            },
        ]

        for jd in jobs_data:
            existing = db.query(Job).filter(Job.job_id == jd["job_id"]).first()
            if not existing:
                db.add(Job(**jd))
        db.commit()
        print(f"  {db.query(Job).count()} jobs created")

        # 3. Create candidates from application emails
        print("Creating candidates from emails...")
        app_emails = db.query(Email).filter(Email.classified_as == "candidate_application").all()
        if not app_emails:
            # Classify first
            from agents.email_classifier import classify_email, EmailClassifierInput
            import asyncio
            all_emails = db.query(Email).filter(Email.classified_as.is_(None)).all()
            for em in all_emails:
                attachments = json.loads(em.attachments) if em.attachments else []
                attachment_names = [a.get("filename", "") for a in attachments]
                input_data = EmailClassifierInput(
                    subject=em.subject,
                    from_name=em.from_name,
                    from_email=em.from_address,
                    attachment_names=attachment_names,
                    body_text=em.body_snippet,
                )
                output = asyncio.get_event_loop().run_until_complete(classify_email(input_data))
                em.classified_as = output.category
                em.confidence = output.confidence
                em.classification = json.dumps({
                    "category": output.category,
                    "confidence": output.confidence,
                    "reasoning": output.reasoning,
                    "detected_name": output.detected_name,
                    "detected_role": output.detected_role,
                })
                em.processed = 1
            db.commit()
            app_emails = db.query(Email).filter(Email.classified_as == "candidate_application").all()

        candidates_created = []
        for em in app_emails:
            if em.processed >= 2:
                continue
            classification = json.loads(em.classification) if em.classification else {}
            name = classification.get("detected_name", "") or em.from_name or em.from_address.split("@")[0].replace(".", " ").title()
            candidate = Candidate(
                name=name,
                email=em.from_address,
                phone="",
                resume_text=em.body_full or em.body_snippet,
                resume_filename=json.loads(em.attachments)[0].get("filename", "") if em.attachments and json.loads(em.attachments) else "",
                source_email_id=em.id,
            )
            db.add(candidate)
            em.processed = 2
            candidates_created.append(candidate)

        db.commit()
        for c in candidates_created:
            db.refresh(c)
        print(f"  {len(candidates_created)} candidates created")

        # 4. Create applications with various stages
        print("Creating applications...")
        all_candidates = db.query(Candidate).all()
        all_jobs = db.query(Job).all()

        stages_cycle = ["matched", "matched", "screening_scheduled", "screened", "shortlisted", "matched", "rejected", "screened", "matched", "matched"]
        scores = [82.5, 75.0, 68.0, 91.3, 88.5, 55.0, 42.0, 79.2, 71.5, 63.0]
        recommendations = ["advance", "advance", "hold", "advance", "advance", "hold", "reject", "advance", "advance", "hold"]

        for i, candidate in enumerate(all_candidates):
            job = all_jobs[i % len(all_jobs)]
            existing = db.query(Application).filter(
                Application.candidate_id == candidate.id,
                Application.job_id == job.id,
            ).first()
            if existing:
                continue

            stage = stages_cycle[i % len(stages_cycle)]
            score = scores[i % len(scores)]
            rec = recommendations[i % len(recommendations)]

            app = Application(
                candidate_id=candidate.id,
                job_id=job.id,
                stage=stage,
                resume_score=score,
                resume_score_json=json.dumps({
                    "score": score,
                    "evidence": [f"Strong match for {job.title}", "Relevant experience", "Good skill alignment"],
                    "gaps": ["Could improve in some areas"],
                    "risks": ["Minor concerns"],
                    "recommendation": rec,
                    "screening_questions": [
                        f"Tell me about your experience relevant to {job.title}",
                        "What interests you about this role?",
                        "Describe a challenging project",
                    ],
                    "summary": f"Candidate scores {score}/100 for {job.title}.",
                }),
                recommendation=rec,
                ai_next_action="Schedule voice screening" if rec == "advance" else "Review manually" if rec == "hold" else "Send rejection",
                ai_snippets=json.dumps({
                    "why_shortlisted": ["Strong skill match", "Relevant experience", "Good cultural fit indicators"],
                    "key_strengths": ["Technical proficiency", "Communication skills", "Problem-solving ability"],
                    "main_gaps": ["Some skill gaps to address", "Could use more leadership experience"],
                    "interview_focus": ["Technical depth", "Team collaboration", "Career motivation"],
                }),
            )

            # Add interview data for screened/shortlisted candidates
            if stage in ("screened", "shortlisted"):
                interview_score = score * 0.7 + 20
                app.interview_score = round(interview_score, 1)
                app.interview_score_json = json.dumps({
                    "score": round(interview_score, 1),
                    "decision": "advance" if interview_score >= 70 else "hold",
                    "strengths": ["Good communicator", "Relevant experience", "Enthusiastic"],
                    "concerns": ["Could improve technical depth"],
                    "communication_rating": "good",
                    "technical_depth": "adequate",
                    "cultural_fit": "strong",
                    "email_draft": f"Dear {candidate.name}, thank you for the screening...",
                    "scheduling_slots": ["Mon 10AM", "Tue 2PM", "Wed 11AM"],
                    "summary": f"Interview score: {round(interview_score, 1)}/100",
                })
                app.screening_transcript = f"Voice Screening Transcript - {candidate.name}\nPosition: {job.title}\n{'='*50}\n\nQ: Tell me about yourself\nA: I have extensive experience in {job.title} related work...\n\nQ: Why this role?\nA: I'm passionate about the work your team is doing..."

            db.add(app)

        db.commit()
        print(f"  {db.query(Application).count()} applications total")

        # 5. Create events
        print("Creating events...")
        all_apps = db.query(Application).all()
        for app in all_apps:
            event = Event(
                app_id=app.id,
                event_type="matched",
                payload=json.dumps({"resume_score": app.resume_score}),
                created_at=app.created_at,
            )
            db.add(event)
            if app.stage in ("screened", "shortlisted"):
                event2 = Event(
                    app_id=app.id,
                    event_type="screened",
                    payload=json.dumps({"interview_score": app.interview_score}),
                    created_at=app.created_at + timedelta(hours=2),
                )
                db.add(event2)
        db.commit()
        print(f"  {db.query(Event).count()} events created")

        print("\nSeed complete!")

    finally:
        db.close()


if __name__ == "__main__":
    seed()
