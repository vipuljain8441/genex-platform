"""Agent — Challenge Architect (examiner).

Designs a SEQUENCE of multiple challenges for the candidate, each testing a
different angle of the role. The mix is calibrated to role family, seniority,
and tech stack.
"""
from __future__ import annotations

import json
import logging

from app.core.llm import complete_json
from app.agents.normalization import normalize_candidate_challenge_payload
from app.models.schemas import (
    BugInjectionBrief,
    CandidateChallenge,
    CandidateTicket,
    ChallengeIssue,
    Codebase,
    ExtractedContext,
    JobSpec,
    ObjectiveQuestion,
)
from app.prompts.library import CHALLENGE_ARCHITECT

log = logging.getLogger(__name__)

_MAX_FILE_CHARS = 600
_MAX_FILES = 8


def _compact_files(codebase: Codebase) -> list[dict]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in codebase.files[:_MAX_FILES]
    ]


def _extract_challenges_list(data: dict) -> list:
    """Find the challenges list regardless of how the model wrapped the response."""
    for key in ("candidate_challenges", "challenges", "assessment_challenges"):
        val = data.get(key)
        if isinstance(val, list) and val:
            return val
    # One level deep
    for v in data.values():
        if isinstance(v, dict):
            for key in ("candidate_challenges", "challenges"):
                val = v.get(key)
                if isinstance(val, list) and val:
                    return val
        elif isinstance(v, list) and v and isinstance(v[0], dict) and "kind" in v[0]:
            return v
    return []


async def run(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
    review_feedback: str = "",
) -> list[CandidateChallenge]:
    payload = {
        "job": job.model_dump(mode="json"),
        "context": context.model_dump(mode="json"),
        "ticket": ticket.model_dump(mode="json"),
        "bug_brief": brief.model_dump(mode="json"),
        "golden_files": _compact_files(golden),
        "requested_challenge_count": job.challenge_count,
        "requested_challenge_types": [kind.value for kind in job.challenge_types],
    }
    user = json.dumps(payload, indent=2, default=str)
    if review_feedback.strip():
        user += f"\n\nReviewer feedback to correct on this retry:\n{review_feedback.strip()}"
    data = await complete_json(CHALLENGE_ARCHITECT, user, temperature=0.5, max_tokens=3500)

    challenges_raw = _extract_challenges_list(data)
    if not challenges_raw:
        log.warning("challenge_architect: no challenges in response. keys=%s", list(data.keys()))

    out: list[CandidateChallenge] = []
    for raw in challenges_raw:
        try:
            raw = normalize_candidate_challenge_payload(raw)
            if "issues" in raw:
                raw["issues"] = [
                    ChallengeIssue(**issue).model_dump(mode="json") for issue in raw["issues"]
                ]
            if "objective_questions" in raw:
                raw["objective_questions"] = [
                    ObjectiveQuestion(**q).model_dump(mode="json")
                    for q in raw["objective_questions"]
                ]
            out.append(CandidateChallenge(**raw))
        except Exception as exc:
            log.warning("challenge_architect: skipping unparseable challenge: %s", exc)

    kinds_summary = ", ".join(c.kind.value for c in out) or "(none)"
    log.info("challenge_architect: produced %d challenges [%s]", len(out), kinds_summary)
    return out
