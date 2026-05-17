"""Behavioural analytics — Section 7 sub-sections (7a–7f) of the report.

Pure aggregation over the session's ActivityEvent stream. Consumed by
services/report.py and rendered by the frontend components/report/* widgets.

The aggregator is defensive: every helper returns a well-formed empty/zero
structure when the corresponding events are absent, so the report renders
even for legacy sessions that pre-date the behavioural event types.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Literal, TypedDict

from app.models.schemas import ActivityEvent, Assessment, CandidateSession


# ── Output shapes ────────────────────────────────────────────────────────────


class TicketTimeSummary(TypedDict):
    ticket_id: str
    ticket_title: str
    story_points: int
    total_seconds: int
    active_seconds: int
    idle_seconds: int
    ai_seconds: int
    focus_periods: int
    stuck_flag: bool  # idle / total > 0.5


class IdleEpisode(TypedDict):
    at: str
    duration_seconds: int
    tier: Literal["think_pause", "extended_idle", "inactive"]
    preceding_activity: str
    following_activity: str
    note: str  # recruiter-facing interpretation


class IdleSummary(TypedDict):
    total_idle_seconds: int
    idle_percentage: int  # 0..100
    think_pause_count: int
    extended_idle_count: int
    inactive_count: int
    longest_episode: IdleEpisode | None
    idle_after_ai_suggestion: int
    episodes: list[IdleEpisode]  # extended_idle + inactive only (think pauses summarised)


class KeystrokePatternSummary(TypedDict):
    total_keystrokes: int
    average_wpm: int
    peak_wpm: int
    undo_count: int
    paste_vs_type_ratio: float
    delete_ratio: float
    dominant_pattern: Literal["fluent", "think-then-type", "paste-dominant", "uncertain", "insufficient_data"]
    wpm_sparkline: list[int]  # WPM per 10s bucket, in order


class FileAttribution(TypedDict):
    file_path: str
    total_lines: int
    manual_pct: int
    ai_patch_pct: int
    pasted_pct: int
    unchanged_pct: int


class ContentAttributionSummary(TypedDict):
    files: list[FileAttribution]
    overall_manual_pct: int
    overall_ai_patch_pct: int
    overall_pasted_pct: int
    overall_unchanged_pct: int


class FocusPatternSummary(TypedDict):
    panel_time: dict[str, int]  # panel name → seconds
    ticket_rereads: int
    longest_editor_stretch_seconds: int
    window_blur_count: int
    window_blur_total_seconds: int
    most_edited_file: str
    file_visit_order: list[str]
    transitions: list[dict]  # [{from, to, count}]


class SessionPhase(TypedDict):
    phase: Literal["exploration", "planning", "execution", "verification"]
    start_at: str
    end_at: str
    duration_seconds: int
    confidence: float
    signals: list[str]


class PhaseSummary(TypedDict):
    phases: list[SessionPhase]
    time_in_exploration: int
    time_in_planning: int
    time_in_execution: int
    time_in_verification: int
    phase_sequence: str  # e.g. "E → P → Ex → V"
    has_verification_phase: bool
    exploration_before_execution: bool


class BehaviourAnalytics(TypedDict):
    per_ticket: list[TicketTimeSummary]
    idle: IdleSummary
    keystrokes: KeystrokePatternSummary
    content_attribution: ContentAttributionSummary
    focus: FocusPatternSummary
    phases: PhaseSummary


# ── Helpers ──────────────────────────────────────────────────────────────────


def _seconds(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds()


def _payload(event: ActivityEvent, key: str, default=None):
    if not isinstance(event.payload, dict):
        return default
    return event.payload.get(key, default)


def _format_at(when: datetime) -> str:
    return when.isoformat()


# ── 7a. Per-ticket time ──────────────────────────────────────────────────────


def _build_per_ticket(
    events: list[ActivityEvent], assessment: Assessment
) -> list[TicketTimeSummary]:
    # Pull ticket metadata. The current data model has a single `candidate_ticket`
    # plus a list of challenges — flatten both into a uniform map.
    meta: dict[str, dict] = {}
    if assessment.candidate_ticket:
        t = assessment.candidate_ticket
        meta[t.id] = {"title": t.title, "story_points": 0}
    for ch in assessment.candidate_challenges:
        meta[ch.id] = {"title": ch.title, "story_points": ch.estimated_minutes // 5}

    # Accumulate from ticket_focus_end events (authoritative client emission).
    acc: dict[str, dict] = defaultdict(
        lambda: {"total": 0, "active": 0, "idle": 0, "ai": 0, "periods": 0}
    )
    for e in events:
        if e.kind.value != "ticket_focus_end":
            continue
        tid = _payload(e, "ticket_id") or _payload(e, "ticketId")
        if not tid:
            continue
        acc[tid]["total"] += int(_payload(e, "duration_seconds", 0) or 0)
        acc[tid]["active"] += int(_payload(e, "active_seconds", 0) or 0)
        acc[tid]["idle"] += int(_payload(e, "idle_seconds", 0) or 0)
        acc[tid]["ai"] += int(_payload(e, "ai_seconds", 0) or 0)
        acc[tid]["periods"] += 1

    out: list[TicketTimeSummary] = []
    for tid, data in acc.items():
        info = meta.get(tid, {"title": tid, "story_points": 0})
        total = data["total"]
        idle = data["idle"]
        out.append(TicketTimeSummary(
            ticket_id=tid,
            ticket_title=info["title"],
            story_points=info["story_points"],
            total_seconds=total,
            active_seconds=data["active"],
            idle_seconds=idle,
            ai_seconds=data["ai"],
            focus_periods=data["periods"],
            stuck_flag=(total > 0 and (idle / total) > 0.5),
        ))
    out.sort(key=lambda r: r["total_seconds"], reverse=True)
    return out


# ── 7b. Idle analysis ────────────────────────────────────────────────────────


def _interpret_idle(preceding: str, following: str, tier: str) -> str:
    if preceding == "ai":
        return "Followed AI patch proposal — likely reviewing suggestion."
    if preceding == "terminal" and following == "editor":
        return "Followed terminal output — likely reading results."
    if preceding == "ticket":
        return "Followed ticket read — likely planning the next change."
    if tier == "inactive":
        return "No activity for >5 minutes — flag for recruiter attention."
    if tier == "extended_idle":
        return "Extended idle — possibly stuck or deep in thought."
    return "Brief think pause."


def _build_idle(events: list[ActivityEvent], total_session_seconds: float) -> IdleSummary:
    # Pair idle_start with the following idle_end. The client emits both with the
    # same payload shape, so we walk the stream and join opportunistically.
    starts: list[ActivityEvent] = []
    ends: list[ActivityEvent] = []
    for e in events:
        if e.kind.value == "idle_start":
            starts.append(e)
        elif e.kind.value == "idle_end":
            ends.append(e)

    episodes: list[IdleEpisode] = []
    total_idle = 0
    think_count = ext_count = inactive_count = idle_after_ai = 0
    longest: IdleEpisode | None = None

    # Walk paired by index; if mismatched (client crash, etc.) fall back to
    # whichever stream is shorter.
    for i in range(min(len(starts), len(ends))):
        s = starts[i]
        en = ends[i]
        duration = int(_payload(en, "duration_seconds", 0) or 0)
        tier = _payload(en, "tier") or "think_pause"
        if tier not in {"think_pause", "extended_idle", "inactive"}:
            tier = "think_pause"
        preceding = _payload(s, "preceding_activity") or _payload(s, "precedingActivity") or "none"
        following = _payload(en, "following_activity") or _payload(en, "followingActivity") or "none"
        total_idle += duration
        if tier == "think_pause":
            think_count += 1
        elif tier == "extended_idle":
            ext_count += 1
        else:
            inactive_count += 1
        if preceding == "ai":
            idle_after_ai += 1

        ep = IdleEpisode(
            at=_format_at(s.at),
            duration_seconds=duration,
            tier=tier,  # type: ignore[arg-type]
            preceding_activity=preceding,
            following_activity=following,
            note=_interpret_idle(preceding, following, tier),
        )
        if tier in {"extended_idle", "inactive"}:
            episodes.append(ep)
        if longest is None or duration > longest["duration_seconds"]:
            longest = ep

    pct = 0
    if total_session_seconds > 0:
        pct = min(100, int((total_idle / total_session_seconds) * 100))

    return IdleSummary(
        total_idle_seconds=total_idle,
        idle_percentage=pct,
        think_pause_count=think_count,
        extended_idle_count=ext_count,
        inactive_count=inactive_count,
        longest_episode=longest,
        idle_after_ai_suggestion=idle_after_ai,
        episodes=episodes,
    )


# ── 7c. Keystroke pattern ────────────────────────────────────────────────────


def _build_keystrokes(events: list[ActivityEvent]) -> KeystrokePatternSummary:
    buckets = [e for e in events if e.kind.value == "keystroke_bucket"]
    if not buckets:
        return KeystrokePatternSummary(
            total_keystrokes=0, average_wpm=0, peak_wpm=0,
            undo_count=0, paste_vs_type_ratio=0.0, delete_ratio=0.0,
            dominant_pattern="insufficient_data",
            wpm_sparkline=[],
        )

    total = sum(int(_payload(e, "count", 0) or 0) for e in buckets)
    wpms = [int(_payload(e, "wpm", 0) or 0) for e in buckets]
    avg_wpm = int(sum(wpms) / max(len(wpms), 1))
    peak_wpm = max(wpms) if wpms else 0
    burst_scores: list[float] = []
    undo = save_unused = copy_count = paste_count = delete_count = 0
    for e in buckets:
        bs = _payload(e, "burst_score") or _payload(e, "burstScore")
        if isinstance(bs, (int, float)):
            burst_scores.append(float(bs))
        sk = _payload(e, "special_keys") or _payload(e, "specialKeys") or {}
        if isinstance(sk, dict):
            undo += int(sk.get("undo", 0) or 0)
            save_unused += int(sk.get("save", 0) or 0)
            copy_count += int(sk.get("copy", 0) or sk.get("copyCount", 0) or 0)
            paste_count += int(sk.get("paste", 0) or sk.get("pasteCount", 0) or 0)
            delete_count += int(sk.get("delete", 0) or sk.get("deleteCount", 0) or 0)

    paste_ratio = (paste_count / total) if total else 0.0
    delete_ratio = (delete_count / total) if total else 0.0
    avg_burst = sum(burst_scores) / max(len(burst_scores), 1) if burst_scores else 0.0

    if paste_ratio > 0.3:
        pattern: Literal[
            "fluent", "think-then-type", "paste-dominant", "uncertain", "insufficient_data"
        ] = "paste-dominant"
    elif delete_ratio > 0.25:
        pattern = "uncertain"
    elif avg_burst > 0.7:
        pattern = "think-then-type"
    else:
        pattern = "fluent"

    return KeystrokePatternSummary(
        total_keystrokes=total,
        average_wpm=avg_wpm,
        peak_wpm=peak_wpm,
        undo_count=undo,
        paste_vs_type_ratio=round(paste_ratio, 3),
        delete_ratio=round(delete_ratio, 3),
        dominant_pattern=pattern,
        wpm_sparkline=wpms,
    )


# ── 7d. Content attribution ──────────────────────────────────────────────────


def _build_attribution(events: list[ActivityEvent]) -> ContentAttributionSummary:
    # Authoritative source is content_delta_snapshot events emitted at every
    # commit. We take the LATEST snapshot per file as the final attribution.
    latest: dict[str, dict] = {}
    for e in events:
        if e.kind.value != "content_delta_snapshot":
            continue
        path = e.file_path or _payload(e, "file")
        if not path:
            continue
        breakdown = _payload(e, "origin_breakdown") or _payload(e, "originBreakdown") or {}
        if not isinstance(breakdown, dict):
            continue
        latest[path] = {
            "manual": int(breakdown.get("manual_lines", breakdown.get("manualLines", 0)) or 0),
            "ai": int(breakdown.get("ai_patch_lines", breakdown.get("aiPatchLines", 0)) or 0),
            "pasted": int(breakdown.get("pasted_lines", breakdown.get("pastedLines", 0)) or 0),
            "unchanged": int(breakdown.get("unchanged_lines", breakdown.get("unchangedLines", 0)) or 0),
        }

    files: list[FileAttribution] = []
    tot_m = tot_a = tot_p = tot_u = 0
    for path, d in latest.items():
        total = d["manual"] + d["ai"] + d["pasted"] + d["unchanged"]
        if total == 0:
            continue
        tot_m += d["manual"]
        tot_a += d["ai"]
        tot_p += d["pasted"]
        tot_u += d["unchanged"]
        files.append(FileAttribution(
            file_path=path,
            total_lines=total,
            manual_pct=round(d["manual"] / total * 100),
            ai_patch_pct=round(d["ai"] / total * 100),
            pasted_pct=round(d["pasted"] / total * 100),
            unchanged_pct=round(d["unchanged"] / total * 100),
        ))
    files.sort(key=lambda f: f["total_lines"], reverse=True)

    grand = tot_m + tot_a + tot_p + tot_u
    if grand == 0:
        return ContentAttributionSummary(
            files=[], overall_manual_pct=0, overall_ai_patch_pct=0,
            overall_pasted_pct=0, overall_unchanged_pct=0,
        )
    m = round(tot_m / grand * 100)
    a = round(tot_a / grand * 100)
    p = round(tot_p / grand * 100)
    u = 100 - m - a - p
    return ContentAttributionSummary(
        files=files,
        overall_manual_pct=m,
        overall_ai_patch_pct=a,
        overall_pasted_pct=p,
        overall_unchanged_pct=u,
    )


# ── 7f. Panel flow & focus ───────────────────────────────────────────────────


_PANEL_KINDS_TO_NAME = {
    "panel_focus_change": None,  # use payload.panel
    "editor_focus": "editor",
    "buddy_query": "ai",
    "buddy_hint": "ai",
    "terminal_open": "terminal",
    "terminal_command": "terminal",
}


def _build_focus(
    events: list[ActivityEvent], session: CandidateSession
) -> FocusPatternSummary:
    # Walk panel_focus_change events and accumulate dwell per panel.
    sorted_ev = sorted(events, key=lambda e: e.at)
    panel_time: dict[str, int] = defaultdict(int)
    transitions: dict[tuple[str, str], int] = defaultdict(int)
    current_panel: str | None = None
    panel_start: datetime | None = None
    longest_editor = 0
    editor_stretch_start: datetime | None = None
    file_visit_order: list[str] = []
    edits_by_file: dict[str, int] = defaultdict(int)
    ticket_rereads = 0
    started_coding = False
    window_blur_count = 0
    window_blur_total = 0
    pending_blur_at: datetime | None = None

    for e in sorted_ev:
        kind = e.kind.value
        if kind == "edit" and e.file_path:
            edits_by_file[e.file_path] += 1
            started_coding = True
        if kind in {"file_open", "file_switch"} and e.file_path:
            if e.file_path not in file_visit_order:
                file_visit_order.append(e.file_path)

        if kind == "panel_focus_change":
            new_panel = _payload(e, "panel") or "unknown"
            if current_panel and panel_start:
                dwell = int(_seconds(panel_start, e.at))
                panel_time[current_panel] += max(0, dwell)
                if current_panel == "editor":
                    longest_editor = max(longest_editor, dwell)
            if current_panel and new_panel and current_panel != new_panel:
                transitions[(current_panel, new_panel)] += 1
            if new_panel == "tickets" and started_coding:
                ticket_rereads += 1
            current_panel = new_panel
            panel_start = e.at
            if new_panel == "editor":
                editor_stretch_start = e.at
            else:
                editor_stretch_start = None
        elif kind == "window_blur":
            window_blur_count += 1
            pending_blur_at = e.at
        elif kind == "window_focus":
            if pending_blur_at is not None:
                window_blur_total += int(_seconds(pending_blur_at, e.at))
                pending_blur_at = None
            else:
                d = _payload(e, "blur_duration_seconds") or _payload(e, "blurDurationSeconds")
                if isinstance(d, (int, float)):
                    window_blur_total += int(d)

    # Close out the final panel period at submit/now.
    closing_at = session.submitted_at
    if current_panel and panel_start and closing_at:
        dwell = int(_seconds(panel_start, closing_at))
        panel_time[current_panel] += max(0, dwell)
        if current_panel == "editor":
            longest_editor = max(longest_editor, dwell)

    most_edited = ""
    if edits_by_file:
        most_edited = max(edits_by_file.items(), key=lambda kv: kv[1])[0]

    transition_list = [
        {"from": fr, "to": to, "count": c}
        for (fr, to), c in sorted(transitions.items(), key=lambda kv: kv[1], reverse=True)
    ]

    return FocusPatternSummary(
        panel_time=dict(panel_time),
        ticket_rereads=ticket_rereads,
        longest_editor_stretch_seconds=longest_editor,
        window_blur_count=window_blur_count,
        window_blur_total_seconds=window_blur_total,
        most_edited_file=most_edited,
        file_visit_order=file_visit_order[:20],
        transitions=transition_list[:10],
    )


# ── 7e. Phase classifier ─────────────────────────────────────────────────────


_PLANNING_KEYWORDS = ("design", "architect", "approach", "strategy", "should i", "trade-off", "tradeoff", "plan")
_VERIFY_KEYWORDS = ("test", "edge case", "correct", "verify", "check", "review")


def _score_window(window: list[ActivityEvent]) -> dict[str, float]:
    edits = tabs_opened = keystrokes = idle_pauses = ai_arch = ai_verify = ai_any = 0
    terminal = commits = file_reads = 0
    for e in window:
        k = e.kind.value
        if k in {"file_open", "file_switch"}:
            tabs_opened += 1
            file_reads += 1
        elif k == "edit":
            edits += 1
        elif k == "keystroke_bucket":
            keystrokes += int(_payload(e, "count", 0) or 0)
        elif k == "idle_end":
            tier = _payload(e, "tier")
            if tier == "think_pause":
                idle_pauses += 1
        elif k == "buddy_query":
            ai_any += 1
            content = (_payload(e, "question") or "").lower()
            if any(kw in content for kw in _PLANNING_KEYWORDS):
                ai_arch += 1
            if any(kw in content for kw in _VERIFY_KEYWORDS):
                ai_verify += 1
        elif k in {"terminal_command", "run"}:
            terminal += 1
        elif k.startswith("git_"):
            commits += 1

    return {
        "exploration": tabs_opened * 3 + file_reads * 1 - edits * 1 - keystrokes * 0.1,
        "planning": idle_pauses * 2 + ai_arch * 3 - keystrokes * 0.2,
        "execution": keystrokes * 0.05 + edits * 2 - idle_pauses * 1,
        "verification": terminal * 3 + commits * 2 + ai_verify * 2,
    }


def _classify_phases(
    events: list[ActivityEvent], session: CandidateSession
) -> PhaseSummary:
    sorted_ev = sorted(events, key=lambda e: e.at)
    start = session.started_at
    end = session.submitted_at or (sorted_ev[-1].at if sorted_ev else start)
    if _seconds(start, end) < 60:
        return PhaseSummary(
            phases=[], time_in_exploration=0, time_in_planning=0,
            time_in_execution=0, time_in_verification=0,
            phase_sequence="", has_verification_phase=False,
            exploration_before_execution=False,
        )

    WINDOW = timedelta(minutes=2)
    raw_segments: list[tuple[datetime, datetime, str, dict[str, float]]] = []
    cursor = start
    while cursor < end:
        window_end = min(cursor + WINDOW, end)
        window = [e for e in sorted_ev if cursor <= e.at < window_end]
        scores = _score_window(window)
        dominant = max(scores.items(), key=lambda kv: kv[1])
        # If everything is at or below zero, fall back to exploration as the
        # default (reading without much else).
        phase_label = dominant[0] if dominant[1] > 0 else "exploration"
        raw_segments.append((cursor, window_end, phase_label, scores))
        cursor = window_end

    # Merge adjacent segments with the same label.
    merged: list[SessionPhase] = []
    for seg_start, seg_end, label, scores in raw_segments:
        duration = int(_seconds(seg_start, seg_end))
        positive = sum(max(v, 0) for v in scores.values()) or 1
        confidence = round(max(scores[label], 0) / positive, 2)
        signals: list[str] = []
        if scores["exploration"] > 0 and label == "exploration":
            signals.append("file reads outpaced edits")
        if scores["planning"] > 0 and label == "planning":
            signals.append("think pauses + AI architecture prompts")
        if scores["execution"] > 0 and label == "execution":
            signals.append("keystrokes + edits dominated")
        if scores["verification"] > 0 and label == "verification":
            signals.append("terminal/commit activity")
        if merged and merged[-1]["phase"] == label:
            merged[-1]["end_at"] = _format_at(seg_end)
            merged[-1]["duration_seconds"] += duration
            for sig in signals:
                if sig not in merged[-1]["signals"]:
                    merged[-1]["signals"].append(sig)
            continue
        merged.append(SessionPhase(
            phase=label,  # type: ignore[arg-type]
            start_at=_format_at(seg_start),
            end_at=_format_at(seg_end),
            duration_seconds=duration,
            confidence=confidence,
            signals=signals,
        ))

    totals = {"exploration": 0, "planning": 0, "execution": 0, "verification": 0}
    for p in merged:
        totals[p["phase"]] += p["duration_seconds"]

    sequence_short = {"exploration": "E", "planning": "P", "execution": "Ex", "verification": "V"}
    seq = " → ".join(sequence_short[p["phase"]] for p in merged)

    has_verify = totals["verification"] > 0
    expl_before_exec = False
    seen_expl = False
    for p in merged:
        if p["phase"] == "exploration":
            seen_expl = True
        elif p["phase"] == "execution":
            expl_before_exec = seen_expl
            break

    return PhaseSummary(
        phases=merged,
        time_in_exploration=totals["exploration"],
        time_in_planning=totals["planning"],
        time_in_execution=totals["execution"],
        time_in_verification=totals["verification"],
        phase_sequence=seq,
        has_verification_phase=has_verify,
        exploration_before_execution=expl_before_exec,
    )


# ── Public entry point ──────────────────────────────────────────────────────


def compute_behaviour_analytics(
    session: CandidateSession,
    assessment: Assessment,
    events: list[ActivityEvent],
) -> BehaviourAnalytics:
    sorted_ev = sorted(events, key=lambda e: e.at)
    started = session.started_at
    ended = session.submitted_at or (sorted_ev[-1].at if sorted_ev else started)
    total_session = max(_seconds(started, ended), 1.0)

    return BehaviourAnalytics(
        per_ticket=_build_per_ticket(events, assessment),
        idle=_build_idle(events, total_session),
        keystrokes=_build_keystrokes(events),
        content_attribution=_build_attribution(events),
        focus=_build_focus(events, session),
        phases=_classify_phases(events, session),
    )
