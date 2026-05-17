"""Agent for GitHub path: adapt a real GitHub issue into an assessment ticket + bug brief."""
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
    GitHubSource,
    JobSpec,
)
from app.prompts.library import GITHUB_TICKET_AUTHOR

log = logging.getLogger(__name__)


async def run(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
    gh: GitHubSource,
    review_feedback: str = "",
) -> tuple[BugInjectionBrief, CandidateTicket]:
    reviewer_section = (
        "Reviewer feedback from a prior generation attempt:\n"
        f"{review_feedback.strip()}\n\n"
        if review_feedback.strip()
        else ""
    )
    issue_ctx = ""
    if gh.issue_number and gh.issue_title:
        issue_ctx = (
            f"GitHub Issue #{gh.issue_number}: {gh.issue_title}\n\n"
            f"{gh.issue_body or 'No description provided.'}"
        )
    else:
        issue_ctx = (
            "No specific issue was selected. Create an appropriate ticket "
            "based on the codebase and job spec."
        )

    file_summaries = [
        {"path": f.path, "language": f.language, "preview": f.content[:600]}
        for f in golden.files[:8]
    ]

    user = (
        "Job spec:\n"
        f"{json.dumps(job.model_dump(), indent=2, default=str)}\n\n"
        "Extracted context:\n"
        f"{json.dumps(context.model_dump(mode='json'), indent=2, default=str)}\n\n"
        f"{reviewer_section}"
        "GitHub Issue:\n"
        f"{issue_ctx}\n\n"
        "Codebase files (first 400 chars each):\n"
        f"{json.dumps(file_summaries, indent=2)}\n\n"
        "Produce the JSON described in the system prompt."
    )
    data = await complete_json(GITHUB_TICKET_AUTHOR, user, temperature=0.6, max_tokens=3000)
    brief_payload = normalize_bug_brief_payload(data["bug_brief"])
    ticket_payload = normalize_candidate_ticket_payload(data["candidate_ticket"])
    log.info(
        "github_ticket_author: normalized ticket priority=%s labels=%s defects=%d",
        ticket_payload.get("priority"),
        ticket_payload.get("labels"),
        len(brief_payload.get("defects") or []),
    )
    brief = BugInjectionBrief(**brief_payload)
    ticket = CandidateTicket(**ticket_payload)
    return brief, ticket
