# HireOps AI

Production-grade agentic HR automation platform powered by Mistral AI and ElevenLabs.

## What It Does

HireOps AI automates the hiring pipeline end-to-end:

1. **Email Inbox** — Connect Gmail (IMAP + App Password), auto-classify inbound emails as candidate applications
2. **Candidate Extraction** — Parse resumes (PDF/DOCX), extract contact info, create candidate records
3. **Job Management** — Create job postings with AI auto-fill (type a title, LLM generates the full JD)
4. **Resume Scoring** — Match candidates to jobs with AI-powered scoring, evidence, gaps, and recommendations
5. **Web Interview Room** — Generate unique interview links, candidates join via browser with webcam + ElevenLabs voice AI
6. **Face Tracking** — Real-time webcam face detection during interviews (attention scoring, face presence %)
7. **Interview Evaluation** — Mistral agent evaluates transcripts, scores communication/technical/cultural fit
8. **Pipeline Tracker** — Excel-like candidate tracker with filters, inline stage changes, bulk actions, CSV export
9. **Reports & Analytics** — Funnel charts, top candidates, score distributions, pipeline metrics

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Backend | FastAPI (Python) + SQLAlchemy + SQLite |
| AI/LLM | Mistral AI SDK (agents + chat completion) |
| Voice | ElevenLabs Conversational AI (browser-based via React SDK) |
| Face Detection | MediaPipe Tasks Vision (client-side) |
| Icons | Heroicons |
| Charts | Recharts |
| Deployment | Docker Compose |

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Next.js        │────>│   FastAPI         │────>│  Mistral AI     │
│   Frontend       │     │   Backend         │     │  Agents (3)     │
│   :3000          │     │   :8000           │     └─────────────────┘
├──────────────────┤     │                   │     ┌─────────────────┐
│   Interview Room │     │   SQLite DB       │     │  ElevenLabs     │
│   (Public Page)  │     │   Event Log       │<───>│  Voice Agent    │
│   Webcam + Voice │     │                   │     │  + Audio API    │
└──────────────────┘     └──────────────────┘     └─────────────────┘
```

### Mistral AI Agents

| Agent | Agent ID | Purpose |
|-------|----------|---------|
| Email Classifier | `ag_019ca2d9a7a0773cb0104da31ed35b09` | Classify inbound emails (candidate_application / general / unknown) |
| Resume Scorer | `ag_019ca3046554772bbbdf4d2b75bdd657` | Score resumes against job requirements (0-100) |
| Interview Evaluator | `ag_019ca3de9e43774b868275a93a6f4d36` | Evaluate interview transcripts, generate scores + email drafts |

All agents are configured via environment variables (`*_AGENT_ID` and `*_MOCK`). Each has a mock fallback for local development without API keys.

### Additional AI

| Agent | Type | Purpose |
|-------|------|---------|
| Job Generator | Mistral Chat | Auto-generate job postings from a title |
| Voice Interviewer | ElevenLabs | Conduct browser-based voice interviews with candidates |

## Project Structure

```
backend/
├── main.py              # FastAPI app, CORS, routers
├── database.py          # SQLAlchemy + SQLite
├── models.py            # ORM models (6 tables)
├── schemas.py           # Pydantic validation schemas
├── routers/
│   ├── jobs.py          # Jobs CRUD + AI generation
│   ├── inbox.py         # Email inbox + Gmail + auto-workflow
│   ├── candidates.py    # Candidate management
│   ├── applications.py  # Application tracker + CSV export
│   ├── screening.py     # Interview links + face tracking + transcript + audio proxy
│   ├── reports.py       # Analytics + funnel + top candidates
│   └── settings.py      # Agent config + LLM usage reports
├── agents/
│   ├── email_classifier.py    # Mistral agent — email classification
│   ├── resume_scorer.py       # Mistral agent — resume scoring
│   ├── interview_evaluator.py # Mistral agent — interview evaluation
│   └── job_generator.py       # Mistral chat — job description generation
└── services/
    ├── gmail_service.py     # Gmail IMAP polling
    ├── workflow_service.py  # Auto-pipeline orchestration
    ├── resume_service.py    # PDF/DOCX text extraction
    ├── csv_service.py       # CSV export
    └── llm_tracker.py       # LLM usage/cost tracking

frontend/
├── src/
│   ├── app/
│   │   ├── (dashboard)/            # Dashboard route group (with sidebar)
│   │   │   ├── layout.tsx          # DashboardShell wrapper
│   │   │   ├── page.tsx            # Dashboard home
│   │   │   ├── inbox/page.tsx      # Email inbox + Gmail
│   │   │   ├── jobs/               # Job list + create/edit
│   │   │   ├── candidates/         # Candidate tracker + detail
│   │   │   ├── reports/page.tsx    # Analytics
│   │   │   └── settings/page.tsx   # Agent config + LLM usage
│   │   └── (public)/               # Public route group (no sidebar)
│   │       └── interview/[token]/page.tsx  # Interview room
│   ├── components/
│   │   ├── layout/              # Sidebar, DashboardShell
│   │   └── ui/                  # Card, Button, DataTable, etc.
│   ├── lib/
│   │   ├── api.ts               # Typed API client
│   │   └── constants.ts         # Stage labels, colors, helpers
│   └── types/index.ts           # TypeScript interfaces
```

## Setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- Docker & Docker Compose (optional)

### Environment Variables

Create `backend/.env`:

```env
MISTRAL_API_KEY=your_mistral_api_key

# Mistral Agents
RESUME_SCORER_AGENT_ID=your_resume_scorer_agent_id
RESUME_SCORER_MOCK=false
EMAIL_CLASSIFIER_AGENT_ID=your_email_classifier_agent_id
EMAIL_CLASSIFIER_MOCK=false
INTERVIEW_EVALUATOR_AGENT_ID=your_interview_evaluator_agent_id
INTERVIEW_EVALUATOR_MOCK=false

# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id
ELEVENLABS_WEBHOOK_SECRET=your_webhook_secret

# App
FRONTEND_URL=http://localhost:3000
COMPANY_NAME=HireOps AI
DATABASE_URL=sqlite:///./hireops.db
```

Set any `*_MOCK=true` to use mock fallbacks without real API calls.

### Run with Docker

```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs

### Run Locally

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `jobs` | Job postings with title, skills, description, status |
| `emails` | Inbound emails with classification results |
| `candidates` | Candidate profiles with resume text |
| `applications` | Candidate-job matches with scores, stages, screening data |
| `interview_links` | Unique interview tokens with status, face tracking, conversation IDs |
| `events` | Audit log of all pipeline actions |

**Pipeline stages:** `new → classified → matched → interview_link_sent → screened → shortlisted → rejected`

## Interview Flow

1. Recruiter clicks "Generate Interview Link" on a candidate's application
2. System creates a unique token URL (e.g., `http://localhost:3000/interview/abc123`)
3. Candidate opens link in browser, enables webcam and microphone
4. ElevenLabs voice AI conducts the interview (WebSocket connection)
5. MediaPipe face detection tracks attention in real-time (sent to backend every 10s)
6. On completion, transcript is submitted and auto-evaluated by Mistral interview_evaluator agent
7. Recruiter sees score, strengths, concerns, face tracking data, and can play back the audio recording

## Key Features

- **AI Auto-Fill Jobs**: Type a title, Mistral generates department, location, seniority, skills, description
- **Gmail Auto-Workflow**: Connect Gmail, new emails auto-trigger: classify → extract candidate → match to jobs → score resume
- **Browser Interview Room**: Candidates join via link, no phone calls needed — webcam + voice AI in the browser
- **Face Tracking**: Real-time attention scoring using MediaPipe face detection (face presence %, attention score)
- **Interview Audio Playback**: Audio recordings proxied from ElevenLabs API for recruiter review
- **LLM Usage Tracking**: Monitor API calls, tokens, cost, latency per agent/model
- **Agent Configuration**: Toggle mock/live mode via env vars, set agent IDs per agent
- **CSV Export**: Download filtered candidate data as CSV
- **Enterprise Dashboard**: Metric cards, funnel charts, activity feed, top candidates

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/jobs` | Create job |
| `POST` | `/api/v1/jobs/generate` | AI generate job details from title |
| `POST` | `/api/v1/inbox/gmail/connect` | Connect Gmail |
| `POST` | `/api/v1/inbox/gmail/watch` | Start auto-workflow polling |
| `POST` | `/api/v1/applications/match` | Match candidate to job + score |
| `GET` | `/api/v1/applications` | List with filters/sort/pagination |
| `POST` | `/api/v1/screening/generate-link` | Generate unique interview link |
| `GET` | `/api/v1/screening/link/{token}` | Validate interview token (public) |
| `POST` | `/api/v1/screening/link/{token}/status` | Update interview status (public) |
| `POST` | `/api/v1/screening/link/{token}/face-tracking` | Submit face tracking data (public) |
| `POST` | `/api/v1/screening/link/{token}/transcript` | Submit transcript + auto-evaluate (public) |
| `GET` | `/api/v1/screening/{app_id}/audio` | Proxy interview audio from ElevenLabs |
| `POST` | `/api/v1/screening/webhook/elevenlabs` | ElevenLabs webhook |
| `GET` | `/api/v1/reports/summary` | Pipeline analytics |
| `GET` | `/api/v1/settings/llm/usage` | LLM usage report |

## License

MIT
