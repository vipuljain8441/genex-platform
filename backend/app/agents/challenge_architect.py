"""Specialized agent that designs the multi-challenge assessment plan."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import (
    BugInjectionBrief,
    CandidateChallenge,
    CandidateTicket,
    ChallengeIssue,
    Codebase,
    JobSpec,
    ObjectiveQuestion,
)
from app.prompts.library import CHALLENGE_ARCHITECT

_MAX_FILE_CHARS = 600
_MAX_FILES = 8


def _compact_files(codebase: Codebase) -> list[dict]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in codebase.files[:_MAX_FILES]
    ]


async def run(
    job: JobSpec,
    golden: Codebase,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
) -> list[CandidateChallenge]:
    user = json.dumps(
        {
            "job": job.model_dump(mode="json"),
            "ticket": ticket.model_dump(mode="json"),
            "bug_brief": brief.model_dump(mode="json"),
            "golden_files": _compact_files(golden),
            "requested_challenge_count": job.challenge_count,
            "requested_challenge_types": [kind.value for kind in job.challenge_types],
        },
        indent=2,
        default=str,
    )
    data = await complete_json(CHALLENGE_ARCHITECT, user, temperature=0.5, max_tokens=3500)

    # Tolerate alternate key names from different fallback models
    challenges_raw = (
        data.get("candidate_challenges")
        or data.get("challenges")
        or data.get("assessment_challenges")
        or []
    )
    # If model wrapped everything under a parent key, look one level deep
    if not challenges_raw:
        for v in data.values():
            if isinstance(v, list) and v:
                challenges_raw = v
                break
            if isinstance(v, dict):
                for k in ("candidate_challenges", "challenges"):
                    if isinstance(v.get(k), list):
                        challenges_raw = v[k]
                        break

    out: list[CandidateChallenge] = []
    for raw in challenges_raw:
        if "issues" in raw:
            raw["issues"] = [ChallengeIssue(**issue).model_dump(mode="json") for issue in raw["issues"]]
        if "objective_questions" in raw:
            raw["objective_questions"] = [
                ObjectiveQuestion(**question).model_dump(mode="json")
                for question in raw["objective_questions"]
            ]
        out.append(CandidateChallenge(**raw))
    return out
