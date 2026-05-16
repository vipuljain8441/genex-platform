"""Evaluator — grades the candidate submission + behavioural signals."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import (
    ActivityEvent,
    BuddyTurn,
    CandidateSession,
    CandidateTicket,
    Codebase,
    EvaluationResult,
    JobSpec,
    SignalScore,
)
from app.prompts.library import EVALUATOR

# Keep token budget manageable across model tiers
_MAX_FILE_CHARS = 2000
_MAX_FILES = 8
_MAX_BUDDY_TURNS = 10


def _trim_files(files: list[dict]) -> list[dict]:
    out = []
    for f in files[:_MAX_FILES]:
        content = f.get("content", "")
        if len(content) > _MAX_FILE_CHARS:
            content = content[:_MAX_FILE_CHARS] + "\n# ...(truncated for evaluation)"
        out.append({**f, "content": content})
    return out


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


async def run(
    job: JobSpec,
    ticket: CandidateTicket,
    golden: Codebase,
    session: CandidateSession,
    events: list[ActivityEvent],
    buddy_history: list[BuddyTurn],
) -> EvaluationResult:
    submitted = [
        {"path": p, "content": c[:_MAX_FILE_CHARS]}
        for p, c in session.current_files.items()
    ]
    golden_trimmed = _trim_files([f.model_dump() for f in golden.files])
    buddy_recent = [t.model_dump() for t in buddy_history[-_MAX_BUDDY_TURNS:]]

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
            "golden_files": golden_trimmed,
            "candidate_submission": submitted,
            "buddy_chat": buddy_recent,
            "activity_summary": _summarise_events(events),
        },
        indent=2,
        default=str,
    )
    data = await complete_json(EVALUATOR, user, temperature=0.3, max_tokens=2000)
    return EvaluationResult(
        session_id=session.id,
        overall_score=float(data["overall_score"]),
        signals=[SignalScore(**s) for s in data["signals"]],
        narrative=data["narrative"],
        strengths=data.get("strengths", []),
        gaps=data.get("gaps", []),
        completed_acceptance=data.get("completed_acceptance", []),
        missed_acceptance=data.get("missed_acceptance", []),
    )
