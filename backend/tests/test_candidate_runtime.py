from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api.routes import candidate
from app.models.schemas import CandidateSession


class CandidateRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_prepare_workspace_uses_live_sandbox_files(self) -> None:
        session = CandidateSession(
            assessment_id="AST_test",
            current_files={"app.py": "print('old')\n"},
        )

        with patch.object(candidate.sandbox, "read_files", AsyncMock(return_value={"app.py": "print('new')\n"})), patch.object(
            candidate.store,
            "put_session",
            AsyncMock(),
        ) as put_session:
            updated = await candidate._prepare_workspace_for_execution(session)

        self.assertEqual(updated.current_files["app.py"], "print('new')\n")
        put_session.assert_awaited_once()

    async def test_prepare_workspace_provisions_missing_sandbox(self) -> None:
        session = CandidateSession(
            assessment_id="AST_test",
            current_files={"app.py": "print('hello')\n"},
        )

        with patch.object(
            candidate.sandbox,
            "read_files",
            AsyncMock(side_effect=[{}, {"app.py": "print('hello')\n"}]),
        ), patch.object(
            candidate.sandbox,
            "provision",
            AsyncMock(),
        ) as provision, patch.object(
            candidate.store,
            "put_session",
            AsyncMock(),
        ) as put_session:
            updated = await candidate._prepare_workspace_for_execution(session)

        provision.assert_awaited_once_with(session.id, {"app.py": "print('hello')\n"})
        put_session.assert_not_awaited()
        self.assertEqual(updated.current_files["app.py"], "print('hello')\n")

    async def test_prepare_workspace_returns_503_when_sandbox_is_down(self) -> None:
        session = CandidateSession(
            assessment_id="AST_test",
            current_files={"app.py": "print('hello')\n"},
        )

        with patch.object(
            candidate.sandbox,
            "read_files",
            AsyncMock(side_effect=RuntimeError("sandbox unavailable")),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await candidate._prepare_workspace_for_execution(session)

        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn("sandbox unavailable", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
