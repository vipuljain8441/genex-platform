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

- **Backend** — Python 3.11+, FastAPI, Pydantic v2, Groq/OpenAI-compatible LLM client, WebSockets
- **Frontend** — Next.js 15 (App Router), React 19, Tailwind v4, Framer Motion, Monaco Editor, Zustand
- **Storage** — Async pluggable store (`memory` or `postgres`)
- **LLM** — Configurable provider. Groq is supported, and local OpenAI-compatible endpoints such as Ollama-hosted `qwen2.5-coder:0.5b` are supported too.

## How to run this project

### Prerequisites

- Python 3.11+
- Node.js 20+
- `npm`
- One LLM option:
  - Groq API key, or
  - local OpenAI-compatible endpoint such as Ollama

## Option 1: Run locally

This is the easiest way to start the project for development.

### 1. Clone and open the project

```bash
git clone <your-repo-url>
cd genex-platform
```

### 2. Start the backend

Open a terminal and run:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Important:

- The backend reads environment variables from `backend/.env`
- `backend/app/.env` is not the main file used when you run `uvicorn` from the `backend` folder

Edit `backend/.env` and choose one setup:

For the simplest local setup, use in-memory storage:

```env
STORE_BACKEND=memory

LLM_PROVIDER=groq
LLM_API_KEY=your_groq_api_key
LLM_MODEL=llama-3.3-70b-versatile
LLM_API_BASE=

ALLOW_ORIGINS=http://localhost:3000
LOG_LEVEL=INFO
APP_BASE_URL=http://localhost:3000
RESEND_API_KEY=
RESEND_FROM_EMAIL=GenEx <onboarding@resend.dev>
```

If you want to use Ollama instead of Groq:

```env
STORE_BACKEND=memory

LLM_PROVIDER=openai_compatible
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5-coder:0.5b
LLM_API_BASE=http://localhost:11434/v1

ALLOW_ORIGINS=http://localhost:3000
LOG_LEVEL=INFO
APP_BASE_URL=http://localhost:3000
```

### 2.1 Configure the model provider

This project supports two model setups:

#### Option A: Use Groq

Use Groq if you want a hosted model and do not want to run a model locally.

Set this in `backend/.env`:

```env
LLM_PROVIDER=groq
LLM_API_KEY=your_groq_api_key
LLM_MODEL=llama-3.3-70b-versatile
```

How it works:

- `LLM_PROVIDER=groq` tells the backend to call Groq
- `LLM_API_KEY` is your Groq key
- `LLM_MODEL` is the Groq model name

#### Option B: Use Ollama locally

Use Ollama if you want the model to run on your machine.

1. Install and start Ollama
2. Pull the model used by this project:

```bash
ollama pull qwen2.5-coder:0.5b
```

3. Verify the model is available:

```bash
ollama list
```

4. Set this in `backend/.env`:

```env
LLM_PROVIDER=openai_compatible
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5-coder:0.5b
LLM_API_BASE=http://localhost:11434/v1
```

How it works:

- `LLM_PROVIDER=openai_compatible` makes the backend talk to an OpenAI-style API
- `LLM_API_BASE=http://localhost:11434/v1` points to Ollama
- `LLM_MODEL=qwen2.5-coder:0.5b` tells the app which local model to use

If you want to use a different Ollama model, pull it first and then change only `LLM_MODEL`.

Example:

```bash
ollama pull qwen2.5-coder:1.5b
```

```env
LLM_MODEL=qwen2.5-coder:1.5b
```

Now start the API:

```bash
uvicorn app.main:app --reload --port 8000
```

Backend will be available at:

- `http://localhost:8000`
- health check: `http://localhost:8000/health`

### 3. Start the frontend

Open a second terminal and run:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

The default frontend env file should contain:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

Frontend will be available at:

- `http://localhost:3000`

### 4. Open the app

Use these pages in your browser:

- `http://localhost:3000` for the landing page
- `http://localhost:3000/employer/new` to create an assessment

Notes:

- If `RESEND_API_KEY` is empty, invite emails are skipped, but the invite link still works and can be copied from the UI
- If you use `STORE_BACKEND=memory`, data resets whenever the backend restarts

## Option 2: Run with Docker Compose

Use this if you want Postgres and a containerized local environment.

From the project root:

```bash
docker compose up --build
```

This starts:

- frontend on `http://localhost:3000`
- backend on `http://localhost:8000`
- Postgres on `localhost:5434`
- Ollama on `http://localhost:11434`

The Docker setup is already wired to use:

- `STORE_BACKEND=postgres`
- `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/genex`
- `LLM_PROVIDER=openai_compatible`
- `LLM_API_BASE=http://ollama:11434/v1`
- `LLM_MODEL=qwen2.5-coder:0.5b`

The first time you use Docker Compose with Ollama, pull the model once:

```bash
docker compose exec ollama ollama pull qwen2.5-coder:0.5b
```

You can verify the model endpoint with:

```bash
curl http://localhost:11434/v1/models -H "Authorization: Bearer ollama"
```

### Rebuild code-server after terminal security changes

If you update the sandbox terminal restrictions, rebuild the `code-server` image and restart the backend workspace service:

```bash
cd /Users/vipuljain/Projects/Hackthhon2/genex-platform
docker compose build --no-cache code-server
docker compose up -d code-server
docker compose restart workspace
```

Check that `code-server` is running:

```bash
docker compose logs code-server --tail=100
docker compose ps
```

### Verify candidate terminal restrictions

After rebuilding, open a fresh candidate coding session in the browser and run these commands in the VS Code terminal:

```bash
echo $0
pwd
type bash
cd ..
pwd
bash
/bin/bash
sudo ls
su
```

Expected behavior:

- terminal starts as a non-root user
- `pwd` stays inside `/home/coder/sessions/<session-id>`
- `cd ..` should not let the candidate escape the session root
- `bash`, `/bin/bash`, `sudo`, and `su` should be blocked
- `type bash` may show `bash is a function` when the restricted shell is active

Related files:

- `docker-compose.yml`
- `.devcontainer/devcontainer.json`
- `docs/single-sandbox-environment.md`

## Common issues

- If the frontend loads but API calls fail, make sure the backend is running on port `8000`
- If CORS errors appear, confirm `ALLOW_ORIGINS=http://localhost:3000` in `backend/.env`
- If Groq requests fail, verify your `LLM_API_KEY` or `GROQ_API_KEY`
- If using Ollama, make sure the Ollama server is running and the model in `LLM_MODEL` has been pulled already
- If terminal restrictions do not appear in code-server, rebuild the `code-server` image with `docker compose build --no-cache code-server` and reopen a brand-new terminal tab in the browser

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
│       └── store/         # Async store backends
└── frontend/
    ├── app/               # Next.js routes
    │   ├── employer/
    │   ├── candidate/[id]/
    │   └── results/[id]/
    ├── components/
    └── lib/
```
