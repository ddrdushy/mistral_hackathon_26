from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Float, DateTime, ForeignKey, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from database import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String, unique=True, nullable=False)  # JOB-YYYY-NNN
    title = Column(String, nullable=False)
    department = Column(String, default="")
    location = Column(String, default="")
    seniority = Column(String, default="")  # junior/mid/senior/lead
    skills = Column(Text, default="[]")  # JSON array
    description = Column(Text, default="")
    status = Column(String, default="open")  # open/closed/paused
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    applications = relationship("Application", back_populates="job")


class Email(Base):
    __tablename__ = "emails"

    id = Column(Integer, primary_key=True, autoincrement=True)
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
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, default="")
    resume_text = Column(Text, default="")
    resume_filename = Column(String, default="")
    source_email_id = Column(Integer, ForeignKey("emails.id"), nullable=True)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    source_email = relationship("Email", back_populates="candidate")
    applications = relationship("Application", back_populates="candidate")


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, autoincrement=True)
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
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=True)
    event_type = Column(String, nullable=False)
    payload = Column(Text, default="{}")  # JSON
    created_at = Column(DateTime, default=datetime.utcnow)

    application = relationship("Application", back_populates="events")

    __table_args__ = (
        Index("idx_events_app", "app_id"),
    )


class InterviewLink(Base):
    __tablename__ = "interview_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String, unique=True, nullable=False, index=True)
    app_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    status = Column(String, default="generated")  # generated/sent/opened/interview_started/interview_completed/expired
    elevenlabs_conversation_id = Column(String, nullable=True)
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
