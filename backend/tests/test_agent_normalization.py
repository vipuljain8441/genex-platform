from __future__ import annotations

import unittest

from app.agents.normalization import (
    normalize_bug_brief_payload,
    normalize_candidate_challenge_payload,
    normalize_candidate_ticket_payload,
)


class AgentNormalizationTests(unittest.TestCase):
    def test_ticket_priority_schema_hint_is_normalized(self) -> None:
        payload = normalize_candidate_ticket_payload(
            {
                "title": "Fix issue",
                "description": "Detailed enough",
                "acceptance_criteria": "One|Two|Three",
                "priority": "low|medium|high|critical",
                "labels": "api,backend",
            }
        )
        self.assertEqual(payload["priority"], "low")
        self.assertEqual(payload["acceptance_criteria"], ["One", "Two", "Three"])
        self.assertEqual(payload["labels"], ["api", "backend"])

    def test_bug_brief_literals_are_normalized(self) -> None:
        payload = normalize_bug_brief_payload(
            {
                "defects": [
                    {
                        "kind": "bug|flake|misconfig|ambiguity|gap",
                        "severity": "low|medium|high",
                        "location_hint": "app.py / function create",
                        "behavior_change": "breaks on empty input",
                    }
                ]
            }
        )
        self.assertEqual(payload["defects"][0]["kind"], "bug")
        self.assertEqual(payload["defects"][0]["severity"], "low")

    def test_challenge_kind_and_priority_are_normalized(self) -> None:
        payload = normalize_candidate_challenge_payload(
            {
                "kind": "coding|sql|theory|objective",
                "title": "Challenge",
                "priority": "medium|high|critical",
                "issues": [{"title": "Issue", "severity": "low|medium|high"}],
            }
        )
        self.assertEqual(payload["kind"], "coding")
        self.assertEqual(payload["priority"], "medium")
        self.assertEqual(payload["issues"][0]["severity"], "low")


if __name__ == "__main__":
    unittest.main()
