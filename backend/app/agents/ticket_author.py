"""Agent C — Ticket Author (examiner).

Designs one focused engineering task for the candidate. If the active LLM
returns placeholder-heavy or malformed content, we synthesize a grounded local
ticket and bug brief from the generated codebase so the assessment can proceed.
"""
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

_MAX_FILE_CHARS = 800
_MAX_FILES = 6
_BRIEF_KEYS = ("bug_brief", "bug_injection_brief", "brief", "injection_brief")
_TICKET_KEYS = ("candidate_ticket", "ticket", "jira_ticket", "candidate_ticket_out", "issue")
_PLACEHOLDER_TOKENS = {"...", "domain-label", "tech-label", "placeholder", "sample"}


def _compact_files(codebase: Codebase) -> list[dict]:
    return [
        {"path": file.path, "language": file.language, "content": file.content[:_MAX_FILE_CHARS]}
        for file in codebase.files[:_MAX_FILES]
    ]


def _find_section(data: dict, *keys: str) -> dict | None:
    for key in keys:
        if isinstance(data.get(key), dict):
            return data[key]
    for value in data.values():
        if not isinstance(value, dict):
            continue
        for key in keys:
            if isinstance(value.get(key), dict):
                return value[key]
    return None


def _domain_label(job: JobSpec, context: ExtractedContext) -> str:
    text = " ".join([job.title, job.industry, job.jd_text, context.domain_summary]).lower()
    if "health" in text or "patient" in text or "care" in text:
        return "care-ops"
    if "finance" in text or "fintech" in text or "ledger" in text or "risk" in text:
        return "ledger"
    if "deploy" in text or "incident" in text or "platform" in text:
        return "platform"
    if "data" in text or "warehouse" in text or "analytics" in text:
        return "analytics"
    return "product"


def _preferred_paths(codebase: Codebase) -> list[str]:
    def score(path: str) -> tuple[int, str]:
        lowered = path.lower()
        if "service" in lowered or "store" in lowered or "repository" in lowered:
            return (0, lowered)
        if "route" in lowered or "api" in lowered or "server" in lowered:
            return (1, lowered)
        if "model" in lowered or "type" in lowered:
            return (2, lowered)
        if "test" in lowered:
            return (4, lowered)
        return (3, lowered)

    return [file.path for file in sorted(codebase.files, key=lambda file: score(file.path))]


def _defect_count(job: JobSpec) -> int:
    seniority = job.seniority.value if hasattr(job.seniority, "value") else str(job.seniority)
    return {"junior": 1, "mid": 2, "senior": 3, "staff": 4}.get(seniority, 2)


def _task_type(job: JobSpec) -> str:
    role = job.role_family.value if hasattr(job.role_family, "value") else str(job.role_family)
    seniority = job.seniority.value if hasattr(job.seniority, "value") else str(job.seniority)
    if role == "devops":
        return "fix-config"
    if role == "qa":
        return "add-tests"
    if role == "frontend":
        return "enhance"
    if role == "data":
        return "performance" if seniority in {"senior", "staff"} else "enhance"
    if seniority in {"senior", "staff"}:
        return "harden-validation"
    return "add-feature"


def _default_labels(job: JobSpec, context: ExtractedContext) -> list[str]:
    labels = [_domain_label(job, context), job.role_family.value]
    for skill in job.must_have_skills[:2]:
        cleaned = skill.strip().lower().replace(" ", "-")
        if cleaned and cleaned not in labels:
            labels.append(cleaned)
    return labels[:4]


def _looks_generic(ticket_payload: dict, brief_payload: dict) -> bool:
    title = str(ticket_payload.get("title") or "").strip().lower()
    description = str(ticket_payload.get("description") or "").strip().lower()
    labels = {label.strip().lower() for label in ticket_payload.get("labels") or []}
    if not title or any(token in title for token in _PLACEHOLDER_TOKENS):
        return True
    if "realistic ticket titles" in title or "add new endpoint" in title:
        return True
    if len(description) < 120:
        return True
    if labels & _PLACEHOLDER_TOKENS:
        return True
    defects = brief_payload.get("defects") or []
    if not defects:
        return True
    return False


def _local_ticket(job: JobSpec, context: ExtractedContext, golden: Codebase) -> tuple[BugInjectionBrief, CandidateTicket]:
    paths = _preferred_paths(golden)
    primary_path = next((path for path in paths if not path.lower().endswith(".md")), paths[0] if paths else "app/main.py")
    supporting_path = next((path for path in paths if path != primary_path and "test" not in path.lower()), primary_path)
    task_type = _task_type(job)
    defect_total = _defect_count(job)
    labels = _default_labels(job, context)
    role = job.role_family.value if hasattr(job.role_family, "value") else str(job.role_family)
    title_prefix = {
        "add-feature": "Add the missing delivery path",
        "enhance": "Harden the existing workflow",
        "harden-validation": "Close validation gaps in the write flow",
        "add-tests": "Add regression coverage for the main flow",
        "fix-config": "Correct rollout configuration defaults",
        "performance": "Remove the slow path in the core flow",
    }.get(task_type, "Stabilize the main workflow")
    ticket = CandidateTicket(
        title=f"{title_prefix} for {job.title}",
        description=(
            f"The delivery team surfaced a reliability gap in the current {job.title.lower()} implementation during a pre-release check. "
            f"Several requests flowing through the main {role} path are either missing an expected guardrail or behaving inconsistently under normal operator input. "
            "We need the candidate to trace the current implementation, close the gap cleanly across the touched layers, and leave the workflow in a releasable state. "
            "This should feel like a normal sprint task that improves production confidence rather than a toy interview puzzle. "
            "Focus on correctness, clear validation, and preserving the existing module boundaries."
        ),
        acceptance_criteria=[
            "Given a valid request, when the primary flow is exercised, then the system returns a stable success response.",
            "Given invalid or incomplete input, when the same flow is called, then the request is rejected with a clear validation error.",
            "Given the code is updated, when the relevant regression path is re-run, then the change is covered by a targeted automated test.",
            "Given the change is reviewed, when another engineer reads the updated files, then the fix location and intent are understandable from the code structure.",
        ][: max(3, min(6, defect_total + 2))],
        priority="high" if task_type in {"harden-validation", "performance"} else "medium",
        labels=labels,
        reporter="Asha Rao, Engineering Lead",
    )
    defects: list[dict] = [
        {
            "kind": "gap" if task_type in {"add-feature", "add-tests", "enhance"} else "bug",
            "location_hint": f"{primary_path} / primary workflow",
            "behavior_change": "The main request path is missing one of the required validation or state-transition checks, so invalid input can move too far into the workflow before failing.",
            "severity": "high",
            "fix_hint": "Add explicit validation and keep the transport layer thin by enforcing the rule in the domain or service layer.",
        }
    ]
    if defect_total >= 2:
        defects.append(
            {
                "kind": "gap" if task_type == "add-tests" else "bug",
                "location_hint": f"{supporting_path} / supporting workflow",
                "behavior_change": "A related path does not preserve the same behavior guarantees as the main flow, which means the fix can regress without a second change in a neighboring module.",
                "severity": "medium",
                "fix_hint": "Update the adjacent module so the rule is applied consistently and the test surface reflects the same expectation.",
            }
        )
    if defect_total >= 3:
        defects.append(
            {
                "kind": "gap" if task_type == "add-tests" else "misconfig",
                "location_hint": f"{next((path for path in paths if 'settings' in path.lower() or 'config' in path.lower()), primary_path)} / runtime defaults",
                "behavior_change": "The runtime defaults do not make the intended behavior obvious, which increases the chance of environment-specific regressions during rollout.",
                "severity": "medium",
                "fix_hint": "Clarify or correct the default so the new behavior is safe without requiring hidden operational knowledge.",
            }
        )
    if defect_total >= 4:
        defects.append(
            {
                "kind": "ambiguity",
                "location_hint": f"{next((path for path in paths if 'test' in path.lower()), supporting_path)} / regression coverage",
                "behavior_change": "The existing tests do not communicate the intended edge-case behavior clearly enough for another engineer to maintain the flow safely.",
                "severity": "low",
                "fix_hint": "Tighten the assertion or add a specific edge-case test that documents the expected behavior.",
            }
        )
    brief = BugInjectionBrief(defects=defects, notes=f"task_type={task_type}; synthesized local fallback")
    return brief, ticket


async def run(
    job: JobSpec,
    context: ExtractedContext,
    golden: Codebase,
    review_feedback: str = "",
) -> tuple[BugInjectionBrief, CandidateTicket]:
    job_compact = {
        "title": job.title,
        "role_family": job.role_family,
        "seniority": job.seniority,
        "industry": job.industry,
        "must_have_skills": job.must_have_skills,
        "jd_text": job.jd_text[:300],
    }
    sections = [
        "Job spec:\n" + json.dumps(job_compact, indent=2, default=str),
        "Extracted context:\n" + json.dumps(context.model_dump(mode="json"), indent=2, default=str),
        "Golden codebase files (first 800 chars each):\n" + json.dumps(_compact_files(golden), indent=2),
    ]
    if review_feedback.strip():
        sections.append(f"Reviewer feedback to correct on this retry:\n{review_feedback.strip()}")
    sections.append(
        "Produce the JSON described in the system prompt. The response MUST be a "
        'single JSON object with exactly two top-level keys: "bug_brief" and "candidate_ticket".'
    )
    user = "\n\n".join(sections)

    try:
        data = await complete_json(TICKET_AUTHOR, user, temperature=0.6, max_tokens=2200)
    except Exception as exc:
        log.warning("ticket_author: model generation failed, using local fallback: %s", exc)
        return _local_ticket(job, context, golden)

    brief_raw = _find_section(data, *_BRIEF_KEYS)
    ticket_raw = _find_section(data, *_TICKET_KEYS)
    if brief_raw is None or ticket_raw is None:
        log.warning("ticket_author: missing required sections, using local fallback")
        return _local_ticket(job, context, golden)

    brief_payload = normalize_bug_brief_payload(brief_raw)
    ticket_payload = normalize_candidate_ticket_payload(ticket_raw)
    if _looks_generic(ticket_payload, brief_payload):
        log.warning("ticket_author: placeholder-heavy output detected, using local fallback")
        return _local_ticket(job, context, golden)

    log.info(
        "ticket_author: title=%r priority=%s labels=%s defects=%d task_type=%s",
        ticket_payload.get("title", "?")[:60],
        ticket_payload.get("priority"),
        ticket_payload.get("labels"),
        len(brief_payload.get("defects") or []),
        brief_payload.get("task_type") or _infer_task_type(brief_payload.get("defects") or []),
    )
    return BugInjectionBrief(**brief_payload), CandidateTicket(**ticket_payload)


def _infer_task_type(defects: list[dict]) -> str:
    kinds = {defect.get("kind") for defect in defects if isinstance(defect, dict)}
    if "gap" in kinds:
        return "add-feature"
    if "misconfig" in kinds:
        return "fix-config"
    if "ambiguity" in kinds:
        return "resolve-ambiguity"
    if "flake" in kinds:
        return "debug-fix"
    return "debug-fix"
