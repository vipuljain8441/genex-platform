from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import buddy
from app.models.schemas import BuddyRequest, CandidateChallenge, ChallengeKind


class BuddyTests(unittest.TestCase):
    def test_out_of_scope_redirect_is_warm_and_not_blocked(self) -> None:
        challenge = CandidateChallenge(
            kind=ChallengeKind.CODING,
            title="Fix login flow",
            description="Investigate the login bug.",
        )
        req = BuddyRequest(
            session_id="SES_test",
            question="tell me a joke",
            workspace={},
        )

        result = asyncio.run(buddy.run(req, active_challenge=challenge))

        self.assertFalse(result.blocked)
        self.assertIn("ticket", result.hint.lower())
        self.assertFalse(result.edits)

    def test_natural_reply_without_template_is_accepted(self) -> None:
        req = BuddyRequest(
            session_id="SES_test",
            question="I think the auth flow is broken in login.py",
            open_file="login.py",
            workspace={"login.py": "def login():\n    pass\n"},
        )

        with patch.object(
            buddy,
            "complete_json",
            AsyncMock(
                return_value={
                    "hint": (
                        "Yeah, I'd start in login.py. The first thing I'd check is whether "
                        "the function is returning early before it validates the incoming payload. "
                        "Next move: trace the first conditional and see what happens when the token is missing."
                    ),
                    "hint_level": "nudge",
                    "blocked": False,
                    "edits": [],
                }
            ),
        ):
            result = asyncio.run(buddy.run(req))

        self.assertFalse(result.blocked)
        self.assertIn("login.py", result.hint)
        self.assertEqual(result.hint_level, "nudge")


if __name__ == "__main__":
    unittest.main()
