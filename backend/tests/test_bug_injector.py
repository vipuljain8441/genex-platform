from __future__ import annotations

import unittest

from app.agents import bug_injector
from app.models.schemas import ArtifactKind, BugInjectionBrief, CodeFile, Codebase


class BugInjectorTests(unittest.TestCase):
    def test_pick_target_files_prefers_location_hint_matches(self) -> None:
        golden = Codebase(
            artifact_kind=ArtifactKind.CODE,
            entry_point="main.py",
            files=[
                CodeFile(path="main.py", language="python", content="print('main')\n"),
                CodeFile(path="services/auth.py", language="python", content="def login():\n    return True\n"),
                CodeFile(path="routes/users.py", language="python", content="def users():\n    return []\n"),
            ],
            setup_instructions="python main.py",
        )
        brief = BugInjectionBrief(
            defects=[
                {
                    "kind": "bug",
                    "location_hint": "services/auth.py / function login",
                    "behavior_change": "Invert the auth guard.",
                    "severity": "high",
                }
            ],
            notes="",
        )

        targets = bug_injector._pick_target_files(golden, brief)

        self.assertEqual([file.path for file in targets], ["services/auth.py"])


if __name__ == "__main__":
    unittest.main()
