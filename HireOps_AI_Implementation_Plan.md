# 🧑‍💼 HireOps AI — Agentic HR Inbox + Screening Platform
## Implementation Plan (Hackathon Build + Full Product Vision)

> **Goal:** Build an **agentic HR automation system** that mimics how HR teams run hiring in Excel today, but upgrades it with **AI-powered classification, scoring, voice screening, and insights**.
>
> - **Mistral Agents**: Email Classifier, Resume Scorer, Interview Evaluator (all JSON outputs)
> - **ElevenLabs Agents**: Voice call screening + interview scheduling
> - **Candidate Tracking**: Excel-like pipeline board + exportable table
> - **HR Insights**: quick snippets + AI summaries + report dashboard

---

## 1) Product Overview

### What HR gets (end-user value)
- **Connect HR inbox** → automatically detects candidate applications vs general emails
- **Create Job** in minutes → generates JD + Job ID
- **Auto-score resumes** against JD → shortlist recommendations with evidence + gaps
- **Voice screening** (ElevenLabs agent) → structured phone screen + transcript + evaluation
- **Interview scheduling** → send invites / propose slots (**hackathon: simplified scheduling**)
- **Excel-like tracker** → pipeline stages + filters + export
- **AI-powered insights** → “top candidates”, “missing skills”, “why shortlisted”, “next actions”

---

## 2) High-Level Architecture

### Core modules
1. **Frontend (Web App)**
   - Connect Inbox
   - Jobs (create JD + Job ID)
   - Candidates (Excel-like table + stages)
   - Candidate Detail (score, transcript, evaluation, next actions)
   - Reports (summary metrics + AI insights)

2. **Backend Orchestrator (API)**
   - Event loop / routing between tools + agents
   - Stores state (jobs, candidates, pipeline stages, actions log)

3. **Mistral Agents (JSON-only)**
   - `email_classifier`
   - `resume_scorer`
   - `interview_evaluator`
   - *(optional)* `job_generator` and `interview_script_agent`

4. **Tool Integrations**
   - Email fetch (IMAP or sample inbox upload)
   - Resume extraction (PDF/DOCX → text)
   - ElevenLabs voice agent (call + transcript)
   - Notifications (email draft / send optional)

---

## 3) Agents & Responsibilities

### Mistral Agents
**A) Email Classifier**
- Input: subject, sender, body snippet, attachment names/types
- Output: `candidate_application | general | unknown`, confidence, next action

**B) Resume Scorer**
- Input: resume text + job profile (JD, must-have skills)
- Output: score (0–100), evidence, gaps, risks, recommendation, screening questions

**C) Interview Evaluator**
- Input: transcript + job profile + resume score summary
- Output: overall score, decision (advance/hold/reject), strengths/concerns, email draft

### ElevenLabs Agent
**D) Voice Screening + Scheduling**
- Uses a phone-screen script (generated or templated)
- Asks structured questions (5–7)
- Captures answers → transcript
- **Scheduling**:
  - Hackathon version: propose time slots + generate invitation email (**no calendar API required**)
  - Full product: integrate with Google Calendar / Outlook to book slots

---

## 4) Candidate Tracking (Excel-like)

### Why this matters
HR teams manage hiring like an **Excel tracker**:
- columns: Name, Email, Job, Stage, Score, Last Contact, Next Step, Notes
- filters: Job ID, Stage, Score range, Date updated
- exports: CSV for reporting

### Candidate pipeline stages (default)
- **New**
- **Classified**
- **Matched**
- **Screening Scheduled**
- **Screened**
- **Shortlisted**
- **Rejected**

### Excel-like table fields (minimum)
- Candidate Name
- Email
- Phone
- Job ID
- Stage
- Resume Score
- Interview Score
- Recommendation
- Last Updated
- Next Action (AI-generated)
- Notes

---

## 5) Reporting + “AI Snippets” for HR

### Reports (MVP)
- Count by stage (pipeline funnel)
- Top candidates per job (by score)
- Average resume score per job
- Screening completion rate
- Decisions (advance/hold/reject)

### AI snippets (MVP)
For each candidate, show **quick HR-friendly insights**:
- “Why shortlisted” (3 bullets)
- “Key strengths” (3 bullets)
- “Main gaps / risks” (2 bullets)
- “Recommended next action” (1 line)
- “Suggested interview focus” (3 bullets)

*(These can be produced by the Resume Scorer + Interview Evaluator outputs.)*

---

## 6) Data Model (Simple & Reliable)

### Storage options
- **Hackathon**: SQLite (fast) or JSON file store (fastest)
- **Full product**: Postgres

### Suggested tables (SQLite)
- `jobs(job_id, title, location, seniority, jd_json, created_at)`
- `emails(email_id, from_addr, subject, body, attachments_json, classified_json, created_at)`
- `candidates(candidate_id, name, email, phone, resume_text, source_email_id, created_at)`
- `applications(app_id, job_id, candidate_id, stage, resume_score_json, interview_score_json, updated_at)`
- `events(event_id, app_id, type, payload_json, created_at)`

---

## 7) API Endpoints (Backend Orchestrator)

### Inbox
- `POST /inbox/connect` (IMAP creds OR “load sample inbox”)
- `POST /inbox/sync` (fetch latest N emails)
- `POST /inbox/classify` (runs Mistral `email_classifier` on fetched emails)

### Jobs
- `POST /jobs/create` (title + few fields → JD + job_id)
- `GET /jobs`
- `GET /jobs/{job_id}`

### Candidates + Matching
- `POST /candidates/from_email/{email_id}` (extract resume → create candidate)
- `POST /applications/match` (candidate_id + job_id → `resume_scorer`)
- `GET /applications` (filter by job_id/stage)

### Screening (ElevenLabs)
- `POST /screening/start` (app_id → start voice screening)
- `POST /screening/transcript` (store transcript result)
- `POST /screening/evaluate` (app_id → `interview_evaluator`)

### Reports
- `GET /reports/funnel?job_id=...`
- `GET /reports/top_candidates?job_id=...`
- `GET /reports/summary`

---

## 8) Hackathon Build Scope vs Full Product

### ✅ Hackathon Core (what you MUST ship)
- Inbox sync + email classification
- Job create (JD + Job ID)
- Resume extraction + scoring
- Candidate tracker table (Excel-like)
- Voice screening demo (ElevenLabs) + transcript + evaluation
- Reports page (funnel + top candidates + AI snippets)

### 🚧 Roadmap (show in slides, not necessarily build)
- Full OAuth (Gmail/Outlook)
- Calendar booking integration (Google/Outlook)
- Multi-tenant orgs + RBAC
- Automated follow-ups + nudges
- Fine-tuned role-specific scoring
- Compliance + audit workflows

---

## 9) 48-Hour Implementation Plan (Solo-Friendly)

### Hour 0–2: Repo + Skeleton
- Frontend scaffold (Next.js)
- Backend scaffold (FastAPI/Node)
- SQLite schema
- `/health` endpoint
- UI pages placeholders (Connect / Jobs / Candidates / Reports)

### Hour 2–6: Inbox + Classification
- Implement sample inbox loader OR IMAP fetch
- Store emails in DB
- Call **Mistral `email_classifier`** → persist classification JSON
- UI: inbox list + “candidate detected” badge

### Hour 6–10: Jobs + JD Generator
- Job create form (title + skills)
- Generate JD + job_id (Mistral agent or prompt)
- Save `jobs` record
- UI: job list + job detail

### Hour 10–16: Resume Extract + Resume Scorer
- Attachment pipeline: PDF/DOCX → text (basic extraction)
- Candidate creation from email
- Call **Mistral `resume_scorer`**
- UI: candidate detail with score, evidence, gaps, recommendation

### Hour 16–22: Excel-like Tracker (Pipeline)
- Applications table view with:
  - filters (job_id, stage)
  - quick edit stage (dropdown)
  - export CSV
- Persist `stage` updates to DB
- Add “AI next action” column from agent outputs

### Hour 22–30: ElevenLabs Voice Screening + Scheduling Output
- Implement “Start Screening” button:
  - Provide scripted questions (templated or generated)
  - Run ElevenLabs Agent interaction (demo mode if needed)
  - Capture transcript
- Store transcript
- Call **Mistral `interview_evaluator`**
- Generate:
  - evaluation JSON
  - next-step email draft
  - scheduling proposal text (3 slots)

### Hour 30–36: Reports + AI Snippets
- Reports endpoints:
  - funnel counts by stage
  - top candidates per job
- UI: Reports page
- Add AI snippets in Candidate page and Top Candidates view

### Hour 36–44: Reliability + Demo Mode
- Fallbacks if an API call fails (template outputs)
- Deterministic demo dataset (sample inbox + sample CV)
- “Demo Mode” toggle
- Polish UI (tables readable)

### Hour 44–48: Submission Assets
- 2-min demo video script + recording
- README + architecture diagram
- Hackiterate submission text
- Slides: problem → solution → architecture → demo → roadmap

---

## 10) Demo Script (2 minutes max)

1. **Connect Inbox** → click “Sync & Classify”
2. System flags **candidate emails** vs general emails
3. **Create Job** → generates JD + Job ID instantly
4. Open a candidate → **Resume Score** appears with evidence + gaps
5. Candidate tracker shows Excel-like pipeline + recommended next action
6. Click **Start Voice Screening** → ElevenLabs agent runs questions (demo)
7. Show transcript → **Interview Evaluator** outputs decision + email draft + proposed interview slots
8. Reports page → funnel + top candidates + AI snippets

---

## 11) What to Say to Judges (Positioning)

> “HireOps AI is an **autonomous hiring operations agent**. It observes an HR inbox, classifies candidate applications, generates job descriptions, scores resumes, and runs voice screenings using ElevenLabs. It tracks candidates in an Excel-like pipeline and produces HR-ready snippets and reports—demonstrating planning, memory, and tool orchestration beyond one-shot prompting.”

---

## 12) Key Success Tips (Solo Builder)
- Use **sample inbox + sample CVs** to guarantee a flawless demo
- Keep agents **JSON-only** for stability
- Prioritize **pipeline + voice screening + evaluation** (highest wow + usefulness)
- Keep scheduling as **“proposed slots + email draft”** (fast, credible)

---

### ✅ Challenge Alignment
- **Track:** Mistral AI Track
- **Challenges (optional):**
  - ElevenLabs: best use of ElevenLabs (voice screening + scheduling)
  - Hugging Face: best use of agent skills (optional embeddings/RAG)
