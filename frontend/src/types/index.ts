// ═══════════════════════════════════════
// JOBS
// ═══════════════════════════════════════
export interface Job {
  id: number;
  job_id: string;
  title: string;
  department: string;
  location: string;
  seniority: string;
  skills: string[];
  responsibilities: string[];
  qualifications: string[];
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  candidate_count: number;
}

export interface JobListResponse {
  jobs: Job[];
  total: number;
}

export interface JobCreate {
  title: string;
  department: string;
  location: string;
  seniority: string;
  skills: string[];
  responsibilities: string[];
  qualifications: string[];
  description: string;
}

// ═══════════════════════════════════════
// EMAILS
// ═══════════════════════════════════════
export interface EmailAttachment {
  filename: string;
  content_type: string;
  size: number;
}

export interface Email {
  id: number;
  message_id: string | null;
  from_address: string;
  from_name: string;
  subject: string;
  body_snippet: string;
  attachments: EmailAttachment[];
  classified_as: string | null;
  confidence: number | null;
  processed: number;
  received_at: string | null;
  created_at: string;
}

export interface EmailListResponse {
  emails: Email[];
  total: number;
  page: number;
  per_page: number;
}

// ═══════════════════════════════════════
// CANDIDATES
// ═══════════════════════════════════════
export interface Candidate {
  id: number;
  name: string;
  email: string;
  phone: string;
  resume_text: string;
  resume_filename: string;
  source_email_id: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════
// APPLICATIONS
// ═══════════════════════════════════════
export interface AISnippets {
  why_shortlisted: string[];
  key_strengths: string[];
  main_gaps: string[];
  interview_focus: string[];
}

export interface ResumeScoreDetails {
  score: number;
  evidence: string[];
  gaps: string[];
  risks: string[];
  recommendation: string;
  screening_questions: string[];
  summary: string;
}

export interface InterviewScoreDetails {
  score: number;
  decision: string;
  strengths: string[];
  concerns: string[];
  communication_rating: string;
  technical_depth: string;
  cultural_fit: string;
  email_draft: string;
  scheduling_slots: string[];
  candidate_preferred_slot: string | null;
  summary: string;
}

export interface Application {
  id: number;
  candidate_id: number;
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string;
  job_id: number;
  job_title: string;
  job_code: string;
  stage: string;
  resume_score: number | null;
  interview_score: number | null;
  recommendation: string | null;
  ai_next_action: string | null;
  ai_snippets: AISnippets | null;
  screening_transcript: string | null;
  screening_status: string | null;
  screening_attempts: number;
  screening_max_attempts: number;
  screening_failure_reason: string | null;
  screening_last_attempt_at: string | null;
  interview_link_status: string | null;
  interview_face_tracking_json: {
    avg_attention_score: number;
    face_present_percentage: number;
    total_snapshots: number;
  } | null;
  resume_score_json: ResumeScoreDetails | null;
  interview_score_json: InterviewScoreDetails | null;
  scheduled_interview_at: string | null;
  scheduled_interview_slot: string | null;
  email_draft_sent: number;
  final_score: number | null;
  final_summary: string | null;
  thresholds: {
    resume_min: number;
    interview_min: number;
    reject_below: number;
  };
  created_at: string;
  updated_at: string;
}

export interface ApplicationListResponse {
  applications: Application[];
  total: number;
  page: number;
  per_page: number;
}

// ═══════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════
export interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
}

export interface TopCandidate {
  candidate_id: number;
  candidate_name: string;
  candidate_email: string;
  job_title: string;
  job_code: string;
  resume_score: number | null;
  interview_score: number | null;
  combined_score: number;
  recommendation: string | null;
  stage: string;
}

export interface ReportSummary {
  total_jobs: number;
  total_candidates: number;
  total_applications: number;
  active_screenings: number;
  avg_resume_score: number;
  shortlisted_count: number;
  rejected_count: number;
  stage_distribution: FunnelStage[];
  top_candidates: TopCandidate[];
}

export interface ActivityEvent {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  candidate_name: string;
  app_id: number | null;
  created_at: string;
}

// ═══════════════════════════════════════
// INTERVIEW LINKS
// ═══════════════════════════════════════

export type InterviewLinkStatus =
  | "generated"
  | "sent"
  | "opened"
  | "interview_started"
  | "interview_completed"
  | "expired";

export interface InterviewLink {
  id: number;
  token: string;
  app_id: number;
  status: InterviewLinkStatus;
  interview_url: string;
  expires_at: string;
  opened_at: string | null;
  interview_started_at: string | null;
  interview_completed_at: string | null;
  face_tracking_json: {
    avg_attention_score: number;
    face_present_percentage: number;
    total_snapshots: number;
  } | null;
  created_at: string;
}

export interface InterviewLinkPublicData {
  token: string;
  status: string;
  candidate_first_name: string;
  job_title: string;
  company_name: string;
  elevenlabs_agent_id: string;
  screening_questions: string[];
  is_valid: boolean;
  error: string | null;
}

export type PipelineStage =
  | "new"
  | "classified"
  | "matched"
  | "interview_link_sent"
  | "screening_scheduled"
  | "screened"
  | "shortlisted"
  | "rejected";
