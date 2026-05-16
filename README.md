# GenEx — The Next-Gen Assessment Platform

GenEx is an interactive, multi-agent technical assessment platform built for [SkillBrew](https://skillbrew.ai/).

Unlike traditional MCQ/coding tests, GenEx drops candidates into a **realistic day-1 on-the-job simulation**: a Jira-style ticket, a real codebase with planted bugs, and an AI "Buddy" that helps without solving. Every action is captured into a behavioral heatmap that recruiters can read in 10 seconds.

## Architecture

```
┌──────────── EMPLOYER PHASE ─────────────────┐    ┌────────── CANDIDATE PHASE ──────────┐
│                                              │    │                                       │
│  JD ─► Extractor ─► CodeAuthor ─► Ticket ──► │    │  Ticket  ┐                            │
│                                    │         │    │  Code    ├─►  Workspace + Buddy  ─►   │
│                                    └► BugInj │    │  Buddy   ┘        (monitored)         │
│                                                   │                       │                │
└─────────────────────────────────────────────┘    └───────────────────────┼────────────────┘
                                                                            ▼
                                                         ┌──── EVALUATION PHASE ────────────┐
                                                         │   Evaluator → Heatmap + Narrative │
                                                         └────────────────────────────────────┘
```

### The 6 agents

| Agent | Role |
|---|---|
| **Extractor** | Pulls real tickets / artifacts from the org's PM tool (mocked Jira for now) to ground the assessment |
| **CodeAuthor** | Generates production-grade "golden" code for the target role |
| **TicketAuthor** | Produces two artifacts: a *bug-injection brief* and a *candidate ticket* |
| **BugInjector** | Plants realistic defects into the golden code based on the brief |
| **Buddy** | Hint-only Socratic tutor available to the candidate. Never solves. |
| **Evaluator** | Grades the candidate's solution + behavioral signals → score + narrative |

### Tech stack

- **Backend** — Python 3.11+, FastAPI, Pydantic v2, Groq SDK, WebSockets
- **Frontend** — Next.js 15 (App Router), React 19, Tailwind v4, Framer Motion, Monaco Editor, Zustand
- **Storage** — In-memory async store (Postgres-ready adapter)
- **LLM** — Groq · `llama-3.3-70b-versatile` (configurable — swap the model in `.env`)

## Getting started

### Prerequisites
- Python 3.11+
- Node.js 20+
- A Groq API key — free at [console.groq.com](https://console.groq.com/keys)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # then add your GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open http://localhost:3000.

## Project layout

```
genex-platform/
├── backend/
│   └── app/
│       ├── agents/        # The 6 agents
│       ├── api/routes/    # REST + WebSocket endpoints
│       ├── core/          # Config, LLM client
│       ├── models/        # Pydantic schemas
│       ├── prompts/       # System prompts for each agent
│       ├── services/      # Orchestrator, heatmap, monitor
│       └── store/         # In-memory store (DB-ready)
└── frontend/
    ├── app/               # Next.js routes
    │   ├── employer/
    │   ├── candidate/[id]/
    │   └── results/[id]/
    ├── components/
    └── lib/
```
