"""Agent C — Ticket Author. Emits bug-injection brief + candidate-facing ticket."""
from __future__ import annotations

import json
import logging

from app.core.llm import complete_json
from app.agents.normalization import (
    normalize_bug_brief_payload,
    normalize_candidate_ticket_payload,
)
from app.models.schemas import (
    BugInjectionBrief,
    CandidateTicket,
    Codebase,
    ExtractedContext,
    JobSpec,
)
from app.prompts.library import TICKET_AUTHOR

log = logging.getLogger(__name__)

_MAX_FILE_CHARS = 800   # keep total input well under 15k TPM
_MAX_FILES = 6

# Alternate key names different models use for the two output sections
_BRIEF_KEYS = ("bug_brief", "bug_injection_brief", "brief", "injection_brief")
_TICKET_KEYS = ("candidate_ticket", "ticket", "jira_ticket", "candidate_ticket_out", "issue")


def _compact_files(codebase: Codebase) -> list[dict]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in codebase.files[:_MAX_FILES]
    ]


def _find_section(data: dict, *keys: str) -> dict | None:
    """Find the first matching key at top level, then one level deep, then any dict value."""
    # Top-level exact match
    for k in keys:
        if isinstance(data.get(k), dict):
            return data[k]

    # One level deep (model wrapped everything under a single parent key)
    for v in data.values():
        if not isinstance(v, dict):
            continue
        for k in keys:
            if isinstance(v.get(k), dict):
                return v[k]

    # Last resort: return the first dict value that looks like a match (for flat responses)
    return None


async def run(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
    review_feedback: str = "",
) -> tuple[BugInjectionBrief, CandidateTicket]:
    reviewer_section = (
        "Reviewer feedback from a prior generation attempt:\n"
        f"{review_feedback.strip()}\n\n"
        if review_feedback.strip()
        else ""
    )
    job_compact = {
        "title": job.title,
        "role_family": job.role_family,
        "seniority": job.seniority,
        "industry": job.industry,
        "must_have_skills": job.must_have_skills,
        "jd_text": job.jd_text[:300],
    }
    user = (
        "Job spec:\n"
        f"{json.dumps(job_compact, indent=2, default=str)}\n\n"
        "Extracted context:\n"
        f"{json.dumps(context.model_dump(mode='json'), indent=2, default=str)}\n\n"
        f"{reviewer_section}"
        "Golden artifact files (first 800 chars each):\n"
        f"{json.dumps(_compact_files(golden), indent=2)}\n\n"
        "Produce the JSON described in the system prompt. "
        "The response MUST be a single JSON object with exactly two top-level keys: "
        '"bug_brief" and "candidate_ticket".'
    )
    data = await complete_json(TICKET_AUTHOR, user, temperature=0.6, max_tokens=2000)

    brief_raw = _find_section(data, *_BRIEF_KEYS)
    ticket_raw = _find_section(data, *_TICKET_KEYS)

    if brief_raw is None or ticket_raw is None:
        log.error(
            "ticket_author: unexpected LLM response structure. top-level keys=%s",
            list(data.keys()),
        )
        raise ValueError(
            f"LLM response missing required sections. "
            f"Expected 'bug_brief' + 'candidate_ticket', got keys: {list(data.keys())}"
        )

    brief_payload = normalize_bug_brief_payload(brief_raw)
    ticket_payload = normalize_candidate_ticket_payload(ticket_raw)
    log.info(
        "ticket_author: normalized ticket priority=%s labels=%s defects=%d",
        ticket_payload.get("priority"),
        ticket_payload.get("labels"),
        len(brief_payload.get("defects") or []),
    )
    brief = BugInjectionBrief(**brief_payload)
    ticket = CandidateTicket(**ticket_payload)
    return brief, ticket
