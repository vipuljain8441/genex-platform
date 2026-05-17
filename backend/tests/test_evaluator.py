from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import evaluator
from app.models.schemas import (
    ActivityEvent,
    ArtifactKind,
    BuddyTurn,
    CandidateChallenge,
    CandidateSession,
    CandidateTicket,
    ChallengeIssue,
    ChallengeKind,
    ChallengeResponse,
    CodeFile,
    Codebase,
    EventKind,
    JobSpec,
    RecruiterContext,
    RoleFamily,
)


class EvaluatorTests(unittest.TestCase):
    def test_run_survives_missing_overall_score(self) -> None:
        job = JobSpec(
            title="Backend Engineer",
            role_family=RoleFamily.BACKEND,
            seniority="mid",
            must_have_skills=["Python", "FastAPI"],
            jd_text="Build backend APIs and improve service reliability.",
            recruiter_context=RecruiterContext(domain_summary="B2B workflow platform"),
        )
        ticket = CandidateTicket(
            title="Add audit endpoint",
            description="Implement and validate a new audit log endpoint.",
            acceptance_criteria=[
                "Endpoint returns paginated audit records.",
                "Validation errors are handled cleanly.",
            ],
            priority="high",
            labels=["backend", "api"],
        )
        challenge = CandidateChallenge(
            kind=ChallengeKind.CODING,
            title="Implement audit listing",
            acceptance_criteria=["Return valid audit results."],
            issues=[
                ChallengeIssue(
                    title="Missing API implementation",
                    description="Create the endpoint and wire the handler.",
                    severity="high",
                )
            ],
        )
        golden = Codebase(
            artifact_kind=ArtifactKind.CODE,
            entry_point="app/main.py",
            files=[
                CodeFile(
                    path="app/main.py",
                    language="python",
                    content="from fastapi import FastAPI\napp = FastAPI()\n",
                )
            ],
        )
        session = CandidateSession(
            assessment_id="AST_test",
            current_files={"app/main.py": "from fastapi import FastAPI\napp = FastAPI()\n"},
            challenge_responses={
                challenge.id: ChallengeResponse(
                    challenge_id=challenge.id,
                    challenge_kind=ChallengeKind.CODING,
                    status="completed",
                    answer_text="Implemented endpoint",
                )
            },
        )
        events = [
            ActivityEvent(session_id=session.id, kind=EventKind.EDIT, file_path="app/main.py"),
            ActivityEvent(session_id=session.id, kind=EventKind.RUN, file_path="app/main.py"),
        ]
        buddy_history = [BuddyTurn(role="user", content="How should I structure the handler?")]

        incomplete_payload = {
            "signals": [
                {"name": "correctness", "score": 0.82, "notes": "Mostly correct implementation."}
            ],
            "narrative": "The candidate completed the main coding task.",
            "strengths": [""],
            "gaps": [],
        }

        with patch.object(evaluator, "complete_json", AsyncMock(return_value=incomplete_payload)):
            result = asyncio.run(
                evaluator.run(
                    job=job,
                    ticket=ticket,
                    challenges=[challenge],
                    golden=golden,
                    session=session,
                    events=events,
                    buddy_history=buddy_history,
                )
            )

        self.assertGreaterEqual(result.overall_score, 0.0)
        self.assertLessEqual(result.overall_score, 1.0)
        self.assertEqual(len(result.signals), 5)
        self.assertEqual(result.signals[0].name, "correctness")
        self.assertTrue(result.strengths)
        self.assertTrue(result.gaps)
        self.assertEqual(result.missed_acceptance, ticket.acceptance_criteria)


if __name__ == "__main__":
    unittest.main()
