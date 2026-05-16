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
    submitted = [{"path": p, "content": c} for p, c in session.current_files.items()]
    user = json.dumps(
        {
            "job": job.model_dump(),
            "ticket": ticket.model_dump(),
            "golden_files": [f.model_dump() for f in golden.files],
            "candidate_submission": submitted,
            "buddy_chat": [t.model_dump() for t in buddy_history],
            "activity_summary": _summarise_events(events),
        },
        indent=2,
        default=str,
    )
    data = await complete_json(EVALUATOR, user, temperature=0.3, max_tokens=3000)
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
