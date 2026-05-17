"""Agent A — Context Extractor.

Two paths:
1. If the recruiter has provided context (no PM tool connected), use it
   directly — no hallucination.
2. If a PM tool was selected, synthesise plausible tickets via the LLM.
   (Real OAuth integrations slot in here.)
"""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import ExtractedContext, JobSpec
from app.prompts.library import EXTRACTOR


def _from_recruiter_context(job: JobSpec) -> ExtractedContext | None:
    rc = job.recruiter_context
    if not rc:
        return None
    if not (
        rc.domain_summary
        or rc.sample_ticket_titles
        or rc.common_bug_patterns
        or rc.additional_tech_notes
    ):
        return None

    tickets = [
        {
            "key": f"TEAM-{i + 1:03d}",
            "title": t.strip(),
            "type": "feature",
            "summary": "",
        }
        for i, t in enumerate(rc.sample_ticket_titles)
        if t.strip()
    ]
    signals = sorted(
        {s.strip() for s in (job.must_have_skills + job.nice_to_have_skills) if s.strip()}
    )
    notes = " ".join(
        n for n in (rc.additional_tech_notes.strip(), rc.common_bug_patterns.strip()) if n
    )
    summary = rc.domain_summary.strip() or notes or job.title

    return ExtractedContext(
        sample_tickets=tickets,
        tech_signals=signals,
        domain_summary=summary,
    )


async def run(job: JobSpec, review_feedback: str = "") -> ExtractedContext:
    # 1. Trust the recruiter if they filled in context.
    direct = _from_recruiter_context(job)
    if direct is not None:
        return direct

    # 2. Otherwise synthesise from JD + tool.
    sections = [
        "Job spec:\n" + json.dumps(job.model_dump(), indent=2, default=str),
        f"PM tool connected: {job.pm_tool}",
    ]
    if review_feedback.strip():
        sections.append(f"Reviewer feedback to correct on this retry:\n{review_feedback.strip()}")
    sections.append("Produce the JSON described in the system prompt.")
    user = "\n\n".join(sections)
    data = await complete_json(EXTRACTOR, user, temperature=0.5)
    return ExtractedContext(**data)
