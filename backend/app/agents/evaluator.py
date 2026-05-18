"""Evaluator — grades the candidate submission + behavioural signals."""
from __future__ import annotations

import json
import logging
from collections import Counter

from pydantic import ValidationError

from app.core.llm import complete_json
from app.models.schemas import (
    ActivityEvent,
    BuddyTurn,
    CandidateChallenge,
    CandidateSession,
    CandidateTicket,
    Codebase,
    EvaluationResult,
    JobSpec,
    SignalScore,
)
from app.prompts.library import EVALUATOR

log = logging.getLogger(__name__)

# Keep token budget manageable across model tiers
_MAX_FILE_CHARS = 1200
_MAX_FILES = 6
_MAX_BUDDY_TURNS = 10
_MAX_BUDDY_CONTENT_CHARS = 300
_MAX_RELATED_FILES = 3


def _trim_files(files: list[dict]) -> list[dict]:
    out = []
    for f in files[:_MAX_FILES]:
        content = f.get("content", "")
        if len(content) > _MAX_FILE_CHARS:
            content = content[:_MAX_FILE_CHARS] + "\n# ...(truncated for evaluation)"
        out.append({**f, "content": content})
    return out


def _compact_buddy_turns(buddy_history: list[BuddyTurn]) -> list[dict]:
    out: list[dict] = []
    for turn in buddy_history[-_MAX_BUDDY_TURNS:]:
        payload = turn.model_dump(mode="json")
        content = str(payload.get("content") or "")
        if len(content) > _MAX_BUDDY_CONTENT_CHARS:
            payload["content"] = content[:_MAX_BUDDY_CONTENT_CHARS] + "…"
        payload.pop("edits", None)
        metadata = payload.get("metadata")
        if isinstance(metadata, dict) and len(json.dumps(metadata, default=str)) > 400:
            payload["metadata"] = {"truncated": True}
        out.append(payload)
    return out


def _select_evaluation_file_paths(
    golden: Codebase,
    session: CandidateSession,
    ticket: CandidateTicket,
    challenges: list[CandidateChallenge],
    events: list[ActivityEvent],
) -> list[str]:
    golden_by_path = {file.path: file for file in golden.files}
    ranked: list[str] = []
    seen: set[str] = set()

    def add(path: str | None) -> None:
        if not path or path in seen:
            return
        seen.add(path)
        ranked.append(path)

    changed_paths = [
        path
        for path, content in session.current_files.items()
        if path not in golden_by_path or golden_by_path[path].content != content
    ]
    for path in changed_paths:
        add(path)

    file_event_counts = Counter(event.file_path for event in events if event.file_path)
    for path, _count in file_event_counts.most_common():
        add(path)

    related_paths: list[str] = []
    for challenge in challenges[:]:
        related_paths.extend(challenge.related_files[:_MAX_RELATED_FILES])
    for path in related_paths:
        add(path)

    add(golden.entry_point)
    if golden.files:
        add(golden.files[0].path)

    return ranked[:_MAX_FILES]


def _build_submission_payload(
    golden: Codebase,
    session: CandidateSession,
    ticket: CandidateTicket,
    challenges: list[CandidateChallenge],
    events: list[ActivityEvent],
) -> tuple[list[dict], list[dict]]:
    selected_paths = _select_evaluation_file_paths(golden, session, ticket, challenges, events)
    golden_by_path = {file.path: file for file in golden.files}

    candidate_files = [
        {
            "path": path,
            "content": session.current_files.get(path, "")[:_MAX_FILE_CHARS],
        }
        for path in selected_paths
        if path in session.current_files
    ]
    golden_files = [
        golden_by_path[path].model_dump(mode="json")
        for path in selected_paths
        if path in golden_by_path
    ]
    return _trim_files(golden_files), _trim_files(candidate_files)


def _summarise_events(events: list[ActivityEvent]) -> dict:
    by_kind: dict[str, int] = {}
    files_touched: set[str] = set()
    for e in events:
        by_kind[e.kind.value] = by_kind.get(e.kind.value, 0) + 1
        if e.file_path:
            files_touched.add(e.file_path)
    total = len(events)
    buddy_queries = by_kind.get("buddy_query", 0)
    edits = by_kind.get("edit", 0)
    runs = by_kind.get("run", 0)
    return {
        "total_events": total,
        "by_kind": by_kind,
        "files_touched": sorted(files_touched),
        "buddy_reliance_ratio": round(buddy_queries / max(total, 1), 3),
        "edit_to_run_ratio": round(edits / max(runs, 1), 2),
    }


_SIGNAL_NAMES = (
    "correctness",
    "code_quality",
    "exploration",
    "buddy_independence",
    "perseverance",
)
_REQUIRED_EVALUATION_KEYS = {
    "overall_score",
    "signals",
    "narrative",
    "strengths",
    "gaps",
    "completed_acceptance",
    "missed_acceptance",
}


def _coerce_float(value: object, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _default_signal_scores(
    session: CandidateSession,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
) -> list[SignalScore]:
    touched_files = len(session.current_files)
    total_events = len(events)
    buddy_queries = sum(1 for event in events if event.kind.value == "buddy_query")
    completed = sum(1 for response in session.challenge_responses.values() if response.status == "completed")
    total_challenges = max(len(session.challenge_responses), 1)
    completion_ratio = completed / total_challenges
    exploration_score = 0.2 if total_events == 0 else min(1.0, 0.25 + min(touched_files, 8) * 0.08)
    buddy_independence = max(0.15, 1.0 - min(len(buddy_history) + buddy_queries, 8) * 0.08)
    perseverance = min(1.0, 0.25 + min(total_events, 20) * 0.03)
    correctness = min(1.0, 0.2 + completion_ratio * 0.65)
    code_quality = min(1.0, 0.25 + min(touched_files, 6) * 0.07)
    defaults = {
        "correctness": correctness,
        "code_quality": code_quality,
        "exploration": exploration_score,
        "buddy_independence": buddy_independence,
        "perseverance": perseverance,
    }
    return [
        SignalScore(name=name, score=round(defaults[name], 3), notes="Fallback score generated from local session signals.")
        for name in _SIGNAL_NAMES
    ]


def _normalize_signals(
    raw_signals: object,
    session: CandidateSession,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
) -> list[SignalScore]:
    fallback_by_name = {
        signal.name: signal for signal in _default_signal_scores(session, events, buddy_history)
    }
    parsed: dict[str, SignalScore] = {}
    if isinstance(raw_signals, list):
        for item in raw_signals:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip().lower()
            if not name:
                continue
            try:
                parsed[name] = SignalScore(
                    name=name,
                    score=max(0.0, min(1.0, _coerce_float(item.get("score"), fallback_by_name.get(name, fallback_by_name["correctness"]).score))),
                    notes=str(item.get("notes") or "").strip(),
                )
            except ValidationError:
                continue
    normalized: list[SignalScore] = []
    for name in _SIGNAL_NAMES:
        normalized.append(parsed.get(name) or fallback_by_name[name])
    return normalized


def _fallback_narrative(signals: list[SignalScore], completed_count: int, total_challenges: int) -> str:
    strong = max(signals, key=lambda signal: signal.score)
    weak = min(signals, key=lambda signal: signal.score)
    return (
        f"The candidate completed {completed_count} of {total_challenges} tracked challenges before submission. "
        f"The strongest observed signal was {strong.name.replace('_', ' ')} ({strong.score:.2f}), while "
        f"{weak.name.replace('_', ' ')} needs the most follow-up ({weak.score:.2f}). "
        "This result was partially reconstructed from local activity data because the model returned an incomplete evaluation payload."
    )


def _normalize_text_list(value: object, fallback: list[str]) -> list[str]:
    if not isinstance(value, list):
        return fallback[:]
    normalized = [str(item).strip() for item in value if str(item).strip()]
    return normalized or fallback[:]


def _normalize_evaluation_payload(
    data: object,
    ticket: CandidateTicket,
    session: CandidateSession,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
) -> dict[str, object]:
    payload = data if isinstance(data, dict) else {}
    signals = _normalize_signals(payload.get("signals"), session, events, buddy_history)
    fallback_overall = round(sum(signal.score for signal in signals) / max(len(signals), 1), 3)
    completed_count = sum(1 for response in session.challenge_responses.values() if response.status == "completed")
    total_challenges = max(len(session.challenge_responses), 1)
    overall_score = max(0.0, min(1.0, _coerce_float(payload.get("overall_score"), fallback_overall)))
    narrative = str(payload.get("narrative") or "").strip() or _fallback_narrative(
        signals,
        completed_count,
        total_challenges,
    )
    completed_acceptance = payload.get("completed_acceptance")
    completed_acceptance = _normalize_text_list(completed_acceptance, [])
    missed_acceptance = _normalize_text_list(
        payload.get("missed_acceptance"),
        ticket.acceptance_criteria[:],
    )
    strengths = _normalize_text_list(
        payload.get("strengths"),
        [
            f"Maintained momentum across {completed_count} completed challenge(s).",
            "Produced enough activity to generate a stable fallback evaluation.",
        ],
    )
    gaps = _normalize_text_list(
        payload.get("gaps"),
        [
            "Model evaluation response was incomplete, so recruiter review should inspect the submitted work directly.",
            "Some acceptance coverage may still require manual confirmation.",
        ],
    )
    return {
        "overall_score": overall_score,
        "signals": signals,
        "narrative": narrative,
        "strengths": strengths,
        "gaps": gaps,
        "completed_acceptance": completed_acceptance,
        "missed_acceptance": missed_acceptance,
    }


async def run(
    job: JobSpec,
    ticket: CandidateTicket,
    challenges: list[CandidateChallenge],
    golden: Codebase,
    session: CandidateSession,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
) -> EvaluationResult:
    golden_trimmed, submitted = _build_submission_payload(
        golden,
        session,
        ticket,
        challenges,
        events,
    )
    buddy_recent = _compact_buddy_turns(buddy_history)

    # Compact job representation — only what the evaluator needs
    job_summary = {
        "title": job.title,
        "role_family": job.role_family,
        "seniority": job.seniority,
        "must_have_skills": job.must_have_skills,
    }

    user = json.dumps(
        {
            "job": job_summary,
            "ticket": ticket.model_dump(),
            "challenges": [c.model_dump(mode="json") for c in challenges],
            "challenge_responses": {
                cid: response.model_dump(mode="json")
                for cid, response in session.challenge_responses.items()
            },
            "golden_files": golden_trimmed,
            "candidate_submission": submitted,
            "buddy_chat": buddy_recent,
            "activity_summary": _summarise_events(events),
        },
        indent=2,
        default=str,
    )
    try:
        data = await complete_json(EVALUATOR, user, temperature=0.2, max_tokens=1400)
    except Exception as exc:
        log.warning("evaluator: LLM evaluation failed, using local fallback: %s", exc)
        data = {}
    normalized = _normalize_evaluation_payload(data, ticket, session, events, buddy_history)
    if not isinstance(data, dict):
        log.warning("evaluator: non-dict payload from model, using normalized fallback fields")
    else:
        missing_keys = sorted(_REQUIRED_EVALUATION_KEYS.difference(data.keys()))
        if missing_keys:
            log.warning(
                "evaluator: incomplete payload from model, using normalized fallback fields missing=%s",
                ",".join(missing_keys),
            )
    return EvaluationResult(
        session_id=session.id,
        overall_score=float(normalized["overall_score"]),
        signals=normalized["signals"],  # type: ignore[arg-type]
        narrative=str(normalized["narrative"]),
        strengths=normalized["strengths"],  # type: ignore[arg-type]
        gaps=normalized["gaps"],  # type: ignore[arg-type]
        completed_acceptance=normalized["completed_acceptance"],  # type: ignore[arg-type]
        missed_acceptance=normalized["missed_acceptance"],  # type: ignore[arg-type]
    )
