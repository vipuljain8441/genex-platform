from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import report_analyst
from app.models.schemas import EvaluationResult, SignalScore
from app.services.report import build_report_preview


def make_report() -> dict:
    return {
        "available": True,
        "header": {
            "candidate_name": "Casey Doe",
            "assessment_title": "Platform Debug Assessment",
            "role_title": "Backend Engineer",
            "tech_stack": ["Python", "FastAPI"],
            "seniority": "mid",
            "duration_used_min": 52,
            "duration_allotted_min": 60,
            "started_at": "2026-05-18T00:00:00Z",
            "submitted_at": "2026-05-18T00:52:00Z",
            "finished_early": False,
        },
        "cq": {
            "score": 74,
            "summary": "Solid debugging session.",
            "breakdown": {"total": 74, "components": []},
        },
        "metrics": [
            {"key": "correctness", "label": "Correctness", "score": 7, "max": 10},
            {"key": "quality", "label": "Code quality", "score": 6, "max": 10},
            {"key": "verification", "label": "Verification", "score": 8, "max": 10},
            {"key": "communication", "label": "Communication", "score": 5, "max": 10},
        ],
        "bug_exposure": {
            "rows": [],
            "fixed_count": 2,
            "missed_count": 1,
            "total": 3,
        },
        "ai": {
            "prompts": [],
            "prompt_count": 3,
            "proposed": 1,
            "accepted": 1,
            "rejected": 0,
            "blind_paste_rate": 0.1,
            "edits_after_accept": 1,
            "trap": {"configured": False, "bad_suggestion": "", "trigger": "", "outcome": "not_triggered"},
            "model_used": "buddy",
        },
        "behaviour": {
            "timeline": [],
            "files_before_first_edit": 2,
            "time_to_first_edit_min": 6,
            "total_files_opened": 7,
            "investigation_note": "Moved deliberately through the codebase.",
            "heatmap_mix": {"editor": 60, "ai": 20, "terminal": 20},
            "verification": {"ran_tests": True, "verified_ai_patches": True, "small_commits": False},
        },
        "behaviour_analytics": {
            "per_ticket": [],
            "idle": {},
            "keystrokes": {},
            "content_attribution": {},
            "focus": {},
            "phases": {},
        },
        "integrity": {"score": 92, "flags": [], "disclaimer": "Passive signals only."},
        "strategy": [],
        "code_review": None,
        "activity_forensics": {"total_events": 0, "tracked_files": 0, "file_summaries": [], "recent_entries": []},
        "buddy_audit": {
            "total_messages": 2,
            "blocked_messages": 0,
            "proposed_edits": 1,
            "applied_edits": 1,
            "dismissed_edits": 0,
            "transcript": [],
            "actions": [],
        },
        "feedback_log": [],
        "playback_url": "/playback/SES_123",
        "heatmap": {
            "buckets": 1,
            "bucket_seconds": 60,
            "files": [],
            "cells": [],
            "started_at": "2026-05-18T00:00:00Z",
            "ended_at": "2026-05-18T00:52:00Z",
            "totals_by_kind": {"terminal_command": 4},
        },
    }


class ReportAnalysisTests(unittest.TestCase):
    def test_build_report_preview_summarizes_snapshot(self) -> None:
        preview = build_report_preview(make_report())
        self.assertEqual(preview["snapshot"]["fixed_bugs"], 2)
        self.assertEqual(preview["snapshot"]["terminal_commands"], 4)
        self.assertTrue(preview["unlock_label"])
        self.assertGreaterEqual(len(preview["snapshot"]["highlights"]), 2)

    def test_report_analyst_falls_back_when_payload_is_invalid(self) -> None:
        evaluation = EvaluationResult(
            session_id="SES_123",
            overall_score=0.72,
            signals=[SignalScore(name="correctness", score=0.7, notes=""), SignalScore(name="code_quality", score=0.72, notes=""), SignalScore(name="exploration", score=0.75, notes=""), SignalScore(name="buddy_independence", score=0.68, notes=""), SignalScore(name="perseverance", score=0.77, notes="")],
            narrative="Strong troubleshooting.",
            strengths=["Good verification"],
            gaps=["Could explain tradeoffs more clearly"],
            completed_acceptance=["Fixed the validation bug"],
            missed_acceptance=["Did not add a regression test"],
        )

        with patch.object(report_analyst, "complete_json", AsyncMock(return_value={})):
            analysis = asyncio.run(report_analyst.run("SES_123", make_report(), evaluation))

        self.assertEqual(analysis.session_id, "SES_123")
        self.assertTrue(analysis.summary)
        self.assertGreater(len(analysis.highlights), 0)
        self.assertGreater(len(analysis.risks), 0)


if __name__ == "__main__":
    unittest.main()
