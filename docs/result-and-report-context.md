# GenX Assessment — Candidate Result & Report: Implementation Context

**Feature:** Post-submission candidate result generation, behavioural tracking layer, and reviewer-facing report
**Owner:** SkillBrew.AI
**Status:** Mostly implemented — this doc reflects the as-built code, with known gaps marked

> This document is the merged spec for two originally-separate contexts (Behavioural Tracking + Candidate Report) **reconciled against the actual codebase**. Every path, route, and module name below has been verified against `frontend/` and `backend/`. Where the original spec used placeholders (e.g. Prisma, `src/lib/...`, Monaco), this version shows what the code actually does.

---

## 0. What this feature is

When a candidate submits an assessment, the system:

1. Captures a **behavioural event stream** during the session — idle periods, panel/ticket focus, keystroke buckets, paste events, content snapshots, AI interactions, terminal commands, window blur — sent in batches from the host (Next.js) UI to the Python backend.
2. On submit, the backend stores an `EvaluationResult` for the session. No pre-computed analytics cache exists.
3. When the reviewer opens `/results/[id]` (alias: `/review/[id]`), the backend **builds the full report on demand** from the raw event log + evaluation result + heatmap.

The report answers questions like:
- "Did this candidate understand the ticket before touching code, or panic-code immediately?"
- "They were idle for 8 minutes — when in the session, and what came before and after?"
- "Their final answer looks correct — did they write it or paste it fully formed?"

**What this is not:** A cheating detection system. GenX is not a proctoring platform. These signals are recruiter context, not verdicts. Framing in the UI reflects that.

---

## 1. Stack reality

| Layer | What it actually is |
|---|---|
| Frontend                 | Next.js 15 App Router (`frontend/`). All UI lives here. |
| Editor (coding tickets)  | **VS Code via code-server, embedded in a cross-origin iframe** (`Workspace.tsx:673`). Provisioned per-session by `POST /api/sandbox/provision/{sessionId}`. |
| Editor (non-coding)      | Monaco via `@monaco-editor/react` in `frontend/components/candidate/CodeEditor.tsx` — used only for inline answers, **not** the primary candidate editor. |
| Backend                  | Python (FastAPI-style) at `backend/app/`. All persistence, analytics, and report assembly. |
| Persistence              | `backend/app/store/` abstraction with in-memory and Postgres backends. **No Prisma.** |
| Domain models            | Pydantic (`backend/app/models/schemas.py`) on the backend; TypeScript (`frontend/lib/report-types.ts`) on the frontend. |
| Auth                     | **None today.** No Next.js `middleware.ts`. No JWT/session check on backend routes. Access is gated by session-ID obscurity. (Gap — see §13.) |

### Why VS Code (not Monaco) matters for tracking

The candidate-facing editor is a **cross-origin iframe to code-server**. The Next.js host **cannot**:
- Listen to `keydown` / `keyup` events inside the editor
- Listen to `paste` events inside the editor
- Read selection or cursor position inside the editor
- Inject any DOM-level instrumentation

This is enforced by the browser same-origin policy and is not bypassable from the host. As a consequence:

- "Per-keystroke" capture from the editor — as the original spec drafted using Monaco's `onKeyDown` — is **not implemented and not feasible from the host.** It would require a code-server extension installed in the sandbox image (deferred; see §14).
- The current `keystroke_bucket` event is emitted from the host based on `document`-level keyboard activity that lands while the editor iframe is **not** focused (e.g. terminal panel, AI panel, ticket panel). It captures global typing activity, not VS Code typing.
- Paste tracking is similarly limited.
- The content-delta layer (Dimension 4) is implemented instead via **file-sync diffing**: the host polls `api.getSandboxSync(sessionId)` and calls `behaviourTracker.recordContentSnapshot(sync.changed_files)` — this is what produces `content_delta_snapshot` events. No Ctrl+V interception is needed for the origin map; the diff between successive snapshots, cross-referenced with `ai_patch_accepted` events, is what attributes lines to manual vs AI vs paste vs unchanged.

The rest of the behavioural layer (idle, ticket focus, panel focus, window blur, AI interactions, terminal, git) works fine from the host since those signals live outside the iframe.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ Candidate session (in browser)                                        │
│                                                                       │
│  Workspace.tsx                                                        │
│    ├── VS Code iframe (code-server) ─── cross-origin, not instrumented│
│    ├── Ticket panel  ─┐                                               │
│    ├── AI/Buddy chat  ├── all wired to behaviourTracker.*             │
│    ├── Terminal       │   (host-level events)                         │
│    └── File tree etc. ┘                                               │
│                                                                       │
│  frontend/lib/behaviour-tracker.ts                                    │
│    ├── idle_start / idle_end                                          │
│    ├── ticket_focus_start / ticket_focus_end                          │
│    ├── keystroke_bucket  (host-side typing only)                      │
│    ├── content_paste     (host-side paste only)                       │
│    ├── content_delta_snapshot  (from sandbox file-sync diff)          │
│    ├── panel_focus_change                                             │
│    └── window_blur / window_focus                                     │
│                                                                       │
│  frontend/lib/monitor.ts  ─── queues events, flushes every 1.5s       │
└───────────────────────────────────┬──────────────────────────────────┘
                                    │  POST /api/monitor/events/batch
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Python backend (backend/app/)                                         │
│                                                                       │
│  api/routes/monitor.py        ─── receives + persists ActivityEvent[] │
│  api/routes/candidate.py      ─── on submit: evaluator.evaluate()     │
│                                    → stores EvaluationResult          │
│  store/ (memory | postgres)   ─── ActivityEvent, session, eval, etc.  │
│                                                                       │
│  services/behaviour.py        ─── compute_behaviour_analytics()       │
│  services/report.py           ─── build_report()                      │
│       └── called lazily on GET /api/results/{session_id}/report       │
└───────────────────────────────────┬──────────────────────────────────┘
                                    │  ReportData (TypedDict)
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Reviewer opens /results/[id] or /review/[id]                          │
│                                                                       │
│  frontend/app/results/[id]/page.tsx                                   │
│    polls api.getReport(id) every 3s until report.available === true,  │
│    then renders 19 section components from frontend/components/report/│
└──────────────────────────────────────────────────────────────────────┘
```

**Key invariants:**
- All analytics computation lives in **Python** (`backend/app/services/`), not TypeScript.
- The report is computed **lazily on each fetch**, not at submit time. There is no `CandidateResult.playbackMeta.analytics` JSON column — that was an aspirational spec; reality is server-side computation per request.
- No LLM calls during report rendering.
- All new behaviour events use the existing `ActivityEvent` model with new `EventKind` enum values — schemaless `payload` dict.

---

## 3. Routes and pages

| Concern | Path | Status |
|---|---|---|
| Report page (canonical) | `frontend/app/results/[id]/page.tsx` | ✅ Implemented (175 lines, composes all sections) |
| Report page (alias)     | `frontend/app/review/[id]/page.tsx`  | ✅ Aliases `/results/[id]` |
| Candidate workspace     | `frontend/app/candidate/[id]/page.tsx` → `Workspace.tsx` | ✅ |
| Submission confirmation | `frontend/app/candidate/submitted/[id]/page.tsx` | ✅ |
| Employer dashboard      | `frontend/app/employer/page.tsx`, `employer/[id]/page.tsx`, `employer/new/page.tsx` | ✅ |
| Auth middleware         | `frontend/middleware.ts` | ❌ **Does not exist.** No route protection. |

Component layout (`frontend/components/report/`) — all present:

```
ReportHeader.tsx          ← section 1
CQOverview.tsx            ← section 2
CQBreakdown.tsx           ← section 3 (5 component cards)
EmployerMetrics.tsx       ← section 4
BugExposureMap.tsx        ← section 5
AIInteraction.tsx         ← section 6
BehaviourPattern.tsx      ← section 7 (umbrella)
PhaseTimeline.tsx         ← 7a (Dim 6 — phase classifier)
PerTicketTime.tsx         ← 7b (Dim 1)
CodingRhythm.tsx          ← 7c (Dim 3 — keystrokes)
CodeOriginMap.tsx         ← 7d (Dim 4 — content delta)
IdleAnalysis.tsx          ← 7e (Dim 2)
PanelFlow.tsx             ← 7f (Dim 5)
IntegrityPanel.tsx        ← section 8
StrategyAnswers.tsx       ← section 9
CodeReviewPanel.tsx       ← section 10
ActivityForensicsPanel.tsx ← extra: raw activity forensics
BuddyAuditPanel.tsx       ← extra: AI co-pilot audit
FeedbackLogPanel.tsx      ← extra: candidate-facing feedback log
PlaybackCTA.tsx           ← bottom CTA
```

Result page data flow: `api.getReport(sessionId)` → `GET /api/results/{session_id}/report` → polls every 3s until `report.available === true`, then renders.

---

## 4. Behavioural tracking layer — six dimensions

Implemented in `frontend/lib/behaviour-tracker.ts` (357 lines, singleton `behaviourTracker`). Aggregation lives in `backend/app/services/behaviour.py::compute_behaviour_analytics()` (643 lines), called from `build_report()`.

Lifecycle: `Workspace.tsx:161` calls `behaviourTracker.start()` on mount, `.stop()` on unmount/submit ([Workspace.tsx:169, 414, 454](frontend/components/candidate/Workspace.tsx#L169)).

### Dimension 1 — Per-ticket time tracking ✅ implemented

- Host signal: `behaviourTracker.setTicket(ticketId)` called from `Workspace.tsx:175` when active challenge changes.
- Internal `TicketTimer` (lines 22–29 of `behaviour-tracker.ts`) accumulates `activeMs` / `idleMs` / `aiMs`.
- Events emitted: `ticket_focus_start`, `ticket_focus_end` with `{ticketId, durationSeconds, activeSeconds, idleSeconds}`.
- Aggregated server-side into `TicketTimeSummary[]` in `behaviour-analytics → per_ticket`.

### Dimension 2 — Idle detection (granular) ✅ implemented

- Threshold: `IDLE_THRESHOLD_MS = 15_000`, ticked every `TICK_MS = 5_000` (lines 36–37).
- Three tiers in `idle_end.tier`:
  - `think_pause` — 15–60 s
  - `extended_idle` — 1–5 min
  - `inactive` — > 5 min
- Context fields captured: `precedingActivity`, `precedingFile`, `followingActivity`, `followingEventType`.
- Reset events (all wired in `behaviour-tracker.ts` lines 76–82): `window.blur/focus`, `document.mousedown`, `document.scroll`, plus host-routed editor/AI/terminal activity from Workspace.
- Server interprets idle context in `_interpret_idle` in `services/behaviour.py` — keep this aligned (commented at top of `behaviour-tracker.ts`).

### Dimension 3 — Keystroke pattern tracking ⚠️ partial (host-only)

- Method: `behaviourTracker.recordKeystroke(special?)` (line 165). Each call increments `bucket.count`, appends an inter-key interval, increments `bucket.pauses` on >2s gaps, and increments the matching `special` counter.
- Flushed every `KEYSTROKE_FLUSH_MS = 10_000` as `keystroke_bucket` events with `{count, wpm, burst_score, pause_count, special_keys, active_file}`.
- **Limitation:** `recordKeystroke()` is only called from host-controlled inputs (AI prompt textarea, terminal panel, ticket answer fields). **Typing inside the VS Code iframe is invisible to the host** — those keystrokes are not captured.
- The original spec sketch used `editor.onKeyDown` on Monaco; this is dead code w.r.t. the candidate's actual coding editor. The `CodeEditor.tsx` Monaco mount (`frontend/components/candidate/CodeEditor.tsx:69–142`) is wired for keystroke capture but is only used for non-coding-challenge answer surfaces.
- **To capture real coding-editor typing**, install a code-server extension that posts events to the backend. Deferred — see §14.

### Dimension 4 — Content delta tracking ✅ implemented (via file-sync, not paste interception)

- The host polls the sandbox sync endpoint while the workspace is active (`Workspace.tsx:267–277`).
- On each sync, `behaviourTracker.recordContentSnapshot(sync.changed_files)` emits `content_delta_snapshot` events with `originBreakdown: { manualLines, aiPatchLines, pastedLines, unchangedLines }`.
- `aiPatchLines` and `pastedLines` are seeded from per-file state in `FileOriginState` (`behaviour-tracker.ts:31`), populated when `ai_patch_accepted` fires from the AI panel or `content_paste` fires from a host-side surface.
- A final snapshot is forced on submit (`Workspace.tsx:419–421`).
- `content_paste` events from inside the VS Code iframe are **not** captured. This is a known limitation — pastes that occur in the editor proper appear in the next file-sync diff as `manualLines` unless they happened to be detected at the host layer.

### Dimension 5 — Focus and attention tracking ✅ implemented

- `behaviourTracker.setPanel(panel)` is called everywhere the active panel changes in `Workspace.tsx` (lines 207, 211, 215, 218, 397, 518, 524).
- Emits `panel_focus_change` with `{panel, fromPanel, file?, ticketId?}`.
- `window_blur` / `window_focus` listeners installed in `behaviour-tracker.ts:77–78`. Blur duration is tracked via `pendingWindowBlurAt`.
- Server aggregates into `FocusPatternSummary` — `panelTimeBreakdown`, `ticketRereads`, `longestEditorStretch`, `windowBlurCount`, `windowBlurTotalSeconds`, `mostEditedFile`, `fileVisitOrder`.

### Dimension 6 — Problem-solving phase detection ✅ implemented (server-side)

- Lives in `backend/app/services/behaviour.py` — called as part of `compute_behaviour_analytics()`.
- Four phases: `exploration` | `planning` | `execution` | `verification`.
- Output shape: `PhaseSummary { phases[], timeInExploration, timeInPlanning, timeInExecution, timeInVerification, phaseSequence, hasVerificationPhase, explorationBeforeExecution }`.
- No separate `phase-classifier.ts` file in TypeScript — the original spec proposed one but the implementation is Python.
- Rendered by `PhaseTimeline.tsx` (7a).

---

## 5. Shadow event index (as actually emitted)

All events are stored as `ActivityEvent { id, session_id, kind, at, file_path?, payload }` with `kind` drawn from the `EventKind` enum (`backend/app/models/schemas.py` — 38 variants). The `category: 'behaviour'` field from the original spec **does not exist** — kinds are flat.

| Event kind | Emitter | Payload (key fields) |
|---|---|---|
| `idle_start`             | `behaviour-tracker.ts` | `preceding_event_type`, `preceding_activity`, `preceding_file` |
| `idle_end`               | `behaviour-tracker.ts` | `duration_seconds`, `tier`, `following_activity`, `following_event_type` |
| `ticket_focus_start`     | `behaviour-tracker.ts` | `ticket_id` |
| `ticket_focus_end`       | `behaviour-tracker.ts` | `ticket_id`, `duration_seconds`, `active_seconds`, `idle_seconds` |
| `keystroke_bucket`       | `behaviour-tracker.ts` | `count`, `wpm`, `burst_score`, `pause_count`, `special_keys`, `active_file` |
| `content_paste`          | host-side paste handlers | `file`, `character_count`, `content_hash`, `source_type` |
| `content_delta_snapshot` | `behaviour-tracker.ts` | `file`, `origin_breakdown` |
| `panel_focus_change`     | `behaviour-tracker.ts` | `panel`, `from_panel`, `file?`, `ticket_id?` |
| `window_blur`            | `behaviour-tracker.ts` | `active_panel` |
| `window_focus`           | `behaviour-tracker.ts` | `blur_duration_seconds` |
| `edit`                   | host file-sync          | `delta_chars` (no `file_edit` kind — uses generic `edit`) |
| `ai_user_message`, `ai_patch_proposed`, `ai_patch_accepted`, `ai_patch_rejected`, `ai_trap_*` | AI/Buddy chat | various |
| `git_commit`, `git_push`, `terminal_command`, `tab_opened`, `paste_large`, `tab_hidden`, `idle_timeout`, `session_start`, `submit` | various | various |

Endpoints (canonical names — **not** the originally-spec'd `/api/shadow/events`):
- `POST /api/monitor/events`                  — single
- `POST /api/monitor/events/batch`            — batched (frontend flushes here every 1.5s)
- `GET  /api/monitor/events/{session_id}`     — read back
- `WS   /api/monitor/sessions/{session_id}/stream` — live stream for recruiter live-view

---

## 6. Result computation (submit → report)

There is **no `CandidateResult` table** and **no `playbackMeta.analytics` JSON column**. Reality:

### Submit pipeline (`backend/app/api/routes/candidate.py::submit()`)

1. Marks session as submitted.
2. Calls `evaluator.evaluate()` (async) — LLM-backed agent that returns evaluation signals.
3. Stores an `EvaluationResult` record keyed by session ID.
4. Does **not** pre-compute the report or analytics.

### Report build (lazy, on each fetch)

- `GET /api/results/{session_id}/report` (`backend/app/api/routes/results.py:32–52`) calls:
- `backend/app/services/report.py::build_report(session, assessment, events, buddy_turns, evaluation, heatmap)` — 984 lines, returns a `ReportData` TypedDict matching the frontend's `frontend/lib/report-types.ts` shapes.
- `build_report()` calls `services/behaviour.py::compute_behaviour_analytics(events, assessment)` and embeds the result as `report["behaviour_analytics"]`.

If `EvaluationResult` is missing or pending, the endpoint returns `{ available: false }` and the frontend keeps polling.

### Files (Python, not TypeScript)

```
backend/app/services/
├── behaviour.py     ← compute_behaviour_analytics() — all 6 dimensions
├── report.py        ← build_report() — full report assembly
├── sandbox.py       ← code-server provisioning + file sync
└── … (evaluator, etc.)
```

The original spec proposed:
```
src/lib/analytics/behaviour-analytics.ts     ← NOT IMPLEMENTED — replaced by behaviour.py
src/lib/analytics/phase-classifier.ts        ← NOT IMPLEMENTED — folded into behaviour.py
src/lib/report/cq-summary.ts                 ← NOT IMPLEMENTED — built into report.py
src/lib/report/bug-exposure.ts               ← NOT IMPLEMENTED — built into report.py
src/lib/report/prompt-quality.ts             ← NOT IMPLEMENTED — built into report.py
src/lib/report/timeline-builder.ts           ← NOT IMPLEMENTED — built into report.py
```

These TypeScript utilities are **superseded by the Python `report.py`** which produces all the same derived values server-side. The frontend just renders.

---

## 7. Types

| Concern | Frontend (TypeScript) | Backend (Python) |
|---|---|---|
| Master domain types | `frontend/lib/report-types.ts` (377 lines) | `backend/app/models/schemas.py` (600+ lines) |
| Event types | `EventKind` referenced via API responses | `EventKind` enum + `ActivityEvent` Pydantic model |
| Report shape | `ReportData` interface | `ReportData` TypedDict |
| Behaviour shape | `BehaviourAnalytics` interface | mirrored TypedDict |

Already defined in `frontend/lib/report-types.ts`: `CQBreakdown`, `CQOverview`, `Heatmap` (≈ `HeatmapData`), `IntegrityFlag`, `IntegritySignals`, `CodeReviewFinding`, `CodeReview`, `BugExposure` (≈ `BugExposureMap`), `BehaviourAnalytics`, `ReportData`, `PromptEntry`, `AIInteraction`, `BehaviourPattern`, `ActivityForensics`, `BuddyAudit`, plus 7a–7f sub-shapes.

Convention: frontend uses camelCase, backend uses snake_case. The `api.getReport()` client handles the conversion. **Do not add `src/types/domain.ts`** — that path was speculative; the canonical location is `frontend/lib/report-types.ts`.

---

## 8. Report section specifications (as rendered today)

The page composes **19 components** in order — sections 1–10 from the original spec plus three additional panels (Activity Forensics, Buddy Audit, Feedback Log) that pre-date this consolidated spec and are kept for review.

### Section 1 — Candidate header (`ReportHeader.tsx`)

Data: `session.githubUserId`, `session.githubLogin` (fallback to ID), `startedAt`, `submittedAt`, `assessment.title`, `assessment.gaugingMetric`, `hiringNeed.{roleTitle, techStack, candidateLevel}`, `durationUsed` (derived), `durationAllotted`.

Display: avatar circle (initials), name + GitHub link, role/stack/seniority meta row, time + submission stats. Muted note if `durationUsed / durationAllotted < 0.5`.

### Section 2 — CQ score overview (`CQOverview.tsx`)

Data: `cqScore`, `cqBreakdown`, plus a one-line summary computed server-side in `report.py` (no client LLM call). Score colour thresholds: ≥75 green, 50–74 amber, <50 red. 5-bar component breakdown proportional to max points (trapHandling 40, promptQuality 20, codeCorrection 20, gitDiscipline 10, manualVsBlind 10).

### Section 3 — CQ breakdown (`CQBreakdown.tsx`)

Five sub-cards:
- **3a. Trap handling (max 40)** — outcome badge, expandable `trapConfig.badSuggestion`, flags for `ai_trap_accepted > 0`.
- **3b. Prompt quality (max 20)** — specific vs total prompt count, top 2 excerpts (120-char truncation).
- **3c. Code correction (max 20)** — patches accepted, edits-after-accept count, blind paste rate (>50% → red).
- **3d. Git discipline (max 10)** — commit timeline dots, commit/push counts. Single commit at session end → amber.
- **3e. Manual vs AI reliance (max 10)** — three-segment Editor/AI/Terminal bar from `heatmap`. `ai > 80` red, `ai === 0` amber.

Heatmap percentages always sum to 100 (normalised server-side).

### Section 4 — Employer metrics (`EmployerMetrics.tsx`)

Radar chart for ≥3 metrics (recharts), single bar for 1 metric. Placeholder if `analytics.metricScores` null. No crash on missing data.

### Section 5 — Bug exposure map (`BugExposureMap.tsx`)

Table: Bug ID · Type · One-line description · Status (Fixed/Noticed/Encountered/Missed). Status derived in `report.py` from event log: `tab_opened` on bug file → encountered, `edit` on bug file → noticed, ticket test pass → fixed.

### Section 6 — AI interaction (`AIInteraction.tsx`)

- **6a. Prompt log** — collapsible, chronological, full text. Quality tags ("Security-aware", "Edge-case aware", "Test-oriented", "Iterative", "Vague") derived server-side from keyword matching, not LLM.
- **6b. Patch stats** — proposed · accepted · rejected pills, donut chart (skip if `proposed === 0`).
- **6c. Trap scenario** — `trapConfig.badSuggestion` in code block, outcome badge.
- **6d. Model choice** — single muted line from first `ai_user_message.payload.model`.

### Section 7 — Behaviour and investigation pattern

`BehaviourPattern.tsx` is the umbrella component plus six sub-sections that consume `analytics.behaviour`:

| Sub-section | Component | Dimension |
|---|---|---|
| 7a. Phase timeline       | `PhaseTimeline.tsx`  | Dim 6 |
| 7b. Per-ticket time      | `PerTicketTime.tsx`  | Dim 1 |
| 7c. Coding rhythm        | `CodingRhythm.tsx`   | Dim 3 — host-only typing, see caveat in §4 |
| 7d. Code origin map      | `CodeOriginMap.tsx`  | Dim 4 — from file-sync, not Ctrl+V |
| 7e. Idle analysis        | `IdleAnalysis.tsx`   | Dim 2 |
| 7f. Panel flow           | `PanelFlow.tsx`      | Dim 5 |

When `analytics.behaviour` is null all six render graceful placeholders.

### Section 8 — Integrity signals (`IntegrityPanel.tsx`)

**Mandatory disclaimer** (always rendered, non-removable):
> "The signals below are passive indicators captured during the session. They are not proof of misconduct. Blurred windows, paste events, and idle periods all have legitimate explanations. Use this section as context, not as a verdict."

Score rendered in neutral colour — never red/green. Flag table: paste_large, window_blur, tab_hidden, idle_timeout. Empty array → "No integrity flags recorded in this session."

### Section 9 — Strategy answers (`StrategyAnswers.tsx`)

For each question (up to 3): bold question text · full answer (no truncation) · AI score bar (0–10) · evaluator note · tags. Null → placeholder, never omit.

### Section 10 — Code review (`CodeReviewPanel.tsx`)

From Reviewer Agent (`analytics.codeReview`). Three severity groups (Critical · Warning · Info), collapse empty groups. `isAiGeneratedError === true` → amber badge "Accepted from AI without correction". Zero critical → green banner.

### Extra sections (no original spec equivalent)

- **`ActivityForensicsPanel.tsx`** — raw activity / suspicious-event forensics for deeper review.
- **`BuddyAuditPanel.tsx`** — detailed audit of AI co-pilot turns (Buddy is the in-product name for the AI pair).
- **`FeedbackLogPanel.tsx`** — candidate-facing feedback events from the session.

### Playback CTA (`PlaybackCTA.tsx`)

Bottom card linking to `/playback/[sessionId]` (playback page is a separate task).

---

## 9. API endpoints used by the report layer

| Endpoint | Used for |
|---|---|
| `POST /api/monitor/events`            | single event |
| `POST /api/monitor/events/batch`      | batched events (frontend, every 1.5s) |
| `GET  /api/monitor/events/{sid}`      | read full event log |
| `WS   /api/monitor/sessions/{sid}/stream` | live recruiter stream |
| `POST /api/sandbox/provision/{sid}`   | provision code-server sandbox |
| `GET  /api/sandbox/sync/{sid}`        | pull changed files for content-delta snapshots |
| `POST /api/candidate/sessions/{sid}/submit` | submit session, kicks off `evaluator.evaluate()` |
| `GET  /api/results/{sid}/report`      | build + return the report (lazy) |

The original spec named `POST /api/shadow/events` and `GET /api/report/[sessionId]`. **Those names are not used**; the canonical names are above. Update any new code to call `api.recordEvents()` / `api.getReport()` from `frontend/lib/api.ts`, which already wraps the real endpoints.

---

## 10. Privacy and consent

- **Consent notice on briefing page** before assessment start (per original spec). **Status: verify** — search `app/candidate/start/page.tsx` and `app/candidate/invite/[token]/page.tsx` to confirm copy exists.
- **No key content capture** — `keystroke_bucket` records timing/count only; special keys are categorised, not stored as characters. ✅ Verified in `behaviour-tracker.ts`.
- **Content hash only on paste** — `content_paste.payload.content_hash` (SHA-256), no plaintext. ✅
- **Data retention** — events follow the same retention as all `ActivityEvent` rows; no separate longer-term store.

---

## 11. Recruiter interpretation guide

Each behavioural sub-section should show a collapsible "How to read this" tooltip with:

| Signal | Positive | Negative | Do not conclude |
|---|---|---|---|
| Long think pauses     | Processing complexity | Stuck, confused              | "Candidate is slow" |
| High idle %           | Methodical            | Disengaged, distracted       | "Candidate cheated" |
| Paste-dominant        | Efficient tool use    | Low manual understanding     | "Candidate cannot code" |
| Zero exploration      | Familiar with codebase| Overconfident                | "Bad engineer" |
| High undo rate        | Iterative             | Uncertain                    | Correlate with output |
| Short per-ticket time | Efficient             | Rushed                       | Depends on output quality |
| Ticket not re-read    | Confident             | Forgot requirements          | Cross-reference with AC completion |

**Status:** Verify each section component renders this tooltip. If missing, add to the respective `*.tsx`.

---

## 12. Graceful degradation rules

The report must render at all data completeness levels.

| Field missing | What to render |
|---|---|
| `EvaluationResult` not yet stored      | `{ available: false }` from backend → frontend keeps polling every 3s |
| `analytics.behaviour` null             | Section 7 sub-sections each render placeholder |
| `cqBreakdown` null but `cqScore` set   | Show score only, omit component bars |
| `integritySignals` null                | "No integrity flags recorded" |
| `heatmap` null                         | Omit heatmap — do not show empty chart |
| `trapConfig` null                      | Omit trap card — "No trap configured for this assessment" |
| `strategyResponses` null               | Placeholder block (do not omit section) |
| `codeReview` null                      | "No code review on record — candidate may not have pushed" |
| Zero events                            | All event-derived sub-sections show "No data recorded" |

Verify each `frontend/components/report/*.tsx` handles its null input gracefully.

---

## 13. Known gaps and follow-ups

These are real gaps between the original spec and what ships today. Each is a candidate follow-up task.

1. **No auth on `/results/*` / `/review/*` or backend routes.** Original spec assumed GitHub OAuth middleware; none exists. Anyone with the session ID can fetch the report. Decide: add `frontend/middleware.ts` + backend session validation, or accept session-ID-as-token model.
2. **No keystroke or paste capture from inside the VS Code iframe.** Coding rhythm (7c) and code origin (7d) are based on host-only signals + file-sync diffs. To get true editor-level keystrokes, build a code-server extension that posts events to `/api/monitor/events/batch`. Add to the code-server sandbox image.
3. **No terminal-command capture from inside code-server.** Server-side report logic (`behaviour.py`, `report.py`) already assumes `terminal_command` events with `payload.command` exist, but the only emitter today is the host-side SQL runner ([Workspace.tsx:368](frontend/components/candidate/Workspace.tsx#L368)). Commands run in the VS Code integrated terminal are invisible. **Plan in §16.** Until this lands, verification-phase scoring, heatmap terminal-time, and the report narrator's "Ran terminal command" lines are starved.
4. **Report is computed on every fetch.** No cache. For very large event logs (>5000) this may be slow. Consider caching `build_report()` output keyed by `(session_id, last_event_seq)` in `store/`.
5. **Endpoint naming drift from original spec.** Anywhere a doc, comment, or external integration references `/api/shadow/events` or `/api/report/[sessionId]`, update to the canonical `/api/monitor/events/batch` and `/api/results/{sid}/report`.
6. **Consent copy unverified.** Confirm the briefing page renders the consent notice (§10) before session start.
7. **No `playbackMeta` field.** If any doc/PR references `CandidateResult.playbackMeta.analytics`, update to "ReportData returned by `GET /api/results/{sid}/report`".
8. **Phase classifier accuracy.** `compute_behaviour_analytics` produces phase segments but its scoring weights have not been calibrated against labelled sessions. Worth a one-off review with real submission data.

---

## 14. Planned: terminal command capture + consolidated Session Logs panel

Status: **planned, not yet implemented.** This section is the design contract — implement against it.

### 14.1 Why

Today the only `terminal_command` events come from the host-side SQL runner. Commands run in the candidate's **actual** terminal — the VS Code integrated terminal inside the code-server iframe — are not captured. The recruiter currently sees no evidence of: tests run, dev servers started, files inspected via `cat`/`grep`, git operations done from the CLI, package installs, lint commands, etc.

### 14.2 Capture mechanism — shell hook (Option A)

The candidate's terminal is locked to a custom shell (`genex-shell`) which is the only terminal entry point inside the sandbox container. The shell already enforces a `trap … DEBUG` (preexec) and `PROMPT_COMMAND` (postexec) at [.devcontainer/genex-shell-rc.sh:111–112](.devcontainer/genex-shell-rc.sh#L111). We extend those hooks to emit one `terminal_command` event per executed command. Nested shells (`bash`, `sh`, `zsh`, `sudo`, `su`) are already blocked at [genex-shell-rc.sh:40–51](.devcontainer/genex-shell-rc.sh#L40), so this hook is the single chokepoint.

**Container env (passed via `sandbox-entrypoint.sh`):**

```bash
GENEX_REPORT_URL=http://genex-backend:8000     # internal Docker hostname for the backend
GENEX_SESSION_ID="$(basename "$GENEX_SESSION_ROOT")"
```

**Hook additions to `genex-shell-rc.sh`:**

```bash
__genex_cmd_start_ts=0
__genex_cmd_buffer=""

__genex_preexec_capture() {
  local raw="${BASH_COMMAND:-}"
  case "$raw" in __genex_*|"") return 0 ;; esac
  __genex_cmd_start_ts=$(date +%s%3N)
  __genex_cmd_buffer="$raw"
}

__genex_postexec_send() {
  local rc=$?
  [[ -z "$__genex_cmd_buffer" ]] && return 0
  local end_ts; end_ts=$(date +%s%3N)
  local redacted="$__genex_cmd_buffer"
  case "$redacted" in
    export*=*|set*=*|*PASSWORD*|*TOKEN*|*SECRET*|*KEY=*) redacted="<redacted>" ;;
  esac
  # detached, capped at 1s, never blocks the prompt
  curl -sS --max-time 1 -X POST "$GENEX_REPORT_URL/api/monitor/events" \
    -H 'Content-Type: application/json' \
    --data-binary @- >/dev/null 2>&1 <<JSON &
{
  "session_id": "$GENEX_SESSION_ID",
  "kind": "terminal_command",
  "payload": {
    "command":     "$(printf '%s' "$redacted" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read())[1:-1])')",
    "cwd":         "$PWD",
    "exit_code":   $rc,
    "duration_ms": $((end_ts - __genex_cmd_start_ts))
  }
}
JSON
  __genex_cmd_buffer=""
}

trap '__genex_preexec_guard || false; __genex_preexec_capture' DEBUG
PROMPT_COMMAND='__genex_enforce_pwd; __genex_postexec_send'
```

The existing `__genex_preexec_guard` (nested-shell blocker) and `__genex_enforce_pwd` (path enforcement) are preserved — capture is composed alongside them.

**Constraints / contract:**
- Output (stdout/stderr) is **not** captured in v1. Recruiter value is mostly "did command X run, what was the exit code, when in the session." Output capture is parked behind a Phase 2 PTY-recording option.
- Network failure must be silent — the candidate's prompt must never lag because the backend is down. `--max-time 1` plus `&` plus `>/dev/null 2>&1` ensure this.
- Secret redaction is keyword-based at the shell level (`export … =`, `set … =`, anything containing `PASSWORD|TOKEN|SECRET|KEY=`). Conservative — false positives are fine; false negatives are not. Backend also runs a second redaction pass.
- `curl` and `python3` must be in the locked PATH (`/usr/local/bin:/usr/bin:/bin`). Verify in the sandbox Dockerfile.

### 14.3 Backend — payload schema and derivation

The existing `EventKind.TERMINAL_COMMAND` enum value is reused — no schema migration. Document the payload contract:

```python
# ActivityEvent(kind="terminal_command").payload
{
    "command":     str,    # redacted at shell layer + sanity-redacted again server-side
    "cwd":         str,    # absolute path inside the sandbox
    "exit_code":   int,    # 0 = success
    "duration_ms": int,
    "category":    str,    # derived server-side; see below — not sent from shell
}
```

**`category` derivation** (added in `backend/app/services/report.py`, used by the new Session Logs panel and by `compute_behaviour_analytics` for verification-phase scoring):

```python
def categorise_terminal_command(command: str) -> str:
    cmd = command.lower().strip()
    head = cmd.split()[0] if cmd else ""
    if any(kw in cmd for kw in ("pytest", "jest", "vitest", "mocha", "go test", "cargo test")) or head == "test":
        return "test"
    if head == "git":
        return "git"
    if head in {"npm", "yarn", "pnpm", "pip", "pip3", "poetry", "uv"} and any(s in cmd for s in (" install", " add", " i ", " i\n")):
        return "install"
    if head in {"node", "python", "python3", "deno", "go", "cargo", "npm", "yarn", "pnpm"} and " run " in cmd:
        return "run"
    if head in {"cat", "less", "head", "tail", "grep", "rg", "find", "ls", "tree"}:
        return "inspect"
    return "other"
```

Existing consumers ([behaviour.py:522](backend/app/services/behaviour.py#L522), [report.py:617](backend/app/services/report.py#L617), [report.py:828](backend/app/services/report.py#L828)) need no change — they already key off `kind == "terminal_command"` and read `payload.command`. They get richer once real events flow.

### 14.4 Frontend — consolidated Session Logs panel

Per product decision: **one component renders all logs in a filterable table**, replacing the existing `ActivityForensicsPanel.tsx` (which becomes a thin wrapper or is removed).

**Component:** `frontend/components/report/SessionLogsPanel.tsx`

**Input shape** (added to `ReportData` returned by `build_report()`):

```typescript
interface SessionLogEntry {
  id: string                  // ActivityEvent.id
  ts: string                  // ISO timestamp
  ts_offset_ms: number        // ms from session.startedAt — used for the timeline column
  kind: string                // EventKind value
  category: LogCategory       // grouping for the filter UI — see below
  summary: string             // short human label, ≤80 chars (e.g. "npm test → exit 1")
  exit_code?: number | null   // populated for terminal_command
  duration_ms?: number | null
  file?: string | null
  ticket_id?: string | null
  details: Record<string, unknown>  // raw payload for the expanded detail view
}

type LogCategory =
  | 'terminal'    // terminal_command (sub-tagged by category: test/git/install/run/inspect/other)
  | 'ai'          // ai_user_message, ai_patch_*
  | 'git'         // git_commit, git_push (plus terminal_command of category 'git')
  | 'editor'      // edit, content_paste, content_delta_snapshot
  | 'focus'       // panel_focus_change, window_blur, window_focus
  | 'idle'        // idle_start, idle_end (inactive tier only — think_pause too noisy by default)
  | 'session'     // session_start, submit, terminal_open/clear, etc.

interface SessionLogs {
  entries: SessionLogEntry[]
  total: number
  category_counts: Record<LogCategory, number>
}
```

`SessionLogs` is built server-side by a new function `build_session_logs(events, session)` in `backend/app/services/report.py` and attached to `ReportData.session_logs`.

**UI — table view with click-to-inspect:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Session logs                                                       [filters] │
│ ┌────────────────────────────────────────────────────────────────────────┐  │
│ │ ☑ All  ☐ Terminal (24) ☐ AI (12) ☐ Git (5) ☐ Editor (143) ☐ Focus (31)│  │
│ │ ☐ Idle (8) ☐ Session (6)         Search: [_________________]          │  │
│ └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Time     Category    Summary                                  Status        │
│  ──────── ─────────── ─────────────────────────────────────── ────────       │
│  00:02:14 ● Terminal  npm install                              ✓             │
│  00:04:01 ● Git       git checkout -b feature/auth             ✓             │
│  00:06:33 ● AI        prompt: "how should I structure auth …"  —             │
│  00:08:12 ● Terminal  pytest tests/auth                        ✕ exit 1      │
│           └──────────── click row to expand ─────────────────────────┐       │
│              cwd: /sessions/<sid>/backend                            │       │
│              duration: 1234 ms                                       │       │
│              raw payload: { … }                                      │       │
│           ────────────────────────────────────────────────────────── ┘       │
│  00:09:40 ● Editor    pasted 32 chars into app/routes/auth.py    —           │
│  …                                                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

**UX rules:**
- **Default visible categories:** Terminal, AI, Git (the high-signal ones). Editor/Focus/Idle/Session are hidden by default but one-click to enable — keeps the default view skim-friendly.
- **Row click expands inline** with full payload (no modal). Click again to collapse. At most one row expanded at a time.
- **Status column:** exit-code badge for terminal rows (`✓` zero, `✕ exit N` non-zero); patch outcome for AI rows (accepted/rejected); empty for everything else.
- **Time column** shows `mm:ss` offset from session start, not wall clock — reviewers think in session-relative time.
- **Search input** filters `summary` and `details` JSON.
- **Empty state:** "No session events recorded." per category if filtered to zero.
- **Performance:** virtualise the list if `entries.length > 500` (use `@tanstack/react-virtual` or similar). Server caps entries at e.g. 5000 with a "log truncated, see playback for full stream" note.

**Where it sits in the page:** replace the existing `ActivityForensicsPanel` slot in [results/[id]/page.tsx](frontend/app/results/[id]/page.tsx). Same position. The detailed sub-section components (7a–7f) are unchanged — they continue to render aggregated views. The Session Logs panel is the raw event drill-down beneath them.

### 14.5 Implementation order

1. **Container:** patch `Dockerfile.sandbox` to ensure `curl` + `python3` available; patch `sandbox-entrypoint.sh` to export `GENEX_REPORT_URL` and `GENEX_SESSION_ID`.
2. **Shell:** extend `.devcontainer/genex-shell-rc.sh` with the preexec/postexec capture above.
3. **Backend:** add `categorise_terminal_command()` + `build_session_logs()` in `services/report.py`. Add `session_logs` to `ReportData`. Add a defensive secret-redaction pass on `payload.command` in `api/routes/monitor.py`.
4. **Frontend:** add `SessionLogs` types to `lib/report-types.ts`. Build `SessionLogsPanel.tsx`. Swap it for `ActivityForensicsPanel` in the report page. Remove the old panel once the new one ships.
5. **QA:** run a candidate session, run `npm test`/`git status`/`cat README.md`, confirm events land in `/api/monitor/events/{sid}` and render in the panel with correct categories and exit codes.

### 14.6 Acceptance criteria (for this planned work)

- [ ] `terminal_command` events fire from inside the VS Code integrated terminal — one per command, regardless of where in the file tree the candidate is.
- [ ] Exit codes recorded accurately for both success and failure paths.
- [ ] Backend never receives plaintext `export FOO=secret` lines — both shell-layer and server-layer redaction pass.
- [ ] Candidate prompt latency remains < 50 ms when backend is up; remains < 50 ms when backend is **down** (proves detachment works).
- [ ] `categorise_terminal_command()` assigns the expected category for 20 hand-picked common cases (test runners, package managers, git, cat/ls, dev-server start).
- [ ] `SessionLogsPanel` renders ≤ 200ms for a session with 1000 entries; virtualisation kicks in above 500.
- [ ] Filter toggles update the view without re-fetching from server.
- [ ] Row expand shows the full raw `payload` and matches what's stored in `ActivityEvent`.
- [ ] `ActivityForensicsPanel` is fully removed once the new panel ships — no two log views.

---

## 15. Do not implement in this feature

- Shadow playback video player — separate task, separate page (`/playback/[sessionId]`)
- Candidate comparison view — separate task at `/employer/[id]/compare`
- PDF/export of report — Phase 2
- Real-time score updates — report is static after submit
- LLM calls from the report page — all derivation lives in `services/report.py`, deterministic

---

## 16. Acceptance criteria (current state)

**Behavioural tracking layer:**
- [x] `idle_start` / `idle_end` fire for all three tier thresholds (`behaviour-tracker.ts`)
- [x] Idle events capture preceding/following context
- [x] `ticket_focus_end` fires on ticket switch + on submit (`stop()`)
- [x] `keystroke_bucket` flushes every 10s on host-side typing
- [ ] **Gap:** `keystroke_bucket` does **not** capture VS Code iframe typing (needs code-server extension)
- [x] Special key counts correct in host-captured surfaces
- [ ] **Gap:** `content_paste` does **not** fire on Ctrl+V inside VS Code (origin is recovered from file-sync diff instead)
- [x] `panel_focus_change` fires on every host panel switch
- [x] All new events stored as `ActivityEvent` rows
- [x] `compute_behaviour_analytics` runs without crash on zero events
- [x] Phase classifier produces ≥1 segment for any session > 60s
- [x] No key character values stored in any event payload
- [ ] **Verify:** Consent notice present on briefing page

**Report page:**
- [x] All 19 section components present
- [x] Page polls `getReport()` until `available === true`, then renders
- [x] Section 7 sub-sections render placeholders when `behaviour` is null
- [x] No LLM API calls during render (all derivation server-side, deterministic)
- [ ] **Gap:** `/review/*` routes are **not** protected by middleware
- [ ] **Verify:** mobile layout (≤480px) stacks correctly with no horizontal scroll
- [ ] **Verify:** integrity disclaimer is unconditionally rendered in `IntegrityPanel.tsx`
- [ ] **Verify:** recruiter interpretation tooltip present in each Section-7 sub-component

**Terminal capture + Session Logs panel (planned — see §14):**
- [ ] `terminal_command` events fire from inside the VS Code integrated terminal — one per command
- [ ] Exit codes recorded accurately for success and failure paths
- [ ] Two-layer secret redaction (shell + server) — no plaintext `export FOO=secret` lines reach storage
- [ ] Candidate prompt latency < 50 ms even when backend is unreachable
- [ ] `categorise_terminal_command()` correctly tags 20 hand-picked common commands
- [ ] `SessionLogsPanel` renders ≤ 200 ms at 1000 entries; virtualisation kicks in above 500
- [ ] Filter toggles update the view client-side (no re-fetch)
- [ ] Row click expands inline with raw payload; only one row expanded at a time
- [ ] `ActivityForensicsPanel` removed after `SessionLogsPanel` ships — no two log views in the report

---

## 17. Reference: where things actually live

```
frontend/
├── app/
│   ├── candidate/[id]/page.tsx          ← session entry → Workspace.tsx
│   ├── candidate/submitted/[id]/page.tsx
│   ├── results/[id]/page.tsx            ← REPORT PAGE (canonical)
│   └── review/[id]/page.tsx             ← REPORT PAGE (alias)
├── components/
│   ├── candidate/
│   │   ├── Workspace.tsx                ← orchestrates VS Code iframe + panels + tracker
│   │   ├── CodeEditor.tsx               ← Monaco (non-coding-challenge surface only)
│   │   ├── BuddyChat.tsx                ← AI co-pilot panel
│   │   ├── TicketPanel.tsx, RunPanel.tsx, SearchPanel.tsx, FileTree.tsx, ChallengePanel.tsx
│   └── report/
│       └── …19 section components (see §3)
├── lib/
│   ├── behaviour-tracker.ts             ← all client-side dimension capture
│   ├── monitor.ts                       ← event queue → /api/monitor/events/batch
│   ├── api.ts                           ← typed client for the Python backend
│   └── report-types.ts                  ← all frontend domain types
└── (no middleware.ts)

backend/
├── app/
│   ├── api/routes/
│   │   ├── monitor.py                   ← /api/monitor/events*
│   │   ├── candidate.py                 ← session lifecycle, submit, evaluator dispatch
│   │   ├── results.py                   ← /api/results/{sid}/report
│   │   └── sandbox.py                   ← /api/sandbox/provision, /sync
│   ├── services/
│   │   ├── behaviour.py                 ← compute_behaviour_analytics()
│   │   ├── report.py                    ← build_report() — all section assembly
│   │   ├── sandbox.py                   ← code-server orchestration
│   │   └── evaluator.py, …
│   ├── store/                           ← memory + postgres backends
│   └── models/schemas.py                ← Pydantic + EventKind enum (38 variants)
```
