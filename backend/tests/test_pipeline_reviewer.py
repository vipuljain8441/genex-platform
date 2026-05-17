from __future__ import annotations

import unittest

from app.agents.pipeline_reviewer import (
    local_assessment_plan_review,
    local_codebase_review,
)
from app.models.schemas import (
    ArtifactKind,
    BugInjectionBrief,
    CandidateChallenge,
    CandidateTicket,
    ChallengeIssue,
    ChallengeKind,
    Codebase,
    CodeFile,
    ExtractedContext,
    JobSpec,
    RoleFamily,
)


def make_job() -> JobSpec:
    return JobSpec(
        title="Senior Healthcare Platform Engineer",
        role_family=RoleFamily.BACKEND,
        seniority="senior",
        industry="Healthtech",
        must_have_skills=["Python", "FastAPI", "PostgreSQL"],
        nice_to_have_skills=["Redis"],
        jd_text=(
            "Build APIs for patient scheduling and clinical workflow automation. "
            "Own incident response, validation, and production reliability for healthcare operations."
        ),
        duration_minutes=75,
        pm_tool="none",
    )


def make_context() -> ExtractedContext:
    return ExtractedContext(
        sample_tickets=[
            {"title": "Stabilize patient scheduling retries", "key": "HLTH-12", "type": "bug", "summary": ""}
        ],
        tech_signals=["python", "fastapi", "postgres", "redis"],
        domain_summary="The team owns patient scheduling, care coordination, and clinical workflow automation.",
    )


class PipelineReviewerTests(unittest.TestCase):
    def test_rejects_generic_ecommerce_codebase(self) -> None:
        review = local_codebase_review(
            make_job(),
            make_context(),
            Codebase(
                artifact_kind=ArtifactKind.CODE,
                entry_point="app.py",
                setup_instructions="Run python app.py",
                files=[
                    CodeFile(
                        path="orders/service.py",
                        language="python",
                        content="def create_order(cart, payment): return {'ok': True}",
                    ),
                    CodeFile(path="orders/models.py", language="python", content="class Order: pass"),
                    CodeFile(path="orders/api.py", language="python", content="from fastapi import APIRouter"),
                    CodeFile(path="README.md", language="markdown", content="checkout service"),
                ],
            ),
        )
        self.assertFalse(review["approved"])
        self.assertTrue(any("generic e-commerce" in reason.lower() for reason in review["reasons"]))

    def test_rejects_thin_generic_assessment_plan(self) -> None:
        job = make_job()
        context = make_context()
        golden = Codebase(
            artifact_kind=ArtifactKind.CODE,
            entry_point="app/main.py",
            setup_instructions="pip install -r requirements.txt && uvicorn app.main:app --reload",
            files=[
                CodeFile(path="app/main.py", language="python", content="from fastapi import FastAPI\napp = FastAPI()"),
                CodeFile(path="app/routes.py", language="python", content=""),
                CodeFile(path="app/models.py", language="python", content=""),
                CodeFile(path="README.md", language="markdown", content="healthcare scheduling service"),
            ],
        )
        brief = BugInjectionBrief(
            defects=[
                {
                    "kind": "bug",
                    "location_hint": "app/routes.py / function create_order",
                    "behavior_change": "creates duplicate orders",
                    "severity": "high",
                    "fix_hint": "dedupe",
                }
            ]
        )
        ticket = CandidateTicket(
            title="Fix order issue",
            description="Fix it fast.",
            acceptance_criteria=["Works"],
            labels=["bug"],
            reporter="PM",
        )
        challenges = [
            CandidateChallenge(
                kind=ChallengeKind.SQL,
                title="SQL query challenge",
                description="query data",
                issues=[ChallengeIssue(title="Only one", description="one", severity="medium")],
                allow_buddy=True,
            )
        ]
        review = local_assessment_plan_review(job, context, golden, brief, ticket, challenges)
        self.assertFalse(review["approved"])
        joined = "\n".join(review["reasons"]).lower()
        self.assertIn("too short", joined)
        self.assertIn("at least one implementation-oriented coding challenge", joined)
        self.assertIn("at least 2 concrete sub-issues", joined)


if __name__ == "__main__":
    unittest.main()
