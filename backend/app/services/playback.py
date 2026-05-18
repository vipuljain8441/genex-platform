"""Builds a first-pass employer playback view from stored session events."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Literal, TypedDict

from app.models.schemas import ActivityEvent, Assessment, BuddyTurn, CandidateSession


class PlaybackLineRange(TypedDict):
    start_line: int
    end_line: int
    change_type: str


class PlaybackFile(TypedDict):
    path: str
    language: str
    content: str
    total_lines: int
    touched_count: int
    last_active_at: str | None


class PlaybackStep(TypedDict):
    index: int
    at: str
    offset_seconds: int
    actor: Literal["candidate", "buddy", "system"]
    kind: str
    title: str
    summary: str
    file_path: str | None
    panel: str | None
    challenge_id: str | None
    command: str | None
    cwd: str | None
    exit_code: int | None
    duration_ms: int | None
    output_truncated: bool | None
    stdout_preview: str | None
    stderr_preview: str | None
    added_lines: int | None
    removed_lines: int | None
    cursor_line: int | None
    cursor_column: int | None
    selection_start_line: int | None
    selection_start_column: int | None
    selection_end_line: int | None
    selection_end_column: int | None
    viewport_start_line: int | None
    viewport_end_line: int | None
    line_ranges: list[PlaybackLineRange]


class PlaybackTranscriptEntry(TypedDict):
    at: str
    role: str
    content: str
    open_file: str | None
    challenge_id: str | None


class PlaybackTicket(TypedDict):
    id: str
    title: str
    description: str
    acceptance_criteria: list[str]
    priority: str
    labels: list[str]
    reporter: str
    assignee: str


class PlaybackStats(TypedDict):
    total_events: int
    files_touched: int
    terminal_commands: int
    buddy_messages: int
    challenge_switches: int
    duration_seconds: int


class PlaybackChallenge(TypedDict):
    id: str
    kind: str
    title: str
    description: str
    instructions: str
    acceptance_criteria: list[str]
    issues: list[dict]
    priority: str
    labels: list[str]
    reporter: str
    assignee: str
    estimated_minutes: int
    related_files: list[str]
    workspace_enabled: bool
    allow_buddy: bool
    objective_questions: list[dict]
    expected_response_format: str
    editor_language: str
    starter_content: str


class PlaybackData(TypedDict):
    session_id: str
    candidate_name: str
    assessment_title: str
    started_at: str
    submitted_at: str | None
    duration_seconds: int
    workspace_note: str
    ticket: PlaybackTicket | None
    challenges: list[PlaybackChallenge]
    challenge_responses: dict[str, dict]
    initial_challenge_id: str | None
    files: list[PlaybackFile]
    steps: list[PlaybackStep]
    buddy_transcript: list[PlaybackTranscriptEntry]
    stats: PlaybackStats


_LANG_MAP = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".sql": "sql",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".sh": "bash",
    ".css": "css",
    ".html": "html",
}


def _detect_language(path: str) -> str:
    return _LANG_MAP.get(Path(path).suffix.lower(), "plaintext")


def _seconds(a: datetime, b: datetime) -> int:
    return max(0, int((b - a).total_seconds()))


def _safe_int(value: object) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _line_ranges(payload: dict) -> list[PlaybackLineRange]:
    direct_start = _safe_int(payload.get("line_start"))
    direct_end = _safe_int(payload.get("line_end"))
    direct_type = str(payload.get("change_type") or "edit")
    if direct_start is not None and direct_end is not None:
        return [PlaybackLineRange(start_line=direct_start, end_line=direct_end, change_type=direct_type)]

    out: list[PlaybackLineRange] = []
    for item in payload.get("changed_ranges") or []:
        if not isinstance(item, dict):
            continue
        start_line = _safe_int(item.get("start_line"))
        end_line = _safe_int(item.get("end_line"))
        if start_line is None or end_line is None:
            continue
        out.append(
            PlaybackLineRange(
                start_line=start_line,
                end_line=end_line,
                change_type=str(item.get("change_type") or "edit"),
            )
        )
    return out[:10]


def _event_actor(event: ActivityEvent) -> Literal["candidate", "buddy", "system"]:
    if event.kind.value.startswith("buddy_"):
        return "buddy"
    if event.kind.value == "submit":
        return "system"
    return "candidate"


def _event_title(event: ActivityEvent) -> str:
    mapping = {
        "file_open": "Opened file",
        "file_switch": "Switched file",
        "editor_focus": "Focused editor",
        "cursor_move": "Moved cursor",
        "selection_change": "Changed selection",
        "viewport_change": "Scrolled editor",
        "panel_focus_change": "Changed panel",
        "terminal_command": "Ran terminal check",
        "buddy_query": "Asked Buddy",
        "buddy_hint": "Buddy replied",
        "challenge_switch": "Switched challenge",
        "challenge_response": "Updated challenge response",
        "edit": "Edited file",
        "code_sync": "Saved VS Code changes",
        "content_delta_snapshot": "Tracked workspace change",
        "keystroke_bucket": "Typing burst",
        "window_blur": "Left workspace",
        "window_focus": "Returned to workspace",
        "submit": "Submitted assessment",
        "run": "Executed workspace code",
    }
    return mapping.get(event.kind.value, event.kind.value.replace("_", " ").title())


def _event_summary(event: ActivityEvent) -> tuple[str, str | None, str | None]:
    payload = event.payload if isinstance(event.payload, dict) else {}
    if event.kind.value == "file_open":
        return ("Opened a file in the editor.", "editor", None)
    if event.kind.value == "file_switch":
        return ("Switched to a different file in the editor.", "editor", None)
    if event.kind.value == "editor_focus":
        line = _safe_int(payload.get("cursor_line"))
        return (
            f"Focused the editor{f' around line {line}' if line is not None else ''}.",
            "editor",
            None,
        )
    if event.kind.value == "cursor_move":
        line = _safe_int(payload.get("cursor_line"))
        column = _safe_int(payload.get("cursor_column"))
        detail = f" to L{line}:C{column}" if line is not None and column is not None else ""
        return (f"Moved the cursor{detail}.", "editor", None)
    if event.kind.value == "selection_change":
        start = _safe_int(payload.get("line_start"))
        end = _safe_int(payload.get("line_end"))
        if start is not None and end is not None:
            return (f"Selected lines {start}-{end}.", "editor", None)
        return ("Changed the text selection.", "editor", None)
    if event.kind.value == "viewport_change":
        start = _safe_int(payload.get("visible_start_line"))
        end = _safe_int(payload.get("visible_end_line"))
        if start is not None and end is not None:
            return (f"Scrolled the editor viewport to lines {start}-{end}.", "editor", None)
        return ("Scrolled the editor viewport.", "editor", None)
    if event.kind.value == "terminal_command":
        command = str(payload.get("command") or "").strip()
        cwd = str(payload.get("cwd") or "").strip()
        tail = f" from {cwd}" if cwd else ""
        return (
            (command and f"{command}{tail}") or "Executed a terminal command.",
            payload.get("panel") if isinstance(payload.get("panel"), str) else "terminal",
            command or None,
        )
    if event.kind.value == "panel_focus_change":
        panel = str(payload.get("panel") or "").strip() or None
        prev = str(payload.get("from_panel") or "").strip()
        summary = f"Moved from {prev or 'none'} to {panel or 'unknown'} panel."
        return summary, panel, None
    if event.kind.value == "buddy_query":
        return ("Candidate asked Buddy for help.", "ai", None)
    if event.kind.value == "buddy_hint":
        level = str(payload.get("hint_level") or "hint")
        return (f"Buddy responded with a {level} level answer.", "ai", None)
    if event.kind.value == "challenge_switch":
        challenge_id = str(payload.get("challenge_id") or "").strip()
        return (f"Focused on challenge {challenge_id or 'unknown'}.", "tickets", None)
    if event.kind.value == "challenge_response":
        status = str(payload.get("status") or "updated")
        return (f"Challenge response marked {status}.", "tickets", None)
    if event.kind.value == "edit":
        delta = _safe_int(payload.get("delta_chars"))
        amount = abs(delta) if delta is not None else None
        return (
            f"Edited the file{f' by about {amount} chars' if amount is not None else ''}.",
            "editor",
            None,
        )
    if event.kind.value == "code_sync":
        added = _safe_int(payload.get("added_lines")) or 0
        removed = _safe_int(payload.get("removed_lines")) or 0
        file_label = f" in {event.file_path}" if event.file_path else ""
        return (f"VS Code changes were saved{file_label} (+{added} / -{removed} lines).", "editor", None)
    if event.kind.value == "content_delta_snapshot":
        added = _safe_int(payload.get("lines_added")) or 0
        removed = _safe_int(payload.get("lines_removed")) or 0
        file_label = f" for {event.file_path}" if event.file_path else ""
        return (f"Workspace diff captured{file_label} (+{added} / -{removed} lines).", "editor", None)
    if event.kind.value == "keystroke_bucket":
        count = _safe_int(payload.get("keystrokes")) or _safe_int(payload.get("count")) or 0
        return (f"Typing burst with {count} keystrokes recorded.", "editor", None)
    if event.kind.value == "window_blur":
        return ("Candidate left the assessment window.", None, None)
    if event.kind.value == "window_focus":
        blur = _safe_int(payload.get("blur_duration_seconds")) or 0
        return (f"Candidate returned after {blur}s away from the workspace.", None, None)
    if event.kind.value == "submit":
        return ("Candidate submitted the assessment.", None, None)
    if event.kind.value == "run":
        command = str(payload.get("command") or "").strip() or None
        return ("Executed the current file from the assessment runtime.", "terminal", command)
    return (event.kind.value.replace("_", " ").title(), None, None)


def build_playback(
    session: CandidateSession,
    assessment: Assessment,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
) -> PlaybackData:
    sorted_events = sorted(events, key=lambda event: event.at)
    touched_counts: dict[str, int] = {}
    last_active: dict[str, str] = {}
    for event in sorted_events:
        if event.file_path:
            touched_counts[event.file_path] = touched_counts.get(event.file_path, 0) + 1
            last_active[event.file_path] = event.at.isoformat()

    files: list[PlaybackFile] = []
    for path in sorted(session.current_files):
        content = session.current_files[path]
        files.append(
            PlaybackFile(
                path=path,
                language=_detect_language(path),
                content=content,
                total_lines=max(1, len(content.splitlines())),
                touched_count=touched_counts.get(path, 0),
                last_active_at=last_active.get(path),
            )
        )

    steps: list[PlaybackStep] = []
    started_at = session.started_at
    for index, event in enumerate(sorted_events):
        payload = event.payload if isinstance(event.payload, dict) else {}
        summary, panel, command = _event_summary(event)
        challenge_id = None
        if event.kind.value in {"challenge_switch", "challenge_response", "buddy_query", "buddy_hint"}:
            challenge_id = str(payload.get("challenge_id") or "").strip() or None
        steps.append(
            PlaybackStep(
                index=index,
                at=event.at.isoformat(),
                offset_seconds=_seconds(started_at, event.at),
                actor=_event_actor(event),
                kind=event.kind.value,
                title=_event_title(event),
                summary=summary,
                file_path=event.file_path,
                panel=panel,
                challenge_id=challenge_id,
                command=command,
                cwd=str(payload.get("cwd") or "").strip() or None,
                exit_code=_safe_int(payload.get("exit_code")),
                duration_ms=_safe_int(payload.get("duration_ms")),
                output_truncated=bool(payload.get("output_truncated")) if payload.get("output_truncated") is not None else None,
                stdout_preview=(
                    str(
                        payload.get("stdout_preview")
                        or payload.get("output_preview")
                        or payload.get("terminal_output")
                        or ""
                    ).strip()
                    or None
                ),
                stderr_preview=str(payload.get("stderr_preview") or "").strip() or None,
                added_lines=_safe_int(payload.get("added_lines") or payload.get("lines_added")),
                removed_lines=_safe_int(payload.get("removed_lines") or payload.get("lines_removed")),
                cursor_line=_safe_int(payload.get("cursor_line")),
                cursor_column=_safe_int(payload.get("cursor_column")),
                selection_start_line=_safe_int(payload.get("line_start")),
                selection_start_column=_safe_int(payload.get("column_start")),
                selection_end_line=_safe_int(payload.get("line_end")),
                selection_end_column=_safe_int(payload.get("column_end")),
                viewport_start_line=_safe_int(payload.get("visible_start_line")),
                viewport_end_line=_safe_int(payload.get("visible_end_line")),
                line_ranges=_line_ranges(payload),
            )
        )

    ticket = assessment.candidate_ticket
    ticket_payload = (
        PlaybackTicket(
            id=ticket.id,
            title=ticket.title,
            description=ticket.description,
            acceptance_criteria=ticket.acceptance_criteria,
            priority=ticket.priority,
            labels=ticket.labels,
            reporter=ticket.reporter,
            assignee=ticket.assignee,
        )
        if ticket
        else None
    )

    buddy_transcript = [
        PlaybackTranscriptEntry(
            at=turn.at.isoformat(),
            role=turn.role,
            content=turn.content,
            open_file=turn.open_file,
            challenge_id=turn.challenge_id,
        )
        for turn in buddy_history
    ]
    duration_seconds = _seconds(session.started_at, session.submitted_at or (sorted_events[-1].at if sorted_events else session.started_at))
    return PlaybackData(
        session_id=session.id,
        candidate_name=session.candidate_name or "Candidate",
        assessment_title=assessment.job.title,
        started_at=session.started_at.isoformat(),
        submitted_at=session.submitted_at.isoformat() if session.submitted_at else None,
        duration_seconds=duration_seconds,
        workspace_note=(
            "This replay is reconstructed from stored activity events and the final workspace snapshot. "
            "It shows the candidate's flow, not a pixel-perfect recording."
        ),
        ticket=ticket_payload,
        challenges=[
            PlaybackChallenge(
                id=challenge.id,
                kind=challenge.kind.value if hasattr(challenge.kind, "value") else str(challenge.kind),
                title=challenge.title,
                description=challenge.description,
                instructions=challenge.instructions,
                acceptance_criteria=list(challenge.acceptance_criteria),
                issues=[issue.model_dump(mode="json") for issue in challenge.issues],
                priority=challenge.priority,
                labels=list(challenge.labels),
                reporter=challenge.reporter,
                assignee=challenge.assignee,
                estimated_minutes=challenge.estimated_minutes,
                related_files=list(challenge.related_files),
                workspace_enabled=challenge.workspace_enabled,
                allow_buddy=challenge.allow_buddy,
                objective_questions=[question.model_dump(mode="json") for question in challenge.objective_questions],
                expected_response_format=challenge.expected_response_format,
                editor_language=challenge.editor_language,
                starter_content=challenge.starter_content,
            )
            for challenge in assessment.candidate_challenges
        ],
        challenge_responses={
            challenge_id: response.model_dump(mode="json")
            for challenge_id, response in session.challenge_responses.items()
        },
        initial_challenge_id=assessment.candidate_challenges[0].id if assessment.candidate_challenges else None,
        files=files,
        steps=steps,
        buddy_transcript=buddy_transcript,
        stats=PlaybackStats(
            total_events=len(sorted_events),
            files_touched=len({event.file_path for event in sorted_events if event.file_path}),
            terminal_commands=sum(1 for event in sorted_events if event.kind.value == "terminal_command"),
            buddy_messages=len(buddy_history),
            challenge_switches=sum(1 for event in sorted_events if event.kind.value == "challenge_switch"),
            duration_seconds=duration_seconds,
        ),
    )
