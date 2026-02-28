from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime

# ═══════════════════════════════════════
# COMMON
# ═══════════════════════════════════════

PipelineStage = Literal[
    "new", "classified", "matched",
    "screening_scheduled", "screened",
    "shortlisted", "rejected"
]


# ═══════════════════════════════════════
# JOBS
# ═══════════════════════════════════════

class JobCreate(BaseModel):
    title: str
    department: str = ""
    location: str = ""
    seniority: str = ""
    skills: List[str] = []
    description: str = ""


class JobUpdate(BaseModel):
    title: Optional[str] = None
    department: Optional[str] = None
    location: Optional[str] = None
    seniority: Optional[str] = None
    skills: Optional[List[str]] = None
    description: Optional[str] = None
    status: Optional[str] = None


class JobResponse(BaseModel):
    id: int
    job_id: str
    title: str
    department: str
    location: str
    seniority: str
    skills: List[str]
    description: str
    status: str
    created_at: datetime
    updated_at: datetime
    candidate_count: int = 0

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    jobs: List[JobResponse]
    total: int


# ═══════════════════════════════════════
# EMAILS
# ═══════════════════════════════════════

class InboxConnectRequest(BaseModel):
    mode: Literal["sample", "imap"]
    imap_host: str = ""
    imap_port: int = 993
    imap_user: str = ""
    imap_pass: str = ""
    imap_ssl: bool = True


class EmailResponse(BaseModel):
    id: int
    message_id: Optional[str]
    from_address: str
    from_name: str
    subject: str
    body_snippet: str
    attachments: List[dict]
    classified_as: Optional[str]
    confidence: Optional[float]
    processed: int
    received_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class InboxSyncResponse(BaseModel):
    synced_count: int
    new_emails: List[EmailResponse]


class InboxClassifyResponse(BaseModel):
    classified_count: int
    results: List[dict]


# ═══════════════════════════════════════
# CANDIDATES
# ═══════════════════════════════════════

class CandidateCreate(BaseModel):
    name: str
    email: str
    phone: str = ""
    resume_text: str = ""
    source_email_id: Optional[int] = None


class CandidateResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: str
    resume_text: str
    resume_filename: str
    source_email_id: Optional[int]
    notes: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CandidateFromEmailResponse(BaseModel):
    candidate: CandidateResponse
    resume_extracted: bool
    resume_length: int


# ═══════════════════════════════════════
# APPLICATIONS
# ═══════════════════════════════════════

class ApplicationResponse(BaseModel):
    id: int
    candidate_id: int
    candidate_name: str
    candidate_email: str
    candidate_phone: str
    job_id: int
    job_title: str
    job_code: str
    stage: str
    resume_score: Optional[float]
    interview_score: Optional[float]
    recommendation: Optional[str]
    ai_next_action: Optional[str]
    ai_snippets: Optional[dict]
    screening_transcript: Optional[str]
    resume_score_json: Optional[dict]
    interview_score_json: Optional[dict]
    created_at: datetime
    updated_at: datetime


class ApplicationListResponse(BaseModel):
    applications: List[ApplicationResponse]
    total: int
    page: int
    per_page: int


class ApplicationStageUpdate(BaseModel):
    stage: PipelineStage


class ApplicationNotesUpdate(BaseModel):
    notes: str


class ApplicationMatchRequest(BaseModel):
    candidate_id: int
    job_id: int


class ApplicationMatchResponse(BaseModel):
    application: ApplicationResponse
    resume_score_details: dict


class BulkStageUpdate(BaseModel):
    application_ids: List[int]
    stage: PipelineStage


# ═══════════════════════════════════════
# SCREENING
# ═══════════════════════════════════════

class ScreeningStartRequest(BaseModel):
    app_id: int


class ScreeningStartResponse(BaseModel):
    app_id: int
    status: str
    questions: List[str]


class ScreeningTranscriptRequest(BaseModel):
    app_id: int
    transcript: str


class ScreeningEvaluateResponse(BaseModel):
    app_id: int
    interview_score: float
    decision: str
    strengths: List[str]
    concerns: List[str]
    email_draft: str
    scheduling_slots: List[str]
    summary: str


# ═══════════════════════════════════════
# REPORTS
# ═══════════════════════════════════════

class FunnelStage(BaseModel):
    stage: str
    count: int
    percentage: float


class FunnelResponse(BaseModel):
    job_id: Optional[int]
    job_title: Optional[str]
    stages: List[FunnelStage]
    total: int


class TopCandidateResponse(BaseModel):
    candidate_id: int
    candidate_name: str
    candidate_email: str
    job_title: str
    job_code: str
    resume_score: Optional[float]
    interview_score: Optional[float]
    combined_score: float
    recommendation: Optional[str]
    stage: str


class ReportSummaryResponse(BaseModel):
    total_jobs: int
    total_candidates: int
    total_applications: int
    active_screenings: int
    avg_resume_score: float
    shortlisted_count: int
    rejected_count: int
    stage_distribution: List[FunnelStage]
    top_candidates: List[TopCandidateResponse]


# ═══════════════════════════════════════
# ELEVENLABS WEBHOOK
# ═══════════════════════════════════════

class ElevenLabsTranscriptTurn(BaseModel):
    role: str
    message: str
    time_in_call_secs: float = 0


class ElevenLabsWebhookData(BaseModel):
    agent_id: str
    conversation_id: str
    status: str = ""
    transcript: List[ElevenLabsTranscriptTurn] = []
    metadata: dict = {}
    analysis: dict = {}


class ElevenLabsWebhookPayload(BaseModel):
    type: str  # post_call_transcription / post_call_audio / call_initiation_failure
    event_timestamp: int
    data: dict
