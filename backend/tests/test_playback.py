from __future__ import annotations

from datetime import datetime, timezone
import unittest

from app.models.schemas import (
    ActivityEvent,
    Assessment,
    BuddyTurn,
    CandidateSession,
    CandidateTicket,
    EventKind,
    JobSpec,
    RoleFamily,
)
from app.services.playback import build_playback


class PlaybackTests(unittest.TestCase):
    def test_build_playback_returns_timeline_and_files(self) -> None:
        assessment = Assessment(
            job=JobSpec(
                title="Backend Engineer",
                role_family=RoleFamily.BACKEND,
                seniority="mid",
                industry="SaaS",
                must_have_skills=["Python", "FastAPI"],
                nice_to_have_skills=[],
                jd_text="Build APIs.",
                duration_minutes=60,
                pm_tool="none",
            ),
            candidate_ticket=CandidateTicket(
                title="Fix request validation",
                description="Validation is too permissive.",
                acceptance_criteria=["Reject invalid payloads"],
                priority="high",
                labels=["bug"],
                reporter="Priya Menon",
                assignee="you",
            ),
        )
        session = CandidateSession(
            assessment_id=assessment.id,
            candidate_name="Casey",
            current_files={
                "app/main.py": "print('hello')\nvalue = 1\n",
                "README.md": "# Demo\n",
            },
            started_at=datetime(2026, 5, 18, 10, 0, 0, tzinfo=timezone.utc),
            submitted_at=datetime(2026, 5, 18, 10, 15, 0, tzinfo=timezone.utc),
        )
        events = [
            ActivityEvent(
                session_id=session.id,
                kind=EventKind.FILE_OPEN,
                file_path="app/main.py",
                at=datetime(2026, 5, 18, 10, 0, 5, tzinfo=timezone.utc),
            ),
            ActivityEvent(
                session_id=session.id,
                kind=EventKind.TERMINAL_COMMAND,
                file_path="app/main.py",
                at=datetime(2026, 5, 18, 10, 2, 0, tzinfo=timezone.utc),
                payload={"command": "pytest -q"},
            ),
            ActivityEvent(
                session_id=session.id,
                kind=EventKind.CODE_SYNC,
                file_path="app/main.py",
                at=datetime(2026, 5, 18, 10, 3, 0, tzinfo=timezone.utc),
                payload={"changed_ranges": [{"start_line": 2, "end_line": 2, "change_type": "replace"}]},
            ),
        ]
        buddy_history = [
            BuddyTurn(
                role="user",
                content="Why is validation failing?",
                at=datetime(2026, 5, 18, 10, 1, 0, tzinfo=timezone.utc),
                open_file="app/main.py",
            ),
            BuddyTurn(
                role="buddy",
                content="Check the input guard first.",
                at=datetime(2026, 5, 18, 10, 1, 10, tzinfo=timezone.utc),
                open_file="app/main.py",
            ),
        ]

        playback = build_playback(session, assessment, events, buddy_history)

        self.assertEqual(playback["candidate_name"], "Casey")
        self.assertEqual(len(playback["steps"]), 3)
        self.assertEqual(playback["steps"][1]["command"], "pytest -q")
        self.assertEqual(playback["files"][0]["path"], "README.md")
        self.assertEqual(playback["stats"]["terminal_commands"], 1)
        self.assertEqual(len(playback["buddy_transcript"]), 2)


if __name__ == "__main__":
    unittest.main()
