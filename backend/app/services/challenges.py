"""Helpers for building multi-challenge assessments from a single generated codebase."""
from __future__ import annotations

from math import ceil

from app.models.schemas import (
    BugInjectionBrief,
    CandidateChallenge,
    ChallengeIssue,
    CandidateTicket,
    ChallengeKind,
    JobSpec,
    ObjectiveOption,
    ObjectiveQuestion,
)


def build_candidate_challenges(
    job: JobSpec,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
    generated: list[CandidateChallenge] | None = None,
) -> list[CandidateChallenge]:
    if generated:
        normalized = _normalize_generated(job, brief, ticket, generated)
        if normalized:
            return normalized[: max(job.challenge_count, 1)]

    requested = list(dict.fromkeys(job.challenge_types or []))
    preferred = _preferred_challenge_kinds(job, ticket, requested)
    total_slots = max(job.challenge_count, len(preferred), 1)
    reserved_non_coding = sum(
        1 for kind in preferred if kind in {ChallengeKind.THEORY, ChallengeKind.OBJECTIVE, ChallengeKind.SQL}
    )
    coding_slots = max(1, total_slots - reserved_non_coding) if ChallengeKind.CODING in preferred else 0

    challenges: list[CandidateChallenge] = []
    if ChallengeKind.CODING in preferred:
        challenges.extend(_build_coding_challenges(job, brief, ticket, coding_slots))
    if ChallengeKind.SQL in preferred and len(challenges) < total_slots:
        challenges.append(_build_sql_challenge(job, brief, ticket))
    if ChallengeKind.THEORY in preferred and len(challenges) < total_slots:
        challenges.append(_build_theory_challenge(job, brief, ticket))
    if ChallengeKind.OBJECTIVE in preferred and len(challenges) < total_slots:
        challenges.append(_build_objective_challenge(job, brief, ticket))

    return challenges[:total_slots]


def _build_coding_challenges(
    job: JobSpec,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
    coding_slots: int,
) -> list[CandidateChallenge]:
    defect_count = max(1, len(brief.defects))
    coding_count = min(max(1, coding_slots), defect_count)
    ac_groups = _split_list(ticket.acceptance_criteria, coding_count)
    defect_groups = _split_list(brief.defects, coding_count)
    related_files = [_extract_file_hint(d.get("location_hint", "")) for d in brief.defects]
    related_files = [path for path in related_files if path]

    base_minutes = max(10, int(job.duration_minutes * 0.6 / coding_count))
    challenges: list[CandidateChallenge] = []
    for idx in range(coding_count):
        defects = defect_groups[idx]
        criteria = ac_groups[idx] or ticket.acceptance_criteria
        title = ticket.title if coding_count == 1 else f"{ticket.title} · Part {idx + 1}"
        desc = ticket.description
        if coding_count > 1:
            desc = (
                f"{ticket.description}\n\n"
                "Focus on this slice first and bring it to a stable state before moving on."
            )
        challenge = CandidateChallenge(
            kind=ChallengeKind.CODING,
            title=title,
            description=desc,
            instructions=(
                "Investigate the workspace, implement the fix in code, run the relevant files/tests, "
                "and leave the codebase in a releasable state."
            ),
            acceptance_criteria=criteria,
            issues=[
                ChallengeIssue(
                    title=f"Issue {issue_idx + 1}",
                    description=defect.get("behavior_change", ""),
                    severity=defect.get("severity", "medium"),
                )
                for issue_idx, defect in enumerate(defects[:4])
            ],
            priority=ticket.priority,
            labels=ticket.labels,
            reporter=ticket.reporter,
            assignee=ticket.assignee,
            estimated_minutes=base_minutes,
            related_files=[
                path for path in (_extract_file_hint(d.get("location_hint", "")) for d in defects)
                if path
            ] or related_files[:4],
            workspace_enabled=True,
            allow_buddy=True,
        )
        challenges.append(challenge)
    return challenges


def _build_sql_challenge(
    job: JobSpec,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
) -> CandidateChallenge:
    related_files = [
        _extract_file_hint(defect.get("location_hint", ""))
        for defect in brief.defects[:3]
        if _extract_file_hint(defect.get("location_hint", ""))
    ]
    domain = job.industry or "the product"
    return CandidateChallenge(
        kind=ChallengeKind.SQL,
        title=f"{_skill_label(job, ['sql', 'postgres', 'mysql', 'bigquery'])} investigation",
        description=(
            f"You need to diagnose a data issue related to {domain.lower()} and the work described in "
            f'"{ticket.title}". Produce the query or analysis workflow you would use to isolate the problem and confirm the fix.'
        ),
        instructions=(
            "Write one or more SQL queries that would identify the affected records, "
            "explain the issue, and help validate the repair. Use comments if you need to explain assumptions."
        ),
        acceptance_criteria=[
            "The query targets the right dataset and conditions",
            "The candidate demonstrates safe filtering and joins",
            "The answer would help validate a production fix",
        ],
        issues=[
            ChallengeIssue(
                title="Find impacted rows",
                description="Identify the subset of records affected by the bug pattern.",
                severity="high",
            ),
            ChallengeIssue(
                title="Validate the repair",
                description="Show how you would confirm the corrected behavior with a query.",
                severity="medium",
            ),
        ],
        priority="medium",
        labels=list(dict.fromkeys(ticket.labels + ["sql", job.role_family.value])),
        reporter="Data triage",
        assignee=ticket.assignee,
        estimated_minutes=max(10, min(18, int(job.duration_minutes * 0.2))),
        related_files=related_files,
        workspace_enabled=False,
        allow_buddy=True,
        expected_response_format="Write runnable SQL and short inline comments where needed.",
        editor_language="sql",
        starter_content=(
            "-- Investigate the production issue here\n"
            "-- Show the records, filters, joins, or aggregations you would use.\n"
        ),
    )


def _build_theory_challenge(
    job: JobSpec,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
) -> CandidateChallenge:
    defect_count = max(1, len(brief.defects))
    return CandidateChallenge(
        kind=ChallengeKind.THEORY,
        title=f"Explain the delivery approach for {ticket.title}",
        description=(
            "Write the engineering note you would leave for the team after handling this task. "
            "Focus on the reasoning, tradeoffs, and rollout plan that match this employer's stack and delivery environment."
        ),
        instructions=(
            "Write 2-4 short paragraphs covering: root cause, the checks/tests you used, "
            "what could regress, and how you would monitor or roll back after release."
        ),
        acceptance_criteria=[
            "Names the most likely root cause behind the observed bug(s)",
            "Describes a practical validation or regression-testing plan",
            "Explains rollout safety: monitoring, rollback, or communication steps",
        ],
        issues=[
            ChallengeIssue(
                title="Root cause summary",
                description="Explain the likely technical cause behind the defect set.",
                severity="high",
            ),
            ChallengeIssue(
                title="Release safety",
                description="Describe rollout, monitoring, and rollback expectations.",
                severity="medium",
            ),
        ],
        priority="medium",
        labels=list(dict.fromkeys(ticket.labels + [job.role_family.value, "theory"])),
        reporter="Hiring panel",
        assignee=ticket.assignee,
        estimated_minutes=max(10, min(20, 6 + defect_count * 3)),
        allow_buddy=False,
        expected_response_format="Short engineering note in plain text or markdown.",
    )


def _build_objective_challenge(
    job: JobSpec,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
) -> CandidateChallenge:
    questions = _objective_questions_for_role(job, ticket, brief)
    return CandidateChallenge(
        kind=ChallengeKind.OBJECTIVE,
        title=f"Role checkpoint: {job.title}",
        description=(
            "Complete this short objective checkpoint before final submission. It checks whether "
            "you can reason through the kind of issues this team is likely to face based on the hiring brief."
        ),
        instructions="Choose the best answer for each question. Some questions may allow multiple answers.",
        acceptance_criteria=[
            "Makes sound debugging and rollout decisions",
            "Shows secure and production-aware engineering judgment",
        ],
        issues=[
            ChallengeIssue(
                title="Debugging judgment",
                description="Choose the most defensible technical response.",
                severity="medium",
            ),
            ChallengeIssue(
                title="Production safety",
                description="Demonstrate secure and regression-aware decision making.",
                severity="medium",
            ),
        ],
        priority="medium",
        labels=list(dict.fromkeys(ticket.labels + [job.role_family.value, "objective"])),
        reporter="Assessment system",
        assignee=ticket.assignee,
        estimated_minutes=max(8, min(15, len(questions) * 3)),
        allow_buddy=False,
        objective_questions=questions,
    )


def _normalize_generated(
    job: JobSpec,
    brief: BugInjectionBrief,
    ticket: CandidateTicket,
    generated: list[CandidateChallenge],
) -> list[CandidateChallenge]:
    out: list[CandidateChallenge] = []
    for challenge in generated:
        issues = challenge.issues or [
            ChallengeIssue(
                title="Primary issue",
                description=challenge.description or challenge.instructions or "Investigate and resolve the problem.",
                severity="medium",
            )
        ]
        allow_buddy = challenge.allow_buddy
        if challenge.kind in {ChallengeKind.THEORY, ChallengeKind.OBJECTIVE}:
            allow_buddy = False
        normalized = challenge.model_copy(
            update={
                "issues": issues[:4],
                "allow_buddy": allow_buddy,
                "workspace_enabled": challenge.workspace_enabled or challenge.kind == ChallengeKind.CODING,
                "editor_language": challenge.editor_language or ("sql" if challenge.kind == ChallengeKind.SQL else ""),
                "starter_content": challenge.starter_content or (
                    "-- Write your SQL here\n" if challenge.kind == ChallengeKind.SQL else ""
                ),
                "labels": challenge.labels or ticket.labels,
                "reporter": challenge.reporter or ticket.reporter,
                "assignee": challenge.assignee or ticket.assignee,
            }
        )
        out.append(normalized)
    return out


def _objective_questions_for_role(
    job: JobSpec,
    ticket: CandidateTicket,
    brief: BugInjectionBrief,
) -> list[ObjectiveQuestion]:
    primary_skill = _skill_label(job, [])
    leading_label = ticket.labels[0] if ticket.labels else job.role_family.value
    severe_defect = next((d for d in brief.defects if d.get("severity") == "high"), None)
    defect_theme = (severe_defect or {}).get("kind", "bug")
    role = job.role_family.value
    if role in {"backend", "fullstack", "data"}:
        return [
            ObjectiveQuestion(
                prompt=f"In a {primary_skill} service working on {leading_label}, what should you check first when a defect appears only on boundary inputs?",
                options=[
                    ObjectiveOption(id="a", text="Boundary conditions and off-by-one logic around the failing branch"),
                    ObjectiveOption(id="b", text="Rename the function to make the intent clearer"),
                    ObjectiveOption(id="c", text="Increase the request timeout globally"),
                    ObjectiveOption(id="d", text="Reorder imports in the file"),
                ],
                correct_option_ids=["a"],
                explanation="Boundary-only failures usually point to missing guards or comparison mistakes.",
            ),
            ObjectiveQuestion(
                prompt=f"Which fix is the safest default when implementing a {ticket.title.lower()} change that touches user input and persistence?",
                options=[
                    ObjectiveOption(id="a", text="Use string interpolation so logs are easier to read"),
                    ObjectiveOption(id="b", text="Use parameterized queries or ORM-bound parameters"),
                    ObjectiveOption(id="c", text="Strip spaces from the input and retry"),
                    ObjectiveOption(id="d", text="Catch Exception and ignore the failure"),
                ],
                correct_option_ids=["b"],
                explanation="Parameterized queries are the safe default for untrusted input.",
            ),
            ObjectiveQuestion(
                prompt=f"Before releasing a {defect_theme} fix for {ticket.title.lower()}, which follow-up gives the strongest confidence?",
                options=[
                    ObjectiveOption(id="a", text="Add a regression test for the failing scenario and monitor the impacted flow after deploy"),
                    ObjectiveOption(id="b", text="Merge quickly and ask support to watch Slack"),
                    ObjectiveOption(id="c", text="Refactor adjacent files so the patch looks cleaner"),
                    ObjectiveOption(id="d", text="Reduce log levels to avoid noisy alerts"),
                ],
                correct_option_ids=["a"],
                explanation="A regression test plus targeted monitoring gives both pre- and post-deploy confidence.",
            ),
        ]

    if role in {"frontend", "design"}:
        return [
            ObjectiveQuestion(
                prompt=f"A UI issue in {leading_label} only happens after a user changes tabs and returns. What is the best first hypothesis?",
                options=[
                    ObjectiveOption(id="a", text="State is being derived from a stale value or lifecycle timing"),
                    ObjectiveOption(id="b", text="The CSS file should be deleted"),
                    ObjectiveOption(id="c", text="Images are too large"),
                    ObjectiveOption(id="d", text="The bundle should always be minified harder"),
                ],
                correct_option_ids=["a"],
            ),
            ObjectiveQuestion(
                prompt=f"What is the safest default when shipping a {primary_skill} UI change that renders user-provided content?",
                options=[
                    ObjectiveOption(id="a", text="Render it as raw HTML for flexibility"),
                    ObjectiveOption(id="b", text="Escape or sanitize it before rendering"),
                    ObjectiveOption(id="c", text="Store it in localStorage first"),
                    ObjectiveOption(id="d", text="Only render it on mobile"),
                ],
                correct_option_ids=["b"],
            ),
            ObjectiveQuestion(
                prompt=f"What is the best way to prevent this {defect_theme} from coming back?",
                options=[
                    ObjectiveOption(id="a", text="Add a focused regression test around the user flow"),
                    ObjectiveOption(id="b", text="Rewrite the page in another framework"),
                    ObjectiveOption(id="c", text="Hide the failing state behind a feature flag forever"),
                    ObjectiveOption(id="d", text="Rename the component"),
                ],
                correct_option_ids=["a"],
            ),
        ]

    return [
        ObjectiveQuestion(
            prompt=f"What is the strongest signal that an engineer actually understands the work behind {ticket.title}?",
            options=[
                ObjectiveOption(id="a", text="They can explain the root cause, validation plan, and rollout risk"),
                ObjectiveOption(id="b", text="They change the most files"),
                ObjectiveOption(id="c", text="They never ask clarifying questions"),
                ObjectiveOption(id="d", text="They only rely on intuition"),
            ],
            correct_option_ids=["a"],
        ),
        ObjectiveQuestion(
            prompt=f"What should happen after a {defect_theme} or delivery gap is addressed?",
            options=[
                ObjectiveOption(id="a", text="A regression check or measurable validation should be added"),
                ObjectiveOption(id="b", text="The issue should be deleted without notes"),
                ObjectiveOption(id="c", text="The team should avoid monitoring it"),
                ObjectiveOption(id="d", text="The code should stay untested to move faster"),
            ],
            correct_option_ids=["a"],
        ),
    ]


def _split_list(values: list, groups: int) -> list[list]:
    if groups <= 0:
        return []
    if not values:
        return [[] for _ in range(groups)]
    chunk = ceil(len(values) / groups)
    out = [values[i:i + chunk] for i in range(0, len(values), chunk)]
    while len(out) < groups:
        out.append([])
    return out[:groups]


def _preferred_challenge_kinds(
    job: JobSpec,
    ticket: CandidateTicket,
    requested: list[ChallengeKind],
) -> list[ChallengeKind]:
    preferred: list[ChallengeKind] = []
    lower_skills = {skill.strip().lower() for skill in job.must_have_skills + job.nice_to_have_skills}
    combined_text = " ".join(
        [
            job.title,
            job.jd_text,
            ticket.title,
            ticket.description,
            " ".join(ticket.labels),
        ]
    ).lower()

    hands_on_roles = {"backend", "frontend", "fullstack", "qa", "devops", "data"}
    if job.role_family.value in hands_on_roles:
        preferred.append(ChallengeKind.CODING)
    else:
        preferred.append(ChallengeKind.THEORY)

    if any(skill in lower_skills for skill in {"sql", "postgres", "mysql", "snowflake", "bigquery", "redshift"}):
        preferred.append(ChallengeKind.SQL)
    if any(term in combined_text for term in {"query", "analytics", "warehouse", "dataset", "reporting"}):
        preferred.append(ChallengeKind.SQL)

    if job.role_family.value in {"pm", "design"} or job.seniority in {"senior", "staff"} or any(
        term in combined_text for term in {"architecture", "rollout", "incident", "migration", "reliability"}
    ):
        preferred.append(ChallengeKind.THEORY)

    if job.seniority == "junior" or job.role_family.value in {"qa"} or (
        job.seniority == "mid" and job.challenge_count >= 3
    ):
        preferred.append(ChallengeKind.OBJECTIVE)

    for kind in requested:
        if kind not in preferred:
            preferred.append(kind)
    return list(dict.fromkeys(preferred))


def _skill_label(job: JobSpec, fallbacks: list[str]) -> str:
    for skill in job.must_have_skills + job.nice_to_have_skills:
        cleaned = skill.strip()
        if cleaned:
            return cleaned
    for fallback in fallbacks:
        if fallback:
            return fallback.upper() if len(fallback) <= 4 else fallback.title()
    return job.role_family.value.replace("_", " ").title()


def _extract_file_hint(location_hint: str) -> str:
    if not location_hint:
        return ""
    return location_hint.split("/ function", 1)[0].split("/ class", 1)[0].strip()
