// ═══════════════════════════════════════
// AUTH + TENANT
// ═══════════════════════════════════════

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "owner" | "member";
  is_superadmin: boolean;
  email_verified: boolean;
}

export interface AuthTenant {
  id: number;
  slug: string;
  name: string;
  plan: "free" | "starter" | "pro";
  industry?: string | null;
  headquarters?: string | null;
  company_size?: string | null;
  website?: string | null;
  about?: string | null;
  default_work_mode?: string | null;
  default_currency?: string | null;
  profile_completed?: boolean;
}

export interface OrganizationProfile {
  id: number;
  name: string;
  slug: string;
  industry: string | null;
  headquarters: string | null;
  company_size: string | null;
  website: string | null;
  about: string | null;
  default_work_mode: string | null;
  default_currency: string | null;
  profile_completed: boolean;
  profile_completed_at: string | null;
}

export interface MeResponse {
  user: AuthUser;
  tenant: AuthTenant;
}

export interface AdminTenantSummary {
  id: number;
  slug: string;
  name: string;
  plan: "free" | "starter" | "pro";
  suspended: boolean;
  deleted_at: string | null;
  owner_email: string | null;
  member_count: number;
  job_count: number;
  candidate_count: number;
  application_count: number;
  interview_count: number;
  created_at: string;
  last_activity_at: string | null;
}

export interface AdminTenantMember {
  id: number;
  email: string;
  name: string;
  role: "owner" | "member";
  email_verified: boolean;
  last_login_at: string | null;
}

export interface LlmSpendDay {
  date: string;
  total_usd: number;
  calls: number;
}

export interface AdminTenantDetail extends AdminTenantSummary {
  max_jobs_override: number | null;
  max_candidates_override: number | null;
  max_interviews_per_month_override: number | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  members: AdminTenantMember[];
  llm_spend_30d: LlmSpendDay[];
  llm_spend_total_30d_usd: number;
}

export interface AdminAnalytics {
  signups_per_day_30d: { date: string; signups: number }[];
  tenants_total: number;
  tenants_active_28d: number;
  tenants_paid: number;
  free_to_paid_conversion_pct: number;
  mrr_usd: number;
  plan_breakdown: Record<string, number>;
  past_due: {
    tenant_id: number;
    name: string;
    plan: string;
    owner_email: string | null;
    current_period_end: string | null;
  }[];
  daily_llm_spend_30d: LlmSpendDay[];
  llm_spend_total_30d_usd: number;
  top_spenders_30d: {
    tenant_id: number;
    tenant_name: string;
    plan: string;
    total_usd: number;
    calls: number;
  }[];
  per_agent_breakdown_30d: {
    agent_name: string;
    total_usd: number;
    calls: number;
  }[];
}

export interface AdminUserItem {
  id: number;
  email: string;
  name: string;
  role: "owner" | "member";
  is_superadmin: boolean;
  email_verified: boolean;
  disabled: boolean;
  tenant_id: number;
  tenant_name: string;
  last_login_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor_email: string;
  action_type: string;
  target_tenant_id: number | null;
  target_tenant_name: string | null;
  target_user_id: number | null;
  target_user_email: string | null;
  payload: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface TeamMember {
  id: number;
  email: string;
  name: string;
  role: "owner" | "member";
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface TeamInvite {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface AcceptInvitePeek {
  valid: boolean;
  email: string | null;
  tenant_name: string | null;
  inviter_name: string | null;
  error: string | null;
}

// ═══════════════════════════════════════
// BILLING
// ═══════════════════════════════════════

export type PlanName = "free" | "starter" | "pro";

export interface Plan {
  name: PlanName;
  display_name: string;
  price_monthly_usd: number;
  features: string[];
  available: boolean; // false if not configured in Stripe
}

export interface CurrentPlan {
  plan: PlanName;
  display_name: string;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_url_available: boolean;
}

export interface UsageItem {
  used: number;
  limit: number; // -1 for unlimited
}

export interface UsageSummary {
  jobs: UsageItem;
  candidates: UsageItem;
  interviews_this_month: UsageItem;
  llm_today: {
    spent_usd: number;
    budget_usd: number; // -1 for unlimited
    remaining_usd: number;
  };
}

// ═══════════════════════════════════════
// JOBS
// ═══════════════════════════════════════
export type InterviewMode = "voice" | "qa" | "hr_video";

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
  interview_mode: InterviewMode;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  is_expired: boolean;
  resume_threshold_min: number;
  interview_threshold_min: number;
  final_threshold_reject: number;
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
  interview_mode: InterviewMode;
  // ISO date string (YYYY-MM-DD) — backend coerces to UTC midnight.
  // Empty/undefined leaves no expiry.
  expires_at?: string | null;
  // Optional auto-decision thresholds (0–100). Backend has sensible
  // defaults so these can be omitted.
  resume_threshold_min?: number;
  interview_threshold_min?: number;
  final_threshold_reject?: number;
  // Optional per-job interview question auto-gen. Keys: behavioural |
  // technical | situational | culture_fit. Each value = count for that
  // type (0 to skip). Omitting the field skips auto-gen.
  interview_question_counts?: Record<string, number>;
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
export type TalentBankStatus =
  | "available"
  | "joined_another"
  | "not_available"
  | "hired_elsewhere";

export interface Candidate {
  id: number;
  name: string;
  email: string;
  /** True when the candidate has no real email — either it was missing
   * at upload time (LLM/regex couldn't find one) or it's a legacy
   * @uploaded.local placeholder. UI surfaces a missing-field badge and
   * outbound sends refuse to fire until HR adds one. */
  email_missing?: boolean;
  phone: string;
  /** True when phone is empty — WhatsApp / voice screening can't run. */
  phone_missing?: boolean;
  /** True when name is a placeholder (empty, "Untitled candidate",
   * "Job Description", etc.) — the resume parser couldn't find a real
   * candidate name. */
  name_missing?: boolean;
  /** Aggregated list of fields the parser couldn't find. UI iterates
   * these to render a single "Missing: email, phone" pill. */
  missing_fields?: string[];
  resume_text: string;
  resume_filename: string;
  resume_blob_available?: boolean;
  cv_version?: number;
  source_email_id: number | null;
  notes: string;
  talent_bank_status?: TalentBankStatus;
  talent_bank_status_reason?: string;
  talent_bank_status_updated_at?: string | null;
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
  mode?: "voice" | "qa";
  rounds?: Record<
    string,
    { score?: number; feedback?: string; strengths?: string[]; gaps?: string[] }
  >;
  fraud_risk_score?: number;
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
  qa_fraud_risk_score: number | null;
  qa_signals_summary: {
    per_round?: Record<
      string,
      {
        focus_loss_count?: number;
        focus_loss_seconds?: number;
        paste_count?: number;
        paste_chars?: number;
        time_per_question_seconds?: number[];
        total_time_seconds?: number;
      }
    >;
    summary?: {
      focus_loss_count?: number;
      paste_count?: number;
      paste_chars?: number;
      face_present_percentage?: number | null;
      avg_attention_score?: number | null;
      components?: {
        focus?: number;
        paste?: number;
        face?: number;
        attention?: number;
      };
    } | null;
  } | null;
  scheduled_interview_at: string | null;
  scheduled_interview_slot: string | null;
  email_draft_sent: number;
  final_score: number | null;
  final_summary: string | null;
  interview_room_url: string | null;
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
// HIRING REPORT
// ═══════════════════════════════════════

export interface HiringReportPipelineAction {
  action: string;
  detail: string;
  result: string;
}

export interface HiringReport {
  executive_summary: string;
  hire_recommendation: string;
  confidence_pct: number;
  pipeline_actions: HiringReportPipelineAction[];
  strengths_analysis: string[];
  risk_analysis: string[];
  verdict_reasoning: string;
  suggested_next_steps: string[];
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
  scheduled_at: string | null;
  available_in_minutes: number | null;
  interview_round: number;
  interview_mode: InterviewMode;
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

// ═══════════════════════════════════════
// Q&A INTERVIEW
// ═══════════════════════════════════════

export type QaRound = "aptitude" | "reasoning" | "technical";

export interface QaQuestion {
  text: string;
  options?: string[]; // present for MCQ rounds, absent for free-form (technical)
}

export interface QaSessionStartResponse {
  token: string;
  candidate_first_name: string;
  job_title: string;
  company_name: string;
  current_round: QaRound;
  round_index: number;
  total_rounds: number;
  questions: QaQuestion[];
}

export interface QaRoundSubmitResponse {
  round: QaRound;
  round_score: number;
  feedback: string;
  next_round: QaRound | null;
  next_questions: QaQuestion[];
  completed: boolean;
  final_score: number | null;
  final_summary: string | null;
  fraud_risk_score: number | null;
}
