"""Phase-1 orchestrator: runs the assessment generation pipeline.

Two paths:
- GENERATED: Extractor → CodeAuthor → TicketAuthor → BugInjector
- GITHUB: FetchRepo → GitHubTicketAuthor → BugInjector
"""
from __future__ import annotations

import logging
import traceback
from datetime import datetime, timezone

from app.agents import (
    bug_injector,
    challenge_architect,
    code_author,
    extractor,
    pipeline_reviewer,
    ticket_author,
)
from app.agents import github_ticket_author
from app.agents.normalization import (
    normalize_bug_brief_payload,
    normalize_candidate_ticket_payload,
)
from app.models.schemas import (
    Assessment,
    AssessmentStatus,
    Codebase,
    CodebaseSource,
    ExtractedContext,
    PipelineStage,
)
from app.services.challenges import build_candidate_challenges
from app.services.github import build_codebase_from_github, parse_github_url
from app.store import store

log = logging.getLogger(__name__)


async def _set_status(a: Assessment, stage: PipelineStage, detail: str = "") -> None:
    a.status = AssessmentStatus(
        stage=stage, detail=detail, updated_at=datetime.now(timezone.utc)
    )
    await store.put_assessment(a)


def _review_summary(review: dict | None) -> str:
    if not review:
        return "no review result"
    reasons = review.get("reasons") or []
    return f"approved={review.get('approved', True)} reasons={len(reasons)}"


async def build_assessment(a: Assessment) -> Assessment:
    """Run the full Phase-1 pipeline on an existing Assessment."""
    await store.put_assessment(a)

    source = a.job.codebase_source

    try:
        if source == CodebaseSource.GITHUB:
            await _run_github_pipeline(a)
        else:
            await _run_generated_pipeline(a)

        await _set_status(a, PipelineStage.READY, "Assessment ready")
    except Exception as e:
        log.error("pipeline failed: %s\n%s", e, traceback.format_exc())
        await _set_status(a, PipelineStage.FAILED, f"{type(e).__name__}: {e}")
        raise

    return a


async def _run_generated_pipeline(a: Assessment) -> None:
    job = a.job

    await _set_status(a, PipelineStage.EXTRACTING, "Reading PM tool / recruiter context")
    a.context = await extractor.run(job)
    log.info(
        "pipeline[%s]: extracted context tech_signals=%d sample_tickets=%d",
        a.id,
        len(a.context.tech_signals),
        len(a.context.sample_tickets),
    )
    context_review = await pipeline_reviewer.review_context(job, a.context)
    log.info("pipeline[%s]: context review %s", a.id, _review_summary(context_review))
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.AUTHORING, "Generating production-ready codebase")
    a.golden_codebase = await code_author.run(job, a.context)
    log.info(
        "pipeline[%s]: code author produced files=%d entry_point=%s",
        a.id,
        len(a.golden_codebase.files),
        a.golden_codebase.entry_point,
    )
    try:
        review = await pipeline_reviewer.review_codebase(job, a.context, a.golden_codebase)
        log.info("pipeline[%s]: codebase review %s", a.id, _review_summary(review))
        if not review.get("approved", True):
            log.warning("pipeline[%s]: regenerating codebase from review feedback", a.id)
            a.golden_codebase = await code_author.run(
                job,
                a.context,
                review_feedback=review.get("feedback", ""),
            )
            review = await pipeline_reviewer.review_codebase(job, a.context, a.golden_codebase)
            log.info("pipeline[%s]: codebase review after regeneration %s", a.id, _review_summary(review))
    except Exception:
        log.exception("pipeline[%s]: codebase review failed", a.id)
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.TICKETING, "Drafting candidate ticket & bug plan")
    brief, ticket = await ticket_author.run(job, a.context, a.golden_codebase)
    a.bug_brief = brief
    a.candidate_ticket = ticket
    log.info(
        "pipeline[%s]: ticket author produced title=%r priority=%s defects=%d",
        a.id,
        a.candidate_ticket.title,
        a.candidate_ticket.priority,
        len(a.bug_brief.defects),
    )
    await _set_status(a, PipelineStage.CHALLENGING, "Designing the multi-challenge assessment")
    try:
        generated_challenges = await challenge_architect.run(job, a.context, a.golden_codebase, brief, ticket)
    except Exception:
        log.exception("pipeline[%s]: challenge architect failed, falling back to local challenge builder", a.id)
        generated_challenges = []
    a.candidate_challenges = build_candidate_challenges(job, brief, ticket, generated_challenges)
    log.info(
        "pipeline[%s]: challenge plan produced challenges=%d",
        a.id,
        len(a.candidate_challenges),
    )
    try:
        review = await pipeline_reviewer.review_assessment_plan(
            job,
            a.context,
            a.golden_codebase,
            a.bug_brief,
            a.candidate_ticket,
            a.candidate_challenges,
        )
        log.info("pipeline[%s]: assessment review %s", a.id, _review_summary(review))
        if not review.get("approved", True) and review.get("feedback"):
            log.warning("pipeline[%s]: regenerating ticket/challenges from review feedback", a.id)
            brief, ticket = await ticket_author.run(
                job,
                a.context,
                a.golden_codebase,
                review_feedback=review["feedback"],
            )
            a.bug_brief = brief
            a.candidate_ticket = ticket
            try:
                regenerated = await challenge_architect.run(
                    job,
                    a.context,
                    a.golden_codebase,
                    brief,
                    ticket,
                    review_feedback=review["feedback"],
                )
            except Exception:
                regenerated = []
            a.candidate_challenges = build_candidate_challenges(job, brief, ticket, regenerated)
            review = await pipeline_reviewer.review_assessment_plan(
                job,
                a.context,
                a.golden_codebase,
                a.bug_brief,
                a.candidate_ticket,
                a.candidate_challenges,
            )
            log.info("pipeline[%s]: assessment review after regeneration %s", a.id, _review_summary(review))
        if review.get("bug_brief"):
            log.info("pipeline[%s]: reviewer supplied replacement bug brief", a.id)
            a.bug_brief = brief = a.bug_brief.__class__(**normalize_bug_brief_payload(review["bug_brief"]))
        if review.get("candidate_ticket"):
            log.info("pipeline[%s]: reviewer supplied replacement candidate ticket", a.id)
            a.candidate_ticket = ticket = a.candidate_ticket.__class__(**normalize_candidate_ticket_payload(review["candidate_ticket"]))
        reviewed_challenges = pipeline_reviewer.parse_reviewed_challenges(
            review.get("candidate_challenges")
        )
        if reviewed_challenges:
            log.info("pipeline[%s]: reviewer supplied replacement challenge list (%d)", a.id, len(reviewed_challenges))
            a.candidate_challenges = build_candidate_challenges(job, brief, ticket, reviewed_challenges)
    except Exception:
        log.exception("pipeline[%s]: assessment review failed", a.id)
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.INJECTING, "Planting realistic defects")
    a.buggy_codebase = await bug_injector.run(a.golden_codebase, brief)
    await store.put_assessment(a)


async def _run_github_pipeline(a: Assessment) -> None:
    job = a.job
    gh = job.github_source
    if not gh:
        raise ValueError("codebase_source=github but github_source is missing")

    await _set_status(a, PipelineStage.FETCHING, f"Fetching repo {gh.repo_url}")
    owner, repo = parse_github_url(gh.repo_url)
    golden = await build_codebase_from_github(owner, repo, gh.branch)
    a.golden_codebase = golden
    # Synthesise a minimal extracted context from the job spec so evaluator has signals
    a.context = ExtractedContext(
        sample_tickets=[],
        tech_signals=job.must_have_skills + job.nice_to_have_skills,
        domain_summary=f"Codebase from github.com/{owner}/{repo}. {job.jd_text[:300]}",
    )
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.TICKETING, "Creating ticket from GitHub issue")
    brief, ticket = await github_ticket_author.run(job, a.context, golden, gh)
    a.bug_brief = brief
    a.candidate_ticket = ticket
    log.info(
        "pipeline[%s]: github ticket author produced title=%r priority=%s defects=%d",
        a.id,
        a.candidate_ticket.title,
        a.candidate_ticket.priority,
        len(a.bug_brief.defects),
    )
    await _set_status(a, PipelineStage.CHALLENGING, "Designing the multi-challenge assessment")
    try:
        generated_challenges = await challenge_architect.run(job, a.context, golden, brief, ticket)
    except Exception:
        log.exception("pipeline[%s]: challenge architect failed on github path, falling back to local builder", a.id)
        generated_challenges = []
    a.candidate_challenges = build_candidate_challenges(job, brief, ticket, generated_challenges)
    log.info("pipeline[%s]: github challenge plan produced challenges=%d", a.id, len(a.candidate_challenges))
    try:
        review = await pipeline_reviewer.review_assessment_plan(
            job,
            a.context,
            golden,
            a.bug_brief,
            a.candidate_ticket,
            a.candidate_challenges,
        )
        log.info("pipeline[%s]: github assessment review %s", a.id, _review_summary(review))
        if not review.get("approved", True) and review.get("feedback"):
            log.warning("pipeline[%s]: regenerating github ticket/challenges from review feedback", a.id)
            brief, ticket = await github_ticket_author.run(
                job,
                a.context,
                golden,
                gh,
                review_feedback=review["feedback"],
            )
            a.bug_brief = brief
            a.candidate_ticket = ticket
            try:
                regenerated = await challenge_architect.run(
                    job,
                    a.context,
                    golden,
                    brief,
                    ticket,
                    review_feedback=review["feedback"],
                )
            except Exception:
                regenerated = []
            a.candidate_challenges = build_candidate_challenges(job, brief, ticket, regenerated)
            review = await pipeline_reviewer.review_assessment_plan(
                job,
                a.context,
                golden,
                a.bug_brief,
                a.candidate_ticket,
                a.candidate_challenges,
            )
            log.info("pipeline[%s]: github assessment review after regeneration %s", a.id, _review_summary(review))
        if review.get("bug_brief"):
            log.info("pipeline[%s]: reviewer supplied replacement github bug brief", a.id)
            a.bug_brief = brief = a.bug_brief.__class__(**normalize_bug_brief_payload(review["bug_brief"]))
        if review.get("candidate_ticket"):
            log.info("pipeline[%s]: reviewer supplied replacement github candidate ticket", a.id)
            a.candidate_ticket = ticket = a.candidate_ticket.__class__(**normalize_candidate_ticket_payload(review["candidate_ticket"]))
        reviewed_challenges = pipeline_reviewer.parse_reviewed_challenges(
            review.get("candidate_challenges")
        )
        if reviewed_challenges:
            log.info("pipeline[%s]: reviewer supplied replacement github challenge list (%d)", a.id, len(reviewed_challenges))
            a.candidate_challenges = build_candidate_challenges(job, brief, ticket, reviewed_challenges)
    except Exception:
        log.exception("pipeline[%s]: github assessment review failed", a.id)
    await store.put_assessment(a)

    await _set_status(a, PipelineStage.INJECTING, "Planting realistic defects")
    a.buggy_codebase = await bug_injector.run(golden, brief)
    await store.put_assessment(a)
