# GenEx Development Matrix

Last reviewed: 2026-05-17

## 1. Domain Model Matrix

| Entity | Defined in | Used by | Notes |
|---|---|---|---|
| `JobSpec` | `backend/app/models/schemas.py` | employer create flow, agent pipeline | main employer intake contract |
| `ExtractedContext` | `schemas.py` | extractor, code author, assessment | recruiter/PM grounded context |
| `Codebase` / `CodeFile` | `schemas.py` | code author, bug injector, candidate session bootstrap, evaluator | generated artifact bundle |
| `BugInjectionBrief` | `schemas.py` | ticket author, bug injector | internal artifact only |
| `CandidateTicket` | `schemas.py` | ticket author, candidate UI, evaluator | recruiter-visible and candidate-visible task |
| `Assessment` | `schemas.py` | employer routes, orchestrator, pipeline UI | top-level assessment object |
| `Invite` | `schemas.py` | invite routes, email service, invite UI | token-based candidate entry |
| `CandidateSession` | `schemas.py` | candidate routes, workspace UI, evaluator | mutable candidate workspace state |
| `ActivityEvent` | `schemas.py` | monitor routes, heatmap, evaluator | behavior telemetry |
| `BuddyTurn` | `schemas.py` | buddy route/history, evaluator | persisted chat turns |
| `BuddyRequest` / `BuddyResponse` | `schemas.py` | buddy route, Buddy UI | structured Buddy contract |
| `EvaluationResult` | `schemas.py` | evaluator, results route, results UI | final assessment output |

## 2. Backend API Matrix

| Route | Method | Purpose | Main dependencies |
|---|---|---|---|
| `/health` | `GET` | health check | none |
| `/api/employer/jira/analyze` | `POST` | analyze Jira backlog into hiring signals + recruiter context | Jira service, LLM |
| `/api/employer/assessments` | `POST` | create assessment and start pipeline | `Assessment`, `build_assessment()` |
| `/api/employer/assessments` | `GET` | list assessments | store |
| `/api/employer/assessments/{id}` | `GET` | fetch one assessment | store |
| `/api/employer/assessments/{id}/stream` | `WS` | stream pipeline updates | store pub/sub |
| `/api/employer/assessments/{id}/invites` | `POST` | create candidate invites | store, email service |
| `/api/employer/assessments/{id}/invites` | `GET` | list invites | store |
| `/api/invites/{token}` | `GET` | invite landing data | store |
| `/api/invites/{token}/accept` | `POST` | bind invite to session | store |
| `/api/candidate/sessions` | `POST` | direct session creation | store |
| `/api/candidate/sessions/{id}` | `GET` | fetch session workspace | store |
| `/api/candidate/sessions/{id}/files` | `PUT` | save one file | store |
| `/api/candidate/sessions/{id}/run` | `POST` | execute current file | sandbox sync server |
| `/api/candidate/sessions/{id}/submit` | `POST` | evaluate final workspace | evaluator |
| `/api/buddy/ask` | `POST` | get hint/edit proposal | buddy agent, store |
| `/api/buddy/history/{id}` | `GET` | fetch buddy turns | store |
| `/api/monitor/events` | `POST` | record telemetry event | store |
| `/api/monitor/events/{id}` | `GET` | list telemetry events | store |
| `/api/monitor/sessions/{id}/stream` | `WS` | live event stream | store pub/sub |
| `/api/results/{id}` | `GET` | evaluation + heatmap | store, heatmap |

## 3. Frontend Route Matrix

| Route | Page file | Audience | Main responsibilities |
|---|---|---|---|
| `/` | `frontend/app/page.tsx` | public | landing/marketing |
| `/employer` | `frontend/app/employer/page.tsx` | employer | list assessments |
| `/employer/new` | `frontend/app/employer/new/page.tsx` | employer | create assessment |
| `/employer/[id]` | `frontend/app/employer/[id]/page.tsx` | employer | pipeline tracking, invite management |
| `/candidate/start?aid=` | `frontend/app/candidate/start/page.tsx` | candidate | direct start fallback |
| `/candidate/invite/[token]` | `frontend/app/candidate/invite/[token]/page.tsx` | candidate | invite landing and accept |
| `/candidate/[id]` | `frontend/app/candidate/[id]/page.tsx` | candidate | workspace IDE |
| `/results/[id]` | `frontend/app/results/[id]/page.tsx` | recruiter/candidate | evaluation and heatmap |

## 4. Component Responsibility Matrix

| Component | Area | State owner? | Notes |
|---|---|---|---|
| `Workspace` | candidate | yes | central candidate shell and interaction coordinator |
| `BuddyChat` | candidate | partial | owns message list and edit-card state |
| `CodeEditor` | candidate | no | Monaco wrapper only |
| `RunPanel` | candidate | no | presentational output panel |
| `TicketPanel` | candidate | no | task display |
| `JobForm` | employer | yes | manual JD, Jira backlog, and GitHub intake state |
| `PipelineView` | employer | yes | stream + polling orchestration |
| `InviteCard` | employer | yes | invite input and invite list state |
| `ScoreRing` | results | no | presentational |
| `SignalBars` | results | no | presentational |
| `Heatmap` | results | no | presentational, transforms cells into grid |

## 5. Agent Matrix

| Agent | Input | Output | Risk/importance |
|---|---|---|---|
| Extractor | `JobSpec` | `ExtractedContext` | quality of grounding affects all later stages |
| Code Author | `JobSpec`, `ExtractedContext` | `Codebase` | foundation for candidate realism |
| Ticket Author | `JobSpec`, `Codebase` | `BugInjectionBrief`, `CandidateTicket` | governs difficulty calibration |
| Bug Injector | `Codebase`, `BugInjectionBrief` | buggy `Codebase` | realism and solvability are critical |
| Buddy | `BuddyRequest` | `BuddyResponse` | must help without collapsing assessment value |
| Evaluator | ticket, golden code, session, events, chat | `EvaluationResult` | scoring trust depends on this |

## 6. Event / Telemetry Matrix

| Event kind | Produced from | Consumed by | Meaning |
|---|---|---|---|
| `edit` | monitor batching, Buddy apply flow | evaluator, heatmap | file modification intensity |
| `file_open` | session start | evaluator, heatmap | first file access |
| `file_switch` | workspace tab/tree changes | evaluator, heatmap | exploration behavior |
| `run` | run endpoint | evaluator, heatmap | verification behavior |
| `buddy_query` | Buddy route | evaluator, heatmap | help-seeking behavior |
| `buddy_hint` | Buddy route and dismiss action | evaluator, heatmap | hint delivery / hint interaction |
| `idle` | currently unused | future | reserved for inactivity tracking |
| `submit` | submit flow | evaluator, heatmap | end-of-session marker |

## 7. Persistence Matrix

| Data | Current store | Durability | Replacement candidate |
|---|---|---|---|
| assessments | memory dict | lost on restart | Postgres table |
| sessions | memory dict | lost on restart | Postgres table |
| invites | memory dict | lost on restart | Postgres table |
| buddy history | memory dict | lost on restart | Postgres table |
| events | memory dict | lost on restart | append-only events table |
| evaluations | memory dict | lost on restart | Postgres table or object store |
| pub/sub | asyncio queues | process-local only | Redis pub/sub or websockets hub |

Current code status:

- `memory` backend is still available
- `postgres` backend is now implemented for primary persistence
- pub/sub remains in-process for the single-sandbox deployment shape

## 8. Integration Matrix

| Integration | Location | Current maturity | Notes |
|---|---|---|---|
| Groq | `backend/app/core/llm.py` | active | still supported |
| OpenAI-compatible endpoint | `backend/app/core/llm.py` | active | intended for local Ollama-hosted `qwen2.5-coder:0.5b` |
| Jira Cloud backlog analysis | `backend/app/services/jira.py`, employer route | active | fetches backlog slice and derives recruiter context; credentials are not persisted |
| Resend | `backend/app/services/email.py` | optional | graceful fallback when unset |
| PM tools | extractor prompt + `pm_tool` field | partial | Jira backlog analysis is live; Linear remains mocked |
| Runtime execution | `candidate.py` run endpoint | sandbox-backed | executes inside the candidate workspace container |
| WebSockets | employer + monitor routes | active | used for pipeline/events, results still poll |

## 9. Improvement Hotspot Matrix

| Area | Why it matters | Likely files |
|---|---|---|
| persistence | biggest platform constraint today | `backend/app/store/memory.py`, route files, schemas |
| auth / org model | required for real employers/candidates | backend routes, frontend API, new middleware |
| sandboxing | current run model is not production safe | `backend/app/api/routes/candidate.py` |
| stronger typing | several frontend `any` usages hide regressions | `frontend/lib/api.ts`, page/component props |
| retryability / jobs | pipeline runs in-process only | `services/orchestrator.py`, employer routes |
| richer evaluation | scoring trust is product-critical | `agents/evaluator.py`, prompts |
| real PM integrations | improves grounding quality | `agents/extractor.py`, new integrations layer |
| candidate UX | workspace is core product surface | `components/candidate/*` |
| recruiter analytics | results UX can become much stronger | `results` components, heatmap service |

## 10. Suggested Sequencing For Future Work

Recommended order for serious product hardening:

1. Make Postgres the default backend and add migrations.
2. Introduce auth and organization boundaries.
3. Replace local code execution with isolated sandbox/container execution.
4. Strengthen frontend typing and backend validation contracts.
5. Add pipeline retry/rebuild controls and background job processing.
6. Expand recruiter analytics and evaluation explainability.
