"""Derives the full reviewer report payload from primitives already in the store.

Inputs: CandidateSession, Assessment, ActivityEvent[], BuddyTurn[], EvaluationResult,
        Heatmap. Outputs the structured report object the /review/[id] UI renders.

No LLM calls. Everything here is deterministic aggregation/templating so the page
loads fast and the same submitted session produces the same report every time.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Literal, TypedDict

from app.models.schemas import (
    ActivityEvent,
    Assessment,
    BuddyTurn,
    CandidateFeedback,
    CandidateSession,
    EvaluationResult,
)
from app.services.behaviour import (
    BehaviourAnalytics,
    compute_behaviour_analytics,
)
from app.services.heatmap import Heatmap


# ── Output shapes ────────────────────────────────────────────────────────────


class CandidateHeader(TypedDict):
    candidate_name: str
    assessment_title: str
    role_title: str
    tech_stack: list[str]
    seniority: str
    duration_used_min: int | None
    duration_allotted_min: int
    started_at: str
    submitted_at: str | None
    finished_early: bool


class CQComponent(TypedDict):
    key: str
    label: str
    score: float
    max: float
    note: str


class CQBreakdown(TypedDict):
    total: float
    components: list[CQComponent]


class CQOverview(TypedDict):
    score: int  # 0..100
    summary: str
    breakdown: CQBreakdown


class MetricScore(TypedDict):
    key: str
    label: str
    score: float
    max: float


class BugRow(TypedDict):
    id: str
    bug_type: str
    description: str
    status: Literal["missed", "encountered", "noticed", "fixed"]


class BugExposure(TypedDict):
    rows: list[BugRow]
    fixed_count: int
    missed_count: int
    total: int


class PromptEntry(TypedDict):
    at: str
    content: str
    file_context: str | None
    tags: list[str]


class TrapDetail(TypedDict):
    configured: bool
    bad_suggestion: str
    trigger: str
    outcome: Literal["passed", "failed", "not_triggered"]


class AIInteraction(TypedDict):
    prompts: list[PromptEntry]
    prompt_count: int
    proposed: int
    accepted: int
    rejected: int
    blind_paste_rate: float  # 0..1
    edits_after_accept: int
    trap: TrapDetail
    model_used: str


class TimelineMarker(TypedDict):
    label: str
    at: str
    offset_pct: float  # 0..100


class HeatmapMix(TypedDict):
    editor: int  # %
    ai: int
    terminal: int


class Verification(TypedDict):
    ran_tests: bool
    verified_ai_patches: bool
    small_commits: bool


class BehaviourPattern(TypedDict):
    timeline: list[TimelineMarker]
    files_before_first_edit: int
    time_to_first_edit_min: int | None
    total_files_opened: int
    investigation_note: str
    heatmap_mix: HeatmapMix
    verification: Verification


class IntegrityFlag(TypedDict):
    type: str
    label: str
    count: int
    total_duration_seconds: int | None
    details: str


class IntegritySignals(TypedDict):
    score: int  # 0..100, neutral
    flags: list[IntegrityFlag]
    disclaimer: str


class StrategyAnswer(TypedDict):
    question: str
    answer: str
    score: float
    max: float
    note: str
    tags: list[str]


class CodeReviewFinding(TypedDict):
    severity: Literal["critical", "warning", "info"]
    file: str
    line: int | None
    message: str
    is_ai_generated_error: bool


class CodeReview(TypedDict):
    summary: str
    findings: list[CodeReviewFinding]
    critical_count: int
    warning_count: int
    info_count: int


class FileLineRange(TypedDict):
    start_line: int
    end_line: int
    change_type: str


class FileActivitySummary(TypedDict):
    file_path: str
    active_seconds: int
    total_events: int
    edit_events: int
    line_ranges: list[FileLineRange]
    first_at: str | None
    last_at: str | None


class ActivityTraceEntry(TypedDict):
    at: str
    kind: str
    file_path: str | None
    line_start: int | None
    line_end: int | None
    summary: str


class ActivityForensics(TypedDict):
    total_events: int
    tracked_files: int
    file_summaries: list[FileActivitySummary]
    recent_entries: list[ActivityTraceEntry]


class BuddyTranscriptEntry(TypedDict):
    at: str
    role: str
    content: str
    challenge_id: str | None
    open_file: str | None
    blocked: bool
    hint_level: str | None
    edit_targets: list[str]


class BuddyEditAction(TypedDict):
    at: str
    action: str
    file_path: str | None
    challenge_id: str | None
    rationale: str


class BuddyAudit(TypedDict):
    total_messages: int
    blocked_messages: int
    proposed_edits: int
    applied_edits: int
    dismissed_edits: int
    transcript: list[BuddyTranscriptEntry]
    actions: list[BuddyEditAction]


class FeedbackEntry(TypedDict):
    id: str
    category: str
    message: str
    challenge_id: str | None
    status: str
    created_at: str


class ReportPreviewSnapshot(TypedDict):
    fixed_bugs: int
    total_bugs: int
    ai_prompt_count: int
    files_touched: int
    terminal_commands: int
    highlights: list[str]


class ReportPreviewData(TypedDict):
    available: bool
    header: CandidateHeader
    cq: CQOverview | None
    metrics: list[MetricScore]
    snapshot: ReportPreviewSnapshot
    lock_reason: str
    unlock_label: str


class ReportData(TypedDict):
    available: bool  # false until evaluation exists
    header: CandidateHeader
    cq: CQOverview | None
    metrics: list[MetricScore]
    bug_exposure: BugExposure
    ai: AIInteraction
    behaviour: BehaviourPattern
    behaviour_analytics: BehaviourAnalytics  # Section 7a–7f
    integrity: IntegritySignals
    strategy: list[StrategyAnswer]
    code_review: CodeReview | None
    activity_forensics: ActivityForensics
    buddy_audit: BuddyAudit
    feedback_log: list[FeedbackEntry]
    playback_url: str
    heatmap: Heatmap


# ── Helpers ──────────────────────────────────────────────────────────────────


_INTEGRITY_DISCLAIMER = (
    "The signals below are passive indicators captured during the session. "
    "They are not proof of misconduct. Blurred windows, paste events, and idle "
    "periods all have legitimate explanations. Use this section as context, "
    "not as a verdict."
)


_PROMPT_TAG_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Security-aware": ("security", "injection", "sanit", "validate", "auth", "xss", "csrf"),
    "Edge-case aware": ("edge case", "boundary", "null", "undefined", "error", "failure", "exception"),
    "Test-oriented": ("test", "coverage", "unit", "assert", "spec"),
}


def _classify_prompt(content: str, is_followup: bool) -> list[str]:
    lower = content.lower()
    tags: list[str] = []
    for tag, kws in _PROMPT_TAG_KEYWORDS.items():
        if any(k in lower for k in kws):
            tags.append(tag)
    if is_followup:
        tags.append("Iterative")
    if not tags and len(content) < 40:
        tags.append("Vague")
    return tags


def _seconds(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds()


def _safe_int(value: object) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _minutes_used(session: CandidateSession) -> int | None:
    if not session.submitted_at:
        return None
    return max(0, int(_seconds(session.started_at, session.submitted_at) / 60))


# ── Section builders ─────────────────────────────────────────────────────────


def _build_header(session: CandidateSession, assessment: Assessment) -> CandidateHeader:
    job = assessment.job
    duration_used = _minutes_used(session)
    allotted = job.duration_minutes or 60
    finished_early = (
        duration_used is not None
        and allotted > 0
        and duration_used / allotted < 0.5
    )
    tech = list(dict.fromkeys(job.must_have_skills + job.nice_to_have_skills))
    return CandidateHeader(
        candidate_name=session.candidate_name or "Candidate",
        assessment_title=job.title,
        role_title=job.title,
        tech_stack=tech,
        seniority=job.seniority,
        duration_used_min=duration_used,
        duration_allotted_min=allotted,
        started_at=session.started_at.isoformat(),
        submitted_at=session.submitted_at.isoformat() if session.submitted_at else None,
        finished_early=finished_early,
    )


# Map evaluator signals (0..1 each) onto the CQ breakdown using fixed max points.
# When a named signal exists in the evaluation we use it; otherwise we fall back
# to derived ratios from the event log so every component renders.
_CQ_COMPONENTS: list[tuple[str, str, float, str]] = [
    ("trap_handling", "Trap handling", 40.0,
     "How the candidate reacted to risky AI suggestions."),
    ("prompt_quality", "Prompt quality", 20.0,
     "How specific and contextual the AI prompts were."),
    ("code_correction", "Code correction", 20.0,
     "How much the candidate verified or fixed AI output."),
    ("git_discipline", "Git discipline", 10.0,
     "Commit cadence and message quality."),
    ("manual_vs_blind", "Manual vs AI reliance", 10.0,
     "Balance of self-driven edits versus AI-driven ones."),
]


def _derive_cq(
    evaluation: EvaluationResult | None,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
) -> CQOverview | None:
    if evaluation is None:
        return None

    signal_by_name = {s.name.lower(): s.score for s in evaluation.signals}

    # Event-derived fallbacks (0..1)
    by_kind: dict[str, int] = defaultdict(int)
    for e in events:
        by_kind[e.kind.value] += 1
    edits = by_kind.get("edit", 0)
    buddy_q = by_kind.get("buddy_query", 0)
    runs = by_kind.get("run", 0) + by_kind.get("terminal_command", 0)

    prompt_specificity = 0.0
    if buddy_history:
        specific = sum(
            1 for t in buddy_history
            if t.role == "user" and _classify_prompt(t.content, False)
        )
        prompt_specificity = specific / max(
            sum(1 for t in buddy_history if t.role == "user"), 1
        )

    manual_ratio = edits / max(edits + buddy_q, 1)
    verification_ratio = runs / max(edits, 1)
    verification_ratio = min(verification_ratio, 1.0)

    fallbacks = {
        "trap_handling": 1.0,  # no trap configured → treat as passed/neutral
        "prompt_quality": prompt_specificity,
        "code_correction": verification_ratio,
        "git_discipline": 0.5,
        "manual_vs_blind": manual_ratio,
    }

    components: list[CQComponent] = []
    total_score = 0.0
    for key, label, max_pts, note in _CQ_COMPONENTS:
        ratio = signal_by_name.get(key, fallbacks[key])
        ratio = max(0.0, min(1.0, ratio))
        score = round(ratio * max_pts, 1)
        total_score += score
        components.append(CQComponent(
            key=key, label=label, score=score, max=max_pts, note=note,
        ))

    # Anchor the displayed score to the evaluator's overall_score if available;
    # use the component sum otherwise.
    overall = evaluation.overall_score
    cq_score = int(round((overall if 0 <= overall <= 1 else overall / 100) * 100))

    weakest = min(components, key=lambda c: c["score"] / c["max"])
    strongest = max(components, key=lambda c: c["score"] / c["max"])
    if cq_score >= 75:
        threshold = "above"
    elif cq_score >= 50:
        threshold = "near"
    else:
        threshold = "below"
    summary = (
        f"Strong {strongest['label'].lower()}; weakest signal was "
        f"{weakest['label'].lower()}. Overall {threshold} hiring threshold."
    )

    return CQOverview(
        score=cq_score,
        summary=summary,
        breakdown=CQBreakdown(total=round(total_score, 1), components=components),
    )


def _build_metrics(
    evaluation: EvaluationResult | None,
) -> list[MetricScore]:
    if evaluation is None:
        return []
    out: list[MetricScore] = []
    for sig in evaluation.signals:
        out.append(MetricScore(
            key=sig.name,
            label=sig.name.replace("_", " ").title(),
            score=round(sig.score * 100, 1),
            max=100.0,
        ))
    return out


def _build_bug_exposure(
    assessment: Assessment, events: list[ActivityEvent],
) -> BugExposure:
    ticket = assessment.candidate_ticket
    brief = assessment.bug_brief

    opened = {e.file_path for e in events if e.kind.value in {"file_open", "file_switch"} and e.file_path}
    edited = {e.file_path for e in events if e.kind.value == "edit" and e.file_path}
    ran = any(e.kind.value == "run" for e in events)

    rows: list[BugRow] = []

    def _file_matches(location: str, candidates: set[str | None]) -> bool:
        if not location:
            return False
        tail = location.split("/")[-1]
        return any(path and tail in path for path in candidates)

    if brief and brief.defects:
        for i, defect in enumerate(brief.defects):
            location = defect.get("location_hint") or ""
            kind = defect.get("kind") or "bug"
            change = defect.get("behavior_change") or location or "Defect planted by injector"
            status: Literal["missed", "encountered", "noticed", "fixed"] = "missed"
            if _file_matches(location, edited):
                status = "noticed"
            elif _file_matches(location, opened):
                status = "encountered"
            if status == "noticed" and ran:
                status = "fixed"
            rows.append(BugRow(
                id=f"BUG-{i+1:02d}",
                bug_type=str(kind),
                description=str(change)[:140],
                status=status,
            ))
    elif ticket:
        # No structured defects — derive one row per acceptance criterion
        for i, ac in enumerate(ticket.acceptance_criteria):
            status = "missed"
            if edited:
                status = "noticed"
            if edited and ran:
                status = "fixed"
            rows.append(BugRow(
                id=f"AC-{i+1:02d}",
                bug_type=(ticket.labels[0] if ticket.labels else "task"),
                description=ac[:140],
                status=status,
            ))

    fixed = sum(1 for r in rows if r["status"] == "fixed")
    missed = sum(1 for r in rows if r["status"] == "missed")
    return BugExposure(rows=rows, fixed_count=fixed, missed_count=missed, total=len(rows))


def _build_ai_interaction(
    events: list[ActivityEvent], buddy_history: list[BuddyTurn],
) -> AIInteraction:
    # Prompts come from buddy_history (authoritative user/buddy log).
    user_turns = [t for t in buddy_history if t.role == "user"]

    # Iterative tag — second+ prompt seen
    seen_count = 0
    prompts: list[PromptEntry] = []
    for t in user_turns:
        tags = _classify_prompt(t.content, is_followup=seen_count > 0)
        prompts.append(PromptEntry(
            at=t.at.isoformat(),
            content=t.content,
            file_context=t.open_file,
            tags=tags,
        ))
        seen_count += 1

    buddy_hint_events = [e for e in events if e.kind.value == "buddy_hint"]
    buddy_action_events = [e for e in events if e.kind.value == "buddy_edit_action"]
    proposed = len(buddy_hint_events)
    accepted = sum(
        1
        for event in buddy_action_events
        if isinstance(event.payload, dict) and event.payload.get("action") == "applied"
    )
    rejected = sum(
        1
        for event in buddy_action_events
        if isinstance(event.payload, dict) and event.payload.get("action") == "dismissed"
    )
    edits_after_accept = accepted

    blind_paste_rate = 0.0
    if proposed > 0:
        blind_paste_rate = max(0.0, 1.0 - (edits_after_accept / proposed))

    trap = TrapDetail(
        configured=False,
        bad_suggestion="",
        trigger="",
        outcome="not_triggered",
    )

    model_used = "Not recorded"

    return AIInteraction(
        prompts=prompts,
        prompt_count=len(prompts),
        proposed=proposed,
        accepted=accepted,
        rejected=rejected,
        blind_paste_rate=round(blind_paste_rate, 2),
        edits_after_accept=edits_after_accept,
        trap=trap,
        model_used=model_used,
    )


def _extract_line_ranges(payload: dict) -> list[FileLineRange]:
    direct_start = _safe_int(payload.get("line_start"))
    direct_end = _safe_int(payload.get("line_end"))
    if direct_start is not None:
        return [FileLineRange(
            start_line=direct_start,
            end_line=direct_end or direct_start,
            change_type=str(payload.get("change_type") or "observed"),
        )]
    changed_ranges = payload.get("changed_ranges")
    if not isinstance(changed_ranges, list):
        return []
    out: list[FileLineRange] = []
    for item in changed_ranges:
        if not isinstance(item, dict):
            continue
        start_line = _safe_int(item.get("start_line"))
        end_line = _safe_int(item.get("end_line"))
        if start_line is None:
            continue
        out.append(FileLineRange(
            start_line=start_line,
            end_line=end_line or start_line,
            change_type=str(item.get("change_type") or "observed"),
        ))
    return out


def _describe_event(event: ActivityEvent) -> str:
    payload = event.payload if isinstance(event.payload, dict) else {}
    if event.kind.value == "code_sync":
        added = _safe_int(payload.get("added_lines")) or 0
        removed = _safe_int(payload.get("removed_lines")) or 0
        ranges = _extract_line_ranges(payload)
        if ranges:
            segments = ", ".join(f"L{r['start_line']}-{r['end_line']}" for r in ranges[:3])
            return f"Sandbox sync observed {added} added / {removed} removed lines in {segments}."
        return f"Sandbox sync observed {added} added / {removed} removed lines."
    if event.kind.value == "buddy_edit_action":
        return f"Buddy suggestion {payload.get('action') or 'reviewed'}."
    if event.kind.value == "buddy_query":
        return f"Asked Buddy ({payload.get('question_len') or 0} chars)."
    if event.kind.value == "buddy_hint":
        return f"Buddy responded with {payload.get('hint_level') or 'hint'}."
    if event.kind.value == "challenge_response":
        return f"Challenge response {payload.get('status') or 'updated'}."
    if event.kind.value == "terminal_command":
        command = str(payload.get("command") or "").strip()
        return f"Ran terminal command `{command[:60]}`." if command else "Ran terminal command."
    if event.kind.value == "run":
        return "Executed the current file."
    if event.kind.value == "edit":
        delta = _safe_int(payload.get("delta_chars"))
        if delta is not None:
            return f"Typed or deleted approximately {abs(delta)} characters."
    return event.kind.value.replace("_", " ").title()


def _build_activity_forensics(events: list[ActivityEvent]) -> ActivityForensics:
    sorted_events = sorted(events, key=lambda e: e.at)
    file_stats: dict[str, dict[str, object]] = {}
    for idx, event in enumerate(sorted_events):
        if not event.file_path:
            continue
        stat = file_stats.setdefault(
            event.file_path,
            {
                "active_seconds": 0,
                "total_events": 0,
                "edit_events": 0,
                "line_ranges": [],
                "first_at": event.at,
                "last_at": event.at,
            },
        )
        stat["total_events"] = int(stat["total_events"]) + 1
        if event.kind.value in {"edit", "code_sync"}:
            stat["edit_events"] = int(stat["edit_events"]) + 1
        stat["last_at"] = event.at
        ranges = _extract_line_ranges(event.payload if isinstance(event.payload, dict) else {})
        existing = stat["line_ranges"]
        if isinstance(existing, list):
            existing.extend(ranges)
        if idx + 1 < len(sorted_events):
            next_event = sorted_events[idx + 1]
            gap = max(0, min(int(_seconds(event.at, next_event.at)), 90))
            stat["active_seconds"] = int(stat["active_seconds"]) + gap

    file_summaries: list[FileActivitySummary] = []
    for file_path, stat in file_stats.items():
        raw_ranges = stat["line_ranges"] if isinstance(stat["line_ranges"], list) else []
        deduped: list[FileLineRange] = []
        seen: set[tuple[int, int, str]] = set()
        for item in raw_ranges:
            if not isinstance(item, dict):
                continue
            signature = (
                int(item["start_line"]),
                int(item["end_line"]),
                str(item["change_type"]),
            )
            if signature in seen:
                continue
            seen.add(signature)
            deduped.append(FileLineRange(
                start_line=signature[0],
                end_line=signature[1],
                change_type=signature[2],
            ))
        file_summaries.append(FileActivitySummary(
            file_path=file_path,
            active_seconds=int(stat["active_seconds"]),
            total_events=int(stat["total_events"]),
            edit_events=int(stat["edit_events"]),
            line_ranges=deduped[:12],
            first_at=stat["first_at"].isoformat() if isinstance(stat["first_at"], datetime) else None,
            last_at=stat["last_at"].isoformat() if isinstance(stat["last_at"], datetime) else None,
        ))
    file_summaries.sort(key=lambda item: (-item["active_seconds"], -item["total_events"], item["file_path"]))

    recent_entries: list[ActivityTraceEntry] = []
    for event in sorted_events[-80:]:
        ranges = _extract_line_ranges(event.payload if isinstance(event.payload, dict) else {})
        line_start = ranges[0]["start_line"] if ranges else _safe_int((event.payload or {}).get("line_start"))
        line_end = ranges[0]["end_line"] if ranges else _safe_int((event.payload or {}).get("line_end"))
        recent_entries.append(ActivityTraceEntry(
            at=event.at.isoformat(),
            kind=event.kind.value,
            file_path=event.file_path,
            line_start=line_start,
            line_end=line_end,
            summary=_describe_event(event),
        ))

    return ActivityForensics(
        total_events=len(sorted_events),
        tracked_files=len(file_summaries),
        file_summaries=file_summaries,
        recent_entries=recent_entries,
    )


def _build_buddy_audit(
    buddy_history: list[BuddyTurn],
    events: list[ActivityEvent],
) -> BuddyAudit:
    transcript = [
        BuddyTranscriptEntry(
            at=turn.at.isoformat(),
            role=turn.role,
            content=turn.content,
            challenge_id=turn.challenge_id,
            open_file=turn.open_file,
            blocked=turn.blocked,
            hint_level=turn.hint_level,
            edit_targets=[edit.file_path for edit in turn.edits],
        )
        for turn in buddy_history
    ]
    action_events = [event for event in events if event.kind.value == "buddy_edit_action"]
    actions = [
        BuddyEditAction(
            at=event.at.isoformat(),
            action=str((event.payload or {}).get("action") or "reviewed"),
            file_path=event.file_path,
            challenge_id=str((event.payload or {}).get("challenge_id") or "") or None,
            rationale=str((event.payload or {}).get("rationale") or ""),
        )
        for event in action_events
    ]
    return BuddyAudit(
        total_messages=len(buddy_history),
        blocked_messages=sum(1 for turn in buddy_history if turn.blocked),
        proposed_edits=sum(len(turn.edits) for turn in buddy_history if turn.role == "buddy"),
        applied_edits=sum(1 for action in actions if action["action"] == "applied"),
        dismissed_edits=sum(1 for action in actions if action["action"] == "dismissed"),
        transcript=transcript,
        actions=actions,
    )


def _build_feedback_log(feedback: list[CandidateFeedback]) -> list[FeedbackEntry]:
    return [
        FeedbackEntry(
            id=item.id,
            category=item.category.value,
            message=item.message,
            challenge_id=item.challenge_id,
            status=item.status,
            created_at=item.created_at.isoformat(),
        )
        for item in sorted(feedback, key=lambda entry: entry.created_at, reverse=True)
    ]


def _build_behaviour(
    session: CandidateSession,
    events: list[ActivityEvent],
    heatmap: Heatmap,
) -> BehaviourPattern:
    sorted_events = sorted(events, key=lambda e: e.at)
    first_edit = next((e for e in sorted_events if e.kind.value == "edit"), None)
    first_prompt = next((e for e in sorted_events if e.kind.value == "buddy_query"), None)

    started_at = session.started_at
    submitted_at = session.submitted_at or (sorted_events[-1].at if sorted_events else started_at)
    span = max(_seconds(started_at, submitted_at), 1.0)

    def marker(label: str, when: datetime | None) -> TimelineMarker | None:
        if when is None:
            return None
        off = max(0.0, min(_seconds(started_at, when) / span, 1.0)) * 100
        return TimelineMarker(label=label, at=when.isoformat(), offset_pct=round(off, 2))

    markers: list[TimelineMarker] = []
    for m in [
        marker("Started", started_at),
        marker("First edit", first_edit.at if first_edit else None),
        marker("First AI prompt", first_prompt.at if first_prompt else None),
        marker("Submitted", session.submitted_at),
    ]:
        if m:
            markers.append(m)

    # Investigation stats
    files_before_first_edit = 0
    if first_edit:
        seen: set[str] = set()
        for e in sorted_events:
            if e.at >= first_edit.at:
                break
            if e.kind.value in {"file_open", "file_switch"} and e.file_path:
                seen.add(e.file_path)
        files_before_first_edit = len(seen)
    time_to_first_edit_min: int | None = None
    if first_edit:
        time_to_first_edit_min = max(0, int(_seconds(started_at, first_edit.at) / 60))
    total_files = len({
        e.file_path for e in sorted_events
        if e.kind.value in {"file_open", "file_switch", "edit"} and e.file_path
    })

    if time_to_first_edit_min is None:
        investigation_note = "Candidate never edited a file during the session."
    elif time_to_first_edit_min > 5:
        investigation_note = "Explored the codebase before diving in — good investigative pattern."
    elif time_to_first_edit_min < 2:
        investigation_note = "Jumped to editing immediately — limited initial exploration."
    elif files_before_first_edit > 4:
        investigation_note = "Broad initial exploration across multiple files."
    else:
        investigation_note = "Moved into editing after a brief look around."

    # Heatmap mix — derive from totals_by_kind
    totals = heatmap.get("totals_by_kind", {}) if heatmap else {}
    editor_kinds = {"edit", "cursor_move", "selection_change", "file_open", "file_switch"}
    ai_kinds = {"buddy_query", "buddy_hint"}
    term_kinds = {"terminal_command", "terminal_open", "run"}
    editor_total = sum(v for k, v in totals.items() if k in editor_kinds)
    ai_total = sum(v for k, v in totals.items() if k in ai_kinds)
    term_total = sum(v for k, v in totals.items() if k in term_kinds)
    grand = editor_total + ai_total + term_total
    if grand == 0:
        mix = HeatmapMix(editor=0, ai=0, terminal=0)
    else:
        # Normalise to 100 with rounding correction
        editor_pct = round(editor_total / grand * 100)
        ai_pct = round(ai_total / grand * 100)
        term_pct = 100 - editor_pct - ai_pct
        mix = HeatmapMix(editor=editor_pct, ai=ai_pct, terminal=term_pct)

    # Verification indicators
    test_commands = sum(
        1 for e in sorted_events
        if e.kind.value == "terminal_command"
        and any(
            k in (e.payload.get("command", "") if isinstance(e.payload, dict) else "").lower()
            for k in ("test", "jest", "pytest", "vitest")
        )
    )
    runs = sum(1 for e in sorted_events if e.kind.value == "run")
    edits = sum(1 for e in sorted_events if e.kind.value == "edit")
    commits = sum(1 for e in sorted_events if e.kind.value.startswith("git_"))
    verification = Verification(
        ran_tests=test_commands > 0 or runs > 0,
        verified_ai_patches=edits > 0 and any(e.kind.value == "buddy_hint" for e in sorted_events),
        small_commits=commits >= 3,
    )

    return BehaviourPattern(
        timeline=markers,
        files_before_first_edit=files_before_first_edit,
        time_to_first_edit_min=time_to_first_edit_min,
        total_files_opened=total_files,
        investigation_note=investigation_note,
        heatmap_mix=mix,
        verification=verification,
    )


def _build_integrity(events: list[ActivityEvent]) -> IntegritySignals:
    flag_specs = [
        ("editor_blur", "Window lost focus"),
        ("idle", "Idle period"),
        ("paste_large", "Large paste event"),
        ("tab_hidden", "Tab hidden"),
    ]
    flags: list[IntegrityFlag] = []
    score = 100
    for kind_value, label in flag_specs:
        matching = [e for e in events if e.kind.value == kind_value]
        if not matching:
            continue
        total_duration = 0
        details = ""
        for e in matching:
            if isinstance(e.payload, dict):
                d = e.payload.get("duration_seconds") or e.payload.get("duration_ms")
                if isinstance(d, (int, float)):
                    total_duration += int(d if d < 10000 else d / 1000)
        flags.append(IntegrityFlag(
            type=kind_value,
            label=label,
            count=len(matching),
            total_duration_seconds=total_duration or None,
            details=details,
        ))
        # Each flag dings the integrity indicator a little — but stays neutral.
        score -= min(len(matching), 10) * 2

    score = max(0, min(100, score))
    return IntegritySignals(
        score=score,
        flags=flags,
        disclaimer=_INTEGRITY_DISCLAIMER,
    )


def _build_code_review(evaluation: EvaluationResult | None) -> CodeReview | None:
    if evaluation is None:
        return None

    findings: list[CodeReviewFinding] = []
    for gap in evaluation.gaps:
        findings.append(CodeReviewFinding(
            severity="warning",
            file="",
            line=None,
            message=gap,
            is_ai_generated_error=False,
        ))
    for missed in evaluation.missed_acceptance:
        findings.append(CodeReviewFinding(
            severity="critical",
            file="",
            line=None,
            message=f"Missed acceptance: {missed}",
            is_ai_generated_error=False,
        ))

    summary = evaluation.narrative[:240] if evaluation.narrative else ""
    return CodeReview(
        summary=summary,
        findings=findings,
        critical_count=sum(1 for f in findings if f["severity"] == "critical"),
        warning_count=sum(1 for f in findings if f["severity"] == "warning"),
        info_count=sum(1 for f in findings if f["severity"] == "info"),
    )


# ── Public entry point ──────────────────────────────────────────────────────


def build_report(
    session: CandidateSession,
    assessment: Assessment,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
    feedback: list[CandidateFeedback],
    evaluation: EvaluationResult | None,
    heatmap: Heatmap,
) -> ReportData:
    header = _build_header(session, assessment)
    cq = _derive_cq(evaluation, events, buddy_history)
    metrics = _build_metrics(evaluation)
    bug_exposure = _build_bug_exposure(assessment, events)
    ai = _build_ai_interaction(events, buddy_history)
    behaviour = _build_behaviour(session, events, heatmap)
    behaviour_analytics = compute_behaviour_analytics(session, assessment, events)
    integrity = _build_integrity(events)
    strategy: list[StrategyAnswer] = []  # No strategy questions in the data model yet
    code_review = _build_code_review(evaluation)
    activity_forensics = _build_activity_forensics(events)
    buddy_audit = _build_buddy_audit(buddy_history, events)
    feedback_log = _build_feedback_log(feedback)

    return ReportData(
        available=evaluation is not None,
        header=header,
        cq=cq,
        metrics=metrics,
        bug_exposure=bug_exposure,
        ai=ai,
        behaviour=behaviour,
        behaviour_analytics=behaviour_analytics,
        integrity=integrity,
        strategy=strategy,
        code_review=code_review,
        activity_forensics=activity_forensics,
        buddy_audit=buddy_audit,
        feedback_log=feedback_log,
        playback_url=f"/playback/{session.id}",
        heatmap=heatmap,
    )


def build_report_preview(report: ReportData) -> ReportPreviewData:
    highlights: list[str] = []
    if report["cq"]:
        highlights.append(f"CQ score {report['cq']['score']} based on evaluator and behaviour signals.")
    highlights.append(
        f"{report['bug_exposure']['fixed_count']} of {report['bug_exposure']['total']} tracked issue(s) were marked fixed."
    )
    if report["ai"]["prompt_count"]:
        highlights.append(
            f"Candidate used Buddy {report['ai']['prompt_count']} time(s) during the session."
        )
    if report["behaviour"]["verification"]["ran_tests"]:
        highlights.append("Verification signals show the candidate ran tests or code before submitting.")
    else:
        highlights.append("Verification signals were limited, so manual review is still important.")

    return ReportPreviewData(
        available=report["available"],
        header=report["header"],
        cq=report["cq"],
        metrics=report["metrics"][:3],
        snapshot=ReportPreviewSnapshot(
            fixed_bugs=report["bug_exposure"]["fixed_count"],
            total_bugs=report["bug_exposure"]["total"],
            ai_prompt_count=report["ai"]["prompt_count"],
            files_touched=report["behaviour"]["total_files_opened"],
            terminal_commands=report["heatmap"]["totals_by_kind"].get("terminal_command", 0),
            highlights=highlights[:4],
        ),
        lock_reason=(
            "The full employer report stays gated until you explicitly unlock it. "
            "That keeps the premium review flow intentional and leaves room for future metering."
        ),
        unlock_label="Unlock full employer report",
    )
