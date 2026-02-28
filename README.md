# HireOps AI

Production-grade agentic HR automation platform powered by Mistral AI and ElevenLabs.

## What It Does

HireOps AI automates the hiring pipeline end-to-end:

1. **Email Inbox** — Connect Gmail (IMAP + App Password), auto-classify inbound emails as candidate applications
2. **Candidate Extraction** — Parse resumes (PDF/DOCX), extract contact info, create candidate records
3. **Job Management** — Create job postings with AI auto-fill (type a title, LLM generates the full JD)
4. **Resume Scoring** — Match candidates to jobs with AI-powered scoring, evidence, gaps, and recommendations
5. **Voice Screening** — ElevenLabs voice agent calls candidates, conducts screening interviews via phone
6. **Interview Evaluation** — AI evaluates transcripts, scores communication/technical/cultural fit
7. **Pipeline Tracker** — Excel-like candidate tracker with filters, inline stage changes, bulk actions, CSV export
8. **Reports & Analytics** — Funnel charts, top candidates, score distributions, pipeline metrics

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Backend | FastAPI (Python) + SQLAlchemy + SQLite |
| AI/LLM | Mistral AI SDK (agents + chat completion) |
| Voice | ElevenLabs Conversational AI (webhook-based) |
| Icons | Heroicons |
| Charts | Recharts |
| Deployment | Docker Compose |

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Next.js    │────▶│   FastAPI         │────▶│  Mistral AI     │
│   Frontend   │     │   Backend         │     │  Agents (4)     │
│   :3000      │     │   :8000           │     └─────────────────┘
└──────────────┘     │                   │     ┌─────────────────┐
                     │   SQLite DB       │────▶│  ElevenLabs     │
                     │   Event Log       │◀────│  Voice Webhook  │
                     └──────────────────┘     └─────────────────┘
```

### AI Agents

| Agent | Type | Purpose |
|-------|------|---------|
| Email Classifier | Mistral Agent | Classify inbound emails (candidate_application / general / unknown) |
| Resume Scorer | Mistral Agent | Score resumes against job requirements (0-100) |
| Interview Evaluator | Mistral Agent | Evaluate screening transcripts, generate scores + email drafts |
| Job Generator | Mistral Chat | Auto-generate job postings from a title |
| Voice Screener | ElevenLabs | Conduct phone screening interviews with candidates |

Each agent has a `USE_MOCK = True` flag for development. Flip to `False` and set the agent ID to use real Mistral/ElevenLabs calls.

## Project Structure

```
backend/
├── main.py              # FastAPI app, CORS, routers
├── database.py          # SQLAlchemy + SQLite
├── models.py            # ORM models (5 tables)
├── schemas.py           # Pydantic validation schemas
├── routers/
│   ├── jobs.py          # Jobs CRUD + AI generation
│   ├── inbox.py         # Email inbox + Gmail + auto-workflow
│   ├── candidates.py    # Candidate management
│   ├── applications.py  # Application tracker + CSV export
│   ├── screening.py     # Voice screening + retry/reschedule + webhook
│   ├── reports.py       # Analytics + funnel + top candidates
│   └── settings.py      # Agent config + LLM usage reports
├── agents/
│   ├── email_classifier.py
│   ├── resume_scorer.py
│   ├── interview_evaluator.py
│   ├── voice_screener.py
│   └── job_generator.py
└── services/
    ├── gmail_service.py     # Gmail IMAP polling
    ├── workflow_service.py  # Auto-pipeline orchestration
    ├── resume_service.py    # PDF/DOCX text extraction
    ├── csv_service.py       # CSV export
    └── llm_tracker.py       # LLM usage/cost tracking

frontend/
├── src/
│   ├── app/
│   │   ├── page.tsx             # Dashboard
│   │   ├── inbox/page.tsx       # Email inbox + Gmail
│   │   ├── jobs/                # Job list + create/edit
│   │   ├── candidates/          # Candidate tracker + detail
│   │   ├── reports/page.tsx     # Analytics
│   │   └── settings/page.tsx    # Agent config + LLM usage
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
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_agent_id
ELEVENLABS_WEBHOOK_SECRET=your_webhook_secret
```

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
| `events` | Audit log of all pipeline actions |

**Pipeline stages:** `new → classified → matched → screening_scheduled → screened → shortlisted → rejected`

## Key Features

- **AI Auto-Fill Jobs**: Type a title, Mistral generates department, location, seniority, skills, description
- **Gmail Auto-Workflow**: Connect Gmail, new emails auto-trigger: classify → extract candidate → match to jobs → score resume
- **Voice Screening with Retry**: ElevenLabs calls candidates, handles no-answer/busy/voicemail with configurable retry attempts
- **Reschedule Calls**: Candidates can reschedule screening to a preferred time slot
- **LLM Usage Tracking**: Monitor API calls, tokens, cost, latency per agent/model
- **Agent Configuration**: Toggle mock/live mode, set agent IDs from the Settings UI
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
| `POST` | `/api/v1/screening/start` | Start voice screening |
| `POST` | `/api/v1/screening/retry` | Retry failed call |
| `POST` | `/api/v1/screening/reschedule` | Reschedule to new time |
| `POST` | `/api/v1/screening/webhook/elevenlabs` | ElevenLabs webhook |
| `GET` | `/api/v1/reports/summary` | Pipeline analytics |
| `GET` | `/api/v1/settings/llm/usage` | LLM usage report |

## License

MIT
