from __future__ import annotations

import asyncio
import unittest
from datetime import timedelta

from app.models.schemas import (
    ActivityEvent,
    Assessment,
    CandidateFeedback,
    CandidateSession,
    EventKind,
    FeedbackCategory,
    JobSpec,
    RoleFamily,
)
from app.services.heatmap import build_heatmap
from app.services.report import build_report
from app.store.memory import MemoryStore


class FeedbackReportingTests(unittest.TestCase):
    def test_memory_store_feedback_round_trip(self) -> None:
        async def scenario() -> None:
            store = MemoryStore()
            feedback = CandidateFeedback(
                assessment_id="AST_demo",
                session_id="SES_demo",
                candidate_name="Avery",
                category=FeedbackCategory.WORKSPACE,
                message="Terminal output lagged after I opened the editor.",
            )
            await store.append_feedback(feedback)

            by_session = await store.list_feedback_for_session("SES_demo")
            by_assessment = await store.list_feedback_for_assessment("AST_demo")

            self.assertEqual(len(by_session), 1)
            self.assertEqual(len(by_assessment), 1)
            self.assertEqual(by_session[0].message, feedback.message)
            self.assertEqual(by_assessment[0].category, FeedbackCategory.WORKSPACE)

        asyncio.run(scenario())

    def test_report_includes_feedback_log(self) -> None:
        assessment = Assessment(
            job=JobSpec(
                title="Backend Engineer",
                role_family=RoleFamily.BACKEND,
                jd_text="Build and maintain APIs with Python and PostgreSQL.",
            ),
        )
        session = CandidateSession(
            assessment_id=assessment.id,
            candidate_name="Avery",
        )
        events = [
            ActivityEvent(
                session_id=session.id,
                kind=EventKind.FILE_OPEN,
                file_path="app/main.py",
            ),
        ]
        feedback_old = CandidateFeedback(
            assessment_id=assessment.id,
            session_id=session.id,
            candidate_name="Avery",
            category=FeedbackCategory.GENERAL,
            message="Instructions were a bit ambiguous near the end.",
        )
        feedback_new = CandidateFeedback(
            assessment_id=assessment.id,
            session_id=session.id,
            candidate_name="Avery",
            category=FeedbackCategory.WORKSPACE,
            message="The terminal froze once after a run.",
            created_at=feedback_old.created_at + timedelta(minutes=5),
        )

        report = build_report(
            session=session,
            assessment=assessment,
            events=events,
            buddy_history=[],
            feedback=[feedback_old, feedback_new],
            evaluation=None,
            heatmap=build_heatmap(events),
        )

        self.assertEqual(len(report["feedback_log"]), 2)
        self.assertEqual(report["feedback_log"][0]["message"], feedback_new.message)
        self.assertEqual(report["feedback_log"][1]["message"], feedback_old.message)


if __name__ == "__main__":
    unittest.main()
