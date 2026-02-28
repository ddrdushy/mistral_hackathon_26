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
    from models import Job, Email, Candidate, Application, Event, InterviewLink, Setting  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _run_migrations()


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

    # Job threshold columns
    job_cols = {
        "resume_threshold_min": "FLOAT DEFAULT 80.0",
        "interview_threshold_min": "FLOAT DEFAULT 75.0",
        "final_threshold_reject": "FLOAT DEFAULT 50.0",
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
