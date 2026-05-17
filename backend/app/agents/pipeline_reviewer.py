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
_MIN_TOTAL_LINES_BY_SENIORITY = {
    "junior": 120,
    "mid": 220,
    "senior": 420,
    "staff": 560,
}
_ROLE_FILE_HINTS = {
    "backend": ("route", "router", "api", "service", "model", "schema", "repo", "db", "test"),
    "frontend": ("page", "component", "hook", "state", "store", "test", "client"),
    "fullstack": ("route", "api", "service", "component", "page", "hook", "test"),
    "data": ("pipeline", "extract", "transform", "load", "model", "schema", "test"),
    "qa": ("test", "spec", "fixture", "helper", "service"),
    "devops": ("docker", "deploy", "pipeline", "workflow", "terraform", "helm", "monitor"),
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


def _total_line_count(codebase: Codebase) -> int:
    return sum(max(1, len(f.content.splitlines())) for f in codebase.files)


def _has_any_path(files: list[str], *needles: str) -> bool:
    lowered = [path.lower() for path in files]
    return any(any(needle in path for needle in needles) for path in lowered)


def _extract_path_from_location_hint(hint: str) -> str:
    text = hint.strip()
    if " / " in text:
        return text.split(" / ", 1)[0].strip()
    return text.split()[0].strip()


def local_codebase_review(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
) -> dict[str, Any]:
    reasons: list[str] = []
    text = _codebase_text(golden)
    job_text = _job_text(job, context)
    file_paths = [f.path for f in golden.files]
    total_lines = _total_line_count(golden)
    seniority = job.seniority.value if hasattr(job.seniority, "value") else str(job.seniority)
    role = job.role_family.value if hasattr(job.role_family, "value") else str(job.role_family)

    if len(golden.files) < 4:
        reasons.append("The generated artifact is too small to feel like a real inherited codebase.")
    if not golden.entry_point:
        reasons.append("The codebase is missing a clear entry point.")
    if len(golden.setup_instructions.strip()) < 20:
        reasons.append("Setup instructions are too thin to be useful.")
    if total_lines < _MIN_TOTAL_LINES_BY_SENIORITY.get(seniority, 180):
        reasons.append(
            f"The generated codebase is too thin for {seniority} seniority ({total_lines} total lines across files)."
        )

    if not _has_any_path(file_paths, "readme"):
        reasons.append("The codebase is missing a README that explains setup and intent.")
    if not _has_any_path(file_paths, "test", "spec"):
        reasons.append("The codebase is missing a realistic test file.")

    if role in _ROLE_FILE_HINTS:
        matched_hints = sum(
            1 for hint in _ROLE_FILE_HINTS[role]
            if _has_any_path(file_paths, hint)
        )
        if matched_hints < min(3, len(_ROLE_FILE_HINTS[role])):
            reasons.append(
                f"The file structure does not yet look like a mature {role} codebase; it is missing expected layers such as {', '.join(_ROLE_FILE_HINTS[role][:4])}."
            )

    if seniority in {"senior", "staff"}:
        if not _has_any_path(file_paths, "config", "settings", ".env", "middleware", "interceptor"):
            reasons.append("Senior/staff codebases should include config and cross-cutting concerns such as settings or middleware.")

    must_have = [skill.strip().lower() for skill in job.must_have_skills if skill.strip()]
    skill_hits = sum(1 for skill in must_have[:4] if skill in text)
    if must_have and skill_hits == 0:
        reasons.append("The generated files do not visibly reflect the employer's must-have stack.")

    generic_hits = sorted(term for term in _GENERIC_DOMAIN_TERMS if term in text)
    if generic_hits and not any(term in job_text for term in generic_hits):
        reasons.append(
            "The codebase still leans on generic e-commerce/order-management concepts that do not appear in the employer input."
        )

    placeholder_hits = [
        snippet for snippet in ("pass", "todo", "stub", "placeholder", "lorem")
        if snippet in text
    ]
    if placeholder_hits:
        reasons.append(
            "The codebase still contains placeholder implementation markers "
            f"({', '.join(sorted(set(placeholder_hits)))}) instead of production-style logic."
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
    if len(context.sample_tickets) < 3:
        reasons.append("The extracted context should provide at least 3 realistic sample tickets to ground downstream agents.")
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



_TESTABLE_WORDS = {"given", "when", "then", "assert", "expect", "should", "must", "verify", "ensure"}


def local_assessment_plan_review(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
    challenges: list[CandidateChallenge],
) -> dict[str, Any]:
    reasons: list[str] = []
    job_text = _job_text(job, context)
    codebase_paths = {file.path for file in golden.files}
    ticket_text = " ".join(
        [
            ticket.title,
            ticket.description,
            " ".join(ticket.acceptance_criteria),
            " ".join(ticket.labels),
        ]
    ).lower()

    # ── Ticket quality ────────────────────────────────────────────────────────
    desc = ticket.description.strip()
    if len(desc) < 150:
        reasons.append(
            f"Ticket description is too short ({len(desc)} chars). "
            "It must describe the symptom, business impact, and system area clearly."
        )

    ac = ticket.acceptance_criteria
    if len(ac) < 3:
        reasons.append(f"Only {len(ac)} acceptance criteria found. Need at least 3 testable criteria.")
    else:
        testable = sum(1 for c in ac if any(w in c.lower() for w in _TESTABLE_WORDS))
        if testable == 0:
            reasons.append(
                "Acceptance criteria lack testable language. "
                "Use 'Given/When/Then' format or 'should', 'must', 'assert'."
            )

    if len(ticket.labels) < 2:
        reasons.append("Ticket needs at least 2 labels mixing domain context and tech stack terms.")
    if len(set(ticket.labels)) != len(ticket.labels):
        reasons.append("Ticket labels should be unique and high-signal instead of repeated.")

    # ── Domain drift check ────────────────────────────────────────────────────
    generic_hits = sorted(term for term in _GENERIC_DOMAIN_TERMS if term in ticket_text)
    if generic_hits and not any(term in job_text for term in generic_hits):
        reasons.append(
            f"Ticket uses generic domain terms ({', '.join(generic_hits)}) "
            "that do not appear in the employer's job spec. Rewrite to match the actual domain."
        )

    # ── Bug brief quality ─────────────────────────────────────────────────────
    for defect in brief.defects:
        # defects are stored as plain dicts, not Pydantic models
        if isinstance(defect, dict):
            hint = (defect.get("location_hint") or "").strip()
            bc = (defect.get("behavior_change") or "").strip()
        else:
            hint = (getattr(defect, "location_hint", None) or "").strip()
            bc = (getattr(defect, "behavior_change", None) or "").strip()
        if not hint or len(hint) < 10 or ("/" not in hint and "." not in hint):
            reasons.append(
                f"Defect location_hint {hint!r} is too vague. "
                "Must reference a specific file path and function name (e.g. 'services/auth.py / validate_token')."
            )
        else:
            hinted_path = _extract_path_from_location_hint(hint)
            if hinted_path and hinted_path not in codebase_paths:
                reasons.append(
                    f"Defect location_hint {hint!r} does not point to a real file from the generated codebase."
                )
        if len(bc) < 30:
            reasons.append(
                f"Defect behavior_change {bc!r} is too vague. "
                "Describe the exact wrong output or condition that triggers the defect."
            )

    # ── Challenge quality ─────────────────────────────────────────────────────
    if abs(len(challenges) - max(job.challenge_count, 1)) > 1:
        reasons.append(
            f"Challenge count {len(challenges)} is too far from the requested count {job.challenge_count}."
        )

    if job.role_family.value in {"backend", "frontend", "fullstack", "qa", "devops", "data"}:
        if not any(challenge.kind.value == "coding" for challenge in challenges):
            reasons.append("Technical roles need at least one implementation-oriented coding challenge.")

    has_sql_signal = any(
        token in job_text
        for token in ["sql", "postgres", "mysql", "snowflake", "bigquery", "redshift", "warehouse", "analytics"]
    )
    if any(challenge.kind.value == "sql" for challenge in challenges) and not has_sql_signal:
        reasons.append("A SQL challenge was added but the employer's stack does not justify it. Remove or replace it.")

    if len(challenges) > 1 and len({c.kind.value for c in challenges}) == 1:
        reasons.append(
            "All challenges are the same kind. "
            "Vary the assessment — e.g. one coding + one theory/objective — to test the role from multiple angles."
        )

    for challenge in challenges:
        if len(challenge.issues) < 2:
            reasons.append(f'Challenge "{challenge.title}" needs at least 2 concrete sub-issues.')
        if len(challenge.title.strip()) < 12:
            reasons.append(f'Challenge "{challenge.title}" title is too generic; make it specific to the task.')
        if len(challenge.instructions.strip()) < 40:
            reasons.append(f'Challenge "{challenge.title}" instructions are too thin to guide a candidate clearly.')
        if challenge.kind.value == "coding":
            if not challenge.workspace_enabled:
                reasons.append(f'Challenge "{challenge.title}" should open the coding workspace.')
            if not challenge.related_files:
                reasons.append(f'Challenge "{challenge.title}" should point the candidate to relevant files.')
            for path in challenge.related_files:
                if path not in codebase_paths:
                    reasons.append(
                        f'Challenge "{challenge.title}" references related file {path!r}, which is not in the generated codebase.'
                    )
        if challenge.kind.value == "sql" and challenge.workspace_enabled:
            reasons.append(f'Challenge "{challenge.title}" should stay outside the main code workspace.')
        if challenge.kind.value in {"theory", "objective"} and challenge.allow_buddy:
            reasons.append(f'Challenge "{challenge.title}": theory/objective challenges must set allow_buddy=false.')

    approved = not reasons
    feedback = (
        ""
        if approved
        else (
            "CRITICAL ISSUES TO FIX:\n"
            + "\n".join(f"- {r}" for r in reasons)
            + "\n\nRegenerate the ticket with a specific description (300+ chars), "
            "testable acceptance criteria, precise defect location hints, "
            "and a challenge mix appropriate for the role."
        )
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

    # Local passed — trust it, skip the LLM call entirely (saves tokens + latency)
    if local["approved"]:
        log.info("pipeline_reviewer: local assessment review passed — skipping LLM review")
        return local

    # Local failed — call LLM to generate improved REPLACEMENTS directly.
    # We don't just ask it to "review"; we tell it what's wrong and ask for fixed content.
    user = json.dumps(
        {
            "review_stage": "assessment_plan",
            "local_review_failures": local["reasons"],
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
        llm = await complete_json(ASSESSMENT_REVIEWER, user, temperature=0.45, max_tokens=4000)
    except Exception:
        log.warning("pipeline_reviewer: LLM unavailable after local failure — returning local review")
        return local

    # The LLM should supply replacement content when local fails.
    # Merge: take LLM replacements; keep local reasons; mark not approved.
    review = {
        "approved": False,
        "feedback": _llm_feedback_text(llm) or local["feedback"],
        "reasons": local["reasons"],
        "candidate_ticket": llm.get("candidate_ticket"),
        "bug_brief": llm.get("bug_brief"),
        "candidate_challenges": llm.get("candidate_challenges"),
    }
    has_replacements = any(review[k] for k in ("candidate_ticket", "bug_brief", "candidate_challenges"))
    log.info(
        "pipeline_reviewer: LLM generated replacements after local failure — "
        "has_ticket=%s has_brief=%s has_challenges=%s",
        bool(review["candidate_ticket"]),
        bool(review["bug_brief"]),
        bool(review["candidate_challenges"]),
    )
    if not has_replacements:
        log.warning("pipeline_reviewer: LLM did not supply replacements — orchestrator will retry ticket_author")
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
