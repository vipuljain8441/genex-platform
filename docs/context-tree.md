# GenEx Context Tree

Last reviewed: 2026-05-17

## 1. Product Summary

GenEx is a hackathon-built assessment platform that generates role-specific
technical simulations. Employers define a role, the backend runs a 4-stage
generation pipeline powered by LLM agents, candidates solve the resulting task
inside a browser IDE, and recruiters review an evaluation plus an activity
heatmap.

Core product loop:

1. Employer creates assessment from manual intake, JD, Jira backlog analysis, or GitHub-backed intake.
2. Backend agents generate context, golden code, ticket, and buggy code.
3. Employer invites candidates by email or copied link.
4. Candidate opens workspace, edits files, runs code, asks Buddy for help, and
   submits.
5. Evaluator scores the submission and recruiter reviews the results page.

## 2. Runtime Architecture

```text
Next.js frontend
  -> REST/WS calls
FastAPI backend
  -> route layer
  -> pluggable store (memory or Postgres)
  -> orchestration/services
  -> LLM-backed agents
  -> evaluation + heatmap output

External services
  -> Groq or OpenAI-compatible model endpoint for agent completions
  -> Jira Cloud REST API for backlog analysis
  -> Resend API for invite email delivery
```

## 3. Repository Tree

```text
genex-platform/
├── README.md
├── docs/
│   ├── README.md
│   ├── context-tree.md
│   └── development-matrix.md
├── backend/
│   ├── .env.example
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── agents/
│       ├── api/routes/
│       ├── core/
│       ├── models/
│       ├── prompts/
│       ├── services/
│       └── store/
└── frontend/
    ├── .env.local.example
    ├── package.json
    ├── app/
    ├── components/
    ├── lib/
    ├── tailwind.config.ts
    └── next.config.mjs
```

## 4. Backend Context Tree

### 4.1 Entry Layer

- `backend/app/main.py`
  - creates FastAPI app
  - configures logging and CORS
  - mounts all route groups under `/api`
  - exposes `/health`

### 4.2 Configuration

- `backend/app/core/config.py`
  - `Settings` from `.env`
  - storage backend and database URL
  - LLM provider, model, API base, API key
  - CORS origins
  - app base URL for invite links
  - Resend email config

- `backend/app/core/llm.py`
  - provider-agnostic async chat wrapper
  - supports Groq
  - supports OpenAI-compatible endpoints such as local vLLM
  - `complete()` for raw chat
  - `complete_json()` for structured agent output
  - JSON extraction fallback for malformed model responses

### 4.3 Data Model

- `backend/app/models/schemas.py`
  - central contract for all phases
  - top-level domain objects:
    - `JobSpec`
    - `Assessment`
    - `Invite`
    - `CandidateSession`
    - `ActivityEvent`
    - `BuddyRequest` / `BuddyResponse`
    - `EvaluationResult`
  - supporting enums:
    - `RoleFamily`
    - `ArtifactKind`
    - `DefectKind`
    - `PipelineStage`
    - `EventKind`

### 4.4 Store Layer

- `backend/app/store/__init__.py`
  - selects the active store backend from env
  - supports `memory` and `postgres`

- `backend/app/store/base.py`
  - async store protocol shared by all backends

- `backend/app/store/memory.py`
  - in-memory backend for lightweight local runs

- `backend/app/store/postgres.py`
  - Postgres-backed persistence for assessments, sessions, invites, buddy
    history, events, and evaluations
  - retains in-process asyncio pub/sub for live WebSocket updates in the
    current single-sandbox runtime

### 4.5 Agent Layer

- `backend/app/agents/extractor.py`
  - uses recruiter context directly when PM tool is `none`
  - otherwise synthesizes sample tickets and tech signals

- `backend/app/agents/code_author.py`
  - generates golden artifact files for the chosen role family

- `backend/app/agents/ticket_author.py`
  - creates hidden bug brief plus candidate-facing ticket

- `backend/app/agents/bug_injector.py`
  - mutates the golden artifact into a buggy artifact

- `backend/app/agents/buddy.py`
  - candidate-facing coding assistant
  - reads chat history, open file, selection, and workspace
  - may return structured full-file edit proposals

- `backend/app/agents/evaluator.py`
  - compares submitted workspace against golden code
  - summarizes activity signals
  - produces score, narrative, strengths, gaps, and acceptance coverage

### 4.6 Prompt Layer

- `backend/app/prompts/library.py`
  - stores all system prompts in one place
  - contains behavior policy for each agent
  - Buddy prompt explicitly includes the "helpful but fallible" mechanic

### 4.7 Service Layer

- `backend/app/services/orchestrator.py`
  - runs the assessment build pipeline
  - updates `Assessment.status` after each stage
  - persists intermediate artifacts back into store

- `backend/app/services/jira.py`
  - fetches Jira backlog issues from Jira Cloud REST API
  - flattens Atlassian Document Format descriptions into plain text
  - returns normalized issue digests for employer-side LLM analysis

- `backend/app/services/heatmap.py`
  - converts activity events into file x time-bucket intensity grid

- `backend/app/services/email.py`
  - builds invite URLs
  - sends invite emails with Resend when configured
  - gracefully degrades to manual link sharing

### 4.8 API Route Tree

- `backend/app/api/routes/employer.py`
  - analyze Jira backlog into hiring signal + recruiter context
  - create assessment
  - list/get assessment
  - websocket stream assessment status
  - create/list invites

- `backend/app/api/routes/invite.py`
  - get invite details
  - accept invite and create candidate session

- `backend/app/api/routes/candidate.py`
  - start session directly from assessment
  - fetch session workspace
  - save file edits
  - run current file in temp dir
  - submit for evaluation

- `backend/app/api/routes/buddy.py`
  - ask Buddy
  - fetch Buddy chat history

- `backend/app/api/routes/monitor.py`
  - record activity events
  - list session events
  - websocket stream session events

- `backend/app/api/routes/results.py`
  - fetch evaluation result and heatmap

## 5. Frontend Context Tree

### 5.1 App Router Pages

- `frontend/app/page.tsx`
  - landing page

- `frontend/app/employer/page.tsx`
  - employer assessment list

- `frontend/app/employer/new/page.tsx`
  - create assessment form

- `frontend/app/employer/[id]/page.tsx`
  - pipeline/progress view for one assessment

- `frontend/app/candidate/start/page.tsx`
  - direct-start fallback using query param `aid`

- `frontend/app/candidate/invite/[token]/page.tsx`
  - invite landing and accept flow

- `frontend/app/candidate/[id]/page.tsx`
  - candidate workspace

- `frontend/app/results/[id]/page.tsx`
  - recruiter/candidate result view

### 5.2 Shared Client Lib

- `frontend/lib/api.ts`
  - all REST calls
  - assessment websocket helper
  - central TypeScript API contracts

- `frontend/lib/monitor.ts`
  - client-side event batching
  - coalesces edit activity before posting to backend

- `frontend/lib/utils.ts`
  - class merging
  - short id formatting
  - relative time formatting

### 5.3 Candidate Experience Components

- `components/candidate/Workspace.tsx`
  - top-level browser IDE shell
  - owns editor state, run state, submit flow, and Buddy integration

- `components/candidate/TicketPanel.tsx`
  - Jira-style task panel

- `components/candidate/FileTree.tsx`
  - file list sidebar

- `components/candidate/CodeEditor.tsx`
  - Monaco wrapper with language detection

- `components/candidate/BuddyChat.tsx`
  - chat UI
  - renders structured edit proposals with Apply / Dismiss actions

- `components/candidate/RunPanel.tsx`
  - local execution output panel

### 5.4 Employer Experience Components

- `components/employer/JobForm.tsx`
  - JD intake form
  - role family, seniority, skills, duration, PM tool
  - recruiter context expansion when PM tool is absent
  - Jira backlog analysis flow with "apply suggestions" prefill
  - GitHub repo-based codebase sourcing

- `components/employer/PipelineView.tsx`
  - assessment lifecycle monitor
  - streams pipeline status
  - previews ticket and artifact
  - exposes invite management when ready

- `components/employer/InviteCard.tsx`
  - send invite emails
  - show invite status
  - copy/open invite links

### 5.5 Results Components

- `components/results/ScoreRing.tsx`
  - overall score visualization

- `components/results/SignalBars.tsx`
  - per-signal score bars

- `components/results/Heatmap.tsx`
  - activity grid view by file and time bucket

### 5.6 Landing / Marketing Components

- `components/landing/Hero.tsx`
- `components/landing/RoleStrip.tsx`
- `components/landing/HowItWorks.tsx`
- `components/landing/AgentPipeline.tsx`
- `components/landing/Footer.tsx`

### 5.7 UI Primitives

- `components/ui/Button.tsx`
- `components/ui/Card.tsx`
- `components/ui/Badge.tsx`
- `components/ui/Field.tsx`
- `components/ui/Logo.tsx`

### 5.8 Visual System

- `frontend/app/globals.css`
  - base styles
  - font imports
  - gradients, dotted grid, glass effects

- `frontend/tailwind.config.ts`
  - semantic color palette
  - display/mono font choices
  - shadows, radii, animations

## 6. End-to-End Flow Tree

### 6.1 Employer Flow

1. Employer fills `JobForm`.
2. `api.createAssessment()` posts `JobSpec`.
3. Backend creates `Assessment` and starts background pipeline.
4. `PipelineView` watches status via websocket plus polling fallback.
5. When ready, employer previews ticket/artifact and sends invites.

### 6.2 Assessment Build Flow

1. `extractor.run(job)`
2. `code_author.run(job, context)`
3. `ticket_author.run(job, golden_codebase)`
4. `bug_injector.run(golden_codebase, brief)`
5. Store final `buggy_codebase` and mark `READY`

### 6.3 Candidate Flow

1. Candidate opens invite or direct start link.
2. Backend provisions `CandidateSession` with buggy files.
3. `Workspace` loads current files, ticket, timer, and monitor.
4. Candidate edits files, switches files, runs code, chats with Buddy.
5. Client batches events via `monitor`.
6. Candidate submits.
7. Backend runs evaluator and stores `EvaluationResult`.
8. Results page polls until evaluation is available.

### 6.4 Monitoring and Evaluation Flow

1. Activity events are recorded throughout the session.
2. Buddy turns are persisted separately.
3. Evaluator summarizes event distribution and workspace state.
4. Heatmap service visualizes time spent by file and event intensity.

## 7. Current Persistence Boundary

Storage is now configurable:

- `memory`
  - fastest local path
  - loses state on restart

- `postgres`
  - persists assessments, sessions, invites, activity events, buddy history,
    and evaluations
  - still uses same-process pub/sub for live WebSocket fan-out

Current implication with `postgres`:

- primary product state survives restart
- WebSocket subscriptions are still process-local
- multi-instance horizontal scaling still needs shared pub/sub

## 8. Integration Boundary

Current external dependencies:

- Groq or an OpenAI-compatible endpoint for agentic generation and evaluation
- Resend for email delivery
- Monaco Editor in the browser
- local machine runtimes for candidate code execution:
  - `python3`
  - `node`
  - `npx --yes tsx`
  - `bash`

## 9. High-Leverage Future Extension Points

Most likely places we will touch during future feature work:

- `backend/app/store/postgres.py`
  - foundation for durable assessment state
  - future home for stronger queries, transactions, and multi-instance support

- `backend/app/api/routes/candidate.py`
  - harden run sandbox, autosave, submission lifecycle

- `backend/app/agents/*`
  - tune role coverage, artifact quality, guardrails, evaluation rubric

- `backend/app/models/schemas.py`
  - extend contracts for auth, organizations, attempt state, scoring metadata

- `frontend/components/candidate/Workspace.tsx`
  - collaboration, autosave feedback, tabs, tests, richer IDE features

- `frontend/components/employer/PipelineView.tsx`
  - better observability, generation preview, retry/rebuild controls

- `frontend/lib/api.ts`
  - likely place to centralize auth headers and stronger typing

## 10. Notable Current Constraints

- no auth or organization boundary yet
- no background job system beyond `asyncio.create_task`
- candidate code execution is local-process based, not isolated enough for prod
- results page uses polling, not push
- frontend relies on multiple `any` types in API responses
- no automated test suite is present in the app code
- PM integrations are mocked/synthesized rather than connected
