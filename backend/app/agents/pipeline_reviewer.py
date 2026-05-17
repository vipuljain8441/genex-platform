"""Specialized reviewer that checks generated artifacts for grounding and quality."""
from __future__ import annotations

import json
import logging
from typing import Any

from app.core.llm import complete_json
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
from app.prompts.library import ASSESSMENT_REVIEWER

log = logging.getLogger(__name__)

_MAX_FILE_CHARS = 700
_MAX_FILES = 8
_GENERIC_DOMAIN_TERMS = {
    "order",
    "orders",
    "checkout",
    "cart",
    "inventory",
    "shipping",
    "coupon",
    "payment",
    "payments",
}


def _compact_files(codebase: Codebase) -> list[dict[str, Any]]:
    return [
        {"path": f.path, "language": f.language, "content": f.content[:_MAX_FILE_CHARS]}
        for f in codebase.files[:_MAX_FILES]
    ]


def _job_text(job: JobSpec, context: ExtractedContext | None = None) -> str:
    parts = [
        job.title,
        job.industry,
        job.jd_text,
        " ".join(job.must_have_skills),
        " ".join(job.nice_to_have_skills),
    ]
    if context:
        parts.extend(
            [
                context.domain_summary,
                " ".join(context.tech_signals),
                " ".join(ticket.get("title", "") for ticket in context.sample_tickets),
            ]
        )
    return " ".join(parts).lower()


def _codebase_text(codebase: Codebase) -> str:
    return " ".join(
        [
            codebase.entry_point or "",
            codebase.setup_instructions or "",
            " ".join(f.path for f in codebase.files),
            " ".join(f.content[:500] for f in codebase.files[:6]),
        ]
    ).lower()


def _llm_feedback_text(review: dict[str, Any]) -> str:
    reasons = review.get("reasons") or []
    feedback = (review.get("feedback") or "").strip()
    details = [feedback] if feedback else []
    details.extend(str(reason).strip() for reason in reasons if str(reason).strip())
    return "\n".join(dict.fromkeys(details))


def local_codebase_review(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
) -> dict[str, Any]:
    reasons: list[str] = []
    text = _codebase_text(golden)
    job_text = _job_text(job, context)

    if len(golden.files) < 4:
        reasons.append("The generated artifact is too small to feel like a real inherited codebase.")
    if not golden.entry_point:
        reasons.append("The codebase is missing a clear entry point.")
    if len(golden.setup_instructions.strip()) < 20:
        reasons.append("Setup instructions are too thin to be useful.")

    must_have = [skill.strip().lower() for skill in job.must_have_skills if skill.strip()]
    skill_hits = sum(1 for skill in must_have[:4] if skill in text)
    if must_have and skill_hits == 0:
        reasons.append("The generated files do not visibly reflect the employer's must-have stack.")

    generic_hits = sorted(term for term in _GENERIC_DOMAIN_TERMS if term in text)
    if generic_hits and not any(term in job_text for term in generic_hits):
        reasons.append(
            "The codebase still leans on generic e-commerce/order-management concepts that do not appear in the employer input."
        )

    approved = not reasons
    feedback = ""
    if not approved:
        feedback = (
            "Regenerate the codebase so it matches the employer's actual stack, product domain, and day-one work. "
            "Avoid canned order/cart/payment examples unless the employer explicitly points there."
        )
    review = {"approved": approved, "feedback": feedback, "reasons": reasons}
    log.info("pipeline_reviewer: local codebase review approved=%s reasons=%d", approved, len(reasons))
    return review


def local_context_review(
    job: JobSpec,
    context: ExtractedContext,
) -> dict[str, Any]:
    reasons: list[str] = []
    if len(context.tech_signals) < max(1, min(2, len(job.must_have_skills))):
        reasons.append("The extracted context did not retain enough tech signals from the employer input.")
    if not context.sample_tickets:
        reasons.append("The extracted context did not produce any sample tickets.")
    if len(context.domain_summary.strip()) < 20:
        reasons.append("The extracted context domain summary is too thin.")
    generic_hits = sorted(term for term in _GENERIC_DOMAIN_TERMS if term in context.domain_summary.lower())
    job_text = _job_text(job, context)
    if generic_hits and not any(term in job_text for term in generic_hits):
        reasons.append("The extracted context drifted into a generic e-commerce domain not present in the employer input.")
    approved = not reasons
    feedback = ""
    if not approved:
        feedback = (
            "Re-extract context so the domain summary, tickets, and tech signals stay tightly grounded in the employer's actual role and stack."
        )
    review = {"approved": approved, "feedback": feedback, "reasons": reasons}
    log.info("pipeline_reviewer: local context review approved=%s reasons=%d", approved, len(reasons))
    return review


def local_assessment_plan_review(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
    challenges: list[CandidateChallenge],
) -> dict[str, Any]:
    del golden
    reasons: list[str] = []
    job_text = _job_text(job, context)
    ticket_text = " ".join(
        [
            ticket.title,
            ticket.description,
            " ".join(ticket.acceptance_criteria),
            " ".join(ticket.labels),
        ]
    ).lower()

    if len(ticket.description.strip()) < 180:
        reasons.append("The candidate ticket description is too short and should carry more business and technical context.")
    if len(ticket.acceptance_criteria) < 3:
        reasons.append("The candidate ticket needs more concrete acceptance criteria.")
    if len(ticket.labels) < 2:
        reasons.append("The candidate ticket should include richer domain and tech labels.")

    generic_hits = sorted(term for term in _GENERIC_DOMAIN_TERMS if term in ticket_text)
    if generic_hits and not any(term in job_text for term in generic_hits):
        reasons.append(
            "The ticket still uses generic order/cart/payment style language that does not match the employer input."
        )

    if job.role_family.value in {"backend", "frontend", "fullstack", "qa", "devops", "data"}:
        if not any(challenge.kind.value == "coding" for challenge in challenges):
            reasons.append("Hands-on technical roles should include at least one implementation-oriented challenge.")

    has_sql_signal = any(
        token in job_text
        for token in ["sql", "postgres", "mysql", "snowflake", "bigquery", "redshift", "warehouse", "analytics"]
    )
    if any(challenge.kind.value == "sql" for challenge in challenges) and not has_sql_signal:
        reasons.append("A SQL challenge was created even though the employer input does not strongly justify it.")

    if len(challenges) > 1 and len({challenge.kind.value for challenge in challenges}) == 1:
        reasons.append("The challenge sequence is too repetitive and should test the role from more than one angle when multiple challenges are requested.")

    for challenge in challenges:
        if len(challenge.issues) < 2:
            reasons.append(f'Challenge "{challenge.title}" should contain multiple concrete issues.')
        if challenge.kind.value in {"theory", "objective"} and challenge.allow_buddy:
            reasons.append(f'Challenge "{challenge.title}" should have Buddy disabled.')

    approved = not reasons
    feedback = ""
    if not approved:
        feedback = (
            "Revise the ticket and challenge plan so it is role-specific, more descriptive, and grounded in the employer's real stack and backlog. "
            "Do not force challenge types that are not justified."
        )
    review = {
        "approved": approved,
        "feedback": feedback,
        "reasons": reasons,
        "candidate_ticket": None,
        "bug_brief": None,
        "candidate_challenges": None,
    }
    log.info("pipeline_reviewer: local assessment review approved=%s reasons=%d", approved, len(reasons))
    return review


async def review_codebase(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
) -> dict[str, Any]:
    local = local_codebase_review(job, context, golden)
    user = json.dumps(
        {
            "review_stage": "codebase",
            "job": job.model_dump(mode="json"),
            "context": context.model_dump(mode="json"),
            "golden_codebase": {
                "artifact_kind": golden.artifact_kind.value,
                "entry_point": golden.entry_point,
                "setup_instructions": golden.setup_instructions,
                "files": _compact_files(golden),
            },
        },
        indent=2,
        default=str,
    )
    try:
        llm = await complete_json(ASSESSMENT_REVIEWER, user, temperature=0.2, max_tokens=1800)
    except Exception:
        log.warning("pipeline_reviewer: LLM codebase review unavailable, using local review only")
        return local

    llm_feedback = _llm_feedback_text(llm)
    reasons = list(dict.fromkeys([*local["reasons"], *[r for r in (llm.get("reasons") or []) if str(r).strip()]]))
    approved = bool(local["approved"]) and bool(llm.get("approved", True))
    feedback = local["feedback"] or llm_feedback
    if not approved and not feedback:
        feedback = llm_feedback or "Regenerate the codebase so it better matches the employer's real requirements."
    review = {"approved": approved, "feedback": feedback, "reasons": reasons}
    log.info("pipeline_reviewer: merged codebase review approved=%s reasons=%d", approved, len(reasons))
    return review


async def review_context(
    job: JobSpec,
    context: ExtractedContext,
) -> dict[str, Any]:
    review = local_context_review(job, context)
    return review


async def review_assessment_plan(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
    challenges: list[CandidateChallenge],
) -> dict[str, Any]:
    local = local_assessment_plan_review(job, context, golden, brief, ticket, challenges)
    user = json.dumps(
        {
            "review_stage": "assessment_plan",
            "job": job.model_dump(mode="json"),
            "context": context.model_dump(mode="json"),
            "golden_codebase": {
                "artifact_kind": golden.artifact_kind.value,
                "entry_point": golden.entry_point,
                "setup_instructions": golden.setup_instructions,
                "files": _compact_files(golden),
            },
            "bug_brief": brief.model_dump(mode="json"),
            "candidate_ticket": ticket.model_dump(mode="json"),
            "candidate_challenges": [challenge.model_dump(mode="json") for challenge in challenges],
        },
        indent=2,
        default=str,
    )
    try:
        llm = await complete_json(ASSESSMENT_REVIEWER, user, temperature=0.2, max_tokens=3500)
    except Exception:
        log.warning("pipeline_reviewer: LLM assessment review unavailable, using local review only")
        return local

    llm_feedback = _llm_feedback_text(llm)
    reasons = list(dict.fromkeys([*local["reasons"], *[r for r in (llm.get("reasons") or []) if str(r).strip()]]))
    approved = bool(local["approved"]) and bool(llm.get("approved", True))
    feedback = local["feedback"] or llm_feedback
    if not approved and not feedback:
        feedback = llm_feedback or "Revise the ticket and challenge plan to better match the employer's requirements."
    review = {
        "approved": approved,
        "feedback": feedback,
        "reasons": reasons,
        "candidate_ticket": llm.get("candidate_ticket"),
        "bug_brief": llm.get("bug_brief"),
        "candidate_challenges": llm.get("candidate_challenges"),
    }
    log.info("pipeline_reviewer: merged assessment review approved=%s reasons=%d", approved, len(reasons))
    return review


def parse_reviewed_challenges(raw: list[dict[str, Any]] | None) -> list[CandidateChallenge]:
    if not raw:
        return []
    out: list[CandidateChallenge] = []
    for item in raw:
        if "issues" in item:
            item["issues"] = [ChallengeIssue(**issue).model_dump(mode="json") for issue in item["issues"]]
        if "objective_questions" in item:
            item["objective_questions"] = [
                ObjectiveQuestion(**question).model_dump(mode="json")
                for question in item["objective_questions"]
            ]
        out.append(CandidateChallenge(**item))
    return out
