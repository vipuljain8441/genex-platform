"""Employer-facing report analyst — interprets the structured report with an LLM."""
from __future__ import annotations

import json
import logging

from app.core.llm import complete_json
from app.models.schemas import EvaluationResult, ReportAnalysis, ReportEvidence
from app.prompts.library import REPORT_ANALYST
from app.services.report import ReportData

log = logging.getLogger(__name__)


def _compact_report(report: ReportData, evaluation: EvaluationResult | None) -> dict:
    return {
        "available": report["available"],
        "header": report["header"],
        "cq": report["cq"],
        "metrics": report["metrics"],
        "bug_exposure": report["bug_exposure"],
        "ai": {
            "prompt_count": report["ai"]["prompt_count"],
            "proposed": report["ai"]["proposed"],
            "accepted": report["ai"]["accepted"],
            "rejected": report["ai"]["rejected"],
            "blind_paste_rate": report["ai"]["blind_paste_rate"],
            "edits_after_accept": report["ai"]["edits_after_accept"],
        },
        "behaviour": report["behaviour"],
        "integrity": {
            "score": report["integrity"]["score"],
            "flags": report["integrity"]["flags"][:4],
        },
        "code_review": report["code_review"],
        "feedback_log": report["feedback_log"][:6],
        "evaluation": evaluation.model_dump(mode="json") if evaluation else None,
    }


def _normalize_text_list(value: object, minimum: list[str]) -> list[str]:
    if not isinstance(value, list):
        return minimum
    normalized = [str(item).strip() for item in value if str(item).strip()]
    return normalized or minimum


def _fallback_analysis(session_id: str, report: ReportData, evaluation: EvaluationResult | None) -> ReportAnalysis:
    cq_score = report["cq"]["score"] if report["cq"] else None
    fixed = report["bug_exposure"]["fixed_count"]
    total = report["bug_exposure"]["total"]
    recommendation = "mixed"
    if cq_score is not None and cq_score >= 78:
        recommendation = "lean_yes"
    elif cq_score is not None and cq_score < 50:
        recommendation = "lean_no"
    summary = (
        f"This session shows {fixed} of {total} tracked issues fixed"
        + (f", with a CQ score of {cq_score}." if cq_score is not None else ".")
        + " The AI analysis fallback is being used because the model response was incomplete, so the employer should review the unlocked report directly before making a decision."
    )
    highlights = [
        f"Fixed bug count: {fixed} of {total}.",
        f"Buddy usage count: {report['ai']['prompt_count']}.",
        f"Files opened during investigation: {report['behaviour']['total_files_opened']}.",
    ]
    risks = [
        "AI analysis payload was incomplete, so this summary is conservative.",
        "Manual review of the full report is still recommended before finalizing a hiring decision.",
    ]
    if evaluation and evaluation.missed_acceptance:
        risks.append(f"Missed acceptance remains: {evaluation.missed_acceptance[0]}")
    interview_focus = [
        "Ask the candidate to explain their debugging path and verification loop.",
        "Probe how they trade off speed versus correctness under assessment pressure.",
        "Review one missed or uncertain area from the unlocked report in detail.",
    ]
    evidence = [
        ReportEvidence(label="Bug resolution", detail=f"{fixed} of {total} tracked issues were marked fixed."),
        ReportEvidence(
            label="AI usage",
            detail=f"Buddy was consulted {report['ai']['prompt_count']} time(s) during the session.",
        ),
    ]
    return ReportAnalysis(
        session_id=session_id,
        summary=summary,
        recommendation=recommendation,  # type: ignore[arg-type]
        confidence=0.45,
        highlights=highlights,
        risks=risks,
        interview_focus=interview_focus,
        evidence=evidence,
    )


async def run(session_id: str, report: ReportData, evaluation: EvaluationResult | None) -> ReportAnalysis:
    user = json.dumps(_compact_report(report, evaluation), indent=2, default=str)
    data = await complete_json(REPORT_ANALYST, user, temperature=0.2, max_tokens=1400)
    if not isinstance(data, dict):
        log.warning("report_analyst: non-dict payload from model, using fallback")
        return _fallback_analysis(session_id, report, evaluation)

    try:
        evidence = []
        for item in data.get("evidence") or []:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            detail = str(item.get("detail") or "").strip()
            if label and detail:
                evidence.append(ReportEvidence(label=label, detail=detail))
        analysis = ReportAnalysis(
            session_id=session_id,
            summary=str(data.get("summary") or "").strip(),
            recommendation=str(data.get("recommendation") or "mixed").strip().lower(),  # type: ignore[arg-type]
            confidence=max(0.0, min(1.0, float(data.get("confidence", 0.5)))),
            highlights=_normalize_text_list(
                data.get("highlights"),
                ["The unlocked report should be reviewed directly for stronger hiring signals."],
            ),
            risks=_normalize_text_list(
                data.get("risks"),
                ["The available evidence is mixed, so manual review is still recommended."],
            ),
            interview_focus=_normalize_text_list(
                data.get("interview_focus"),
                ["Ask the candidate to explain how they verified the reported fix."],
            ),
            evidence=evidence or [
                ReportEvidence(
                    label="Report-grounded review",
                    detail="This analysis is based on the candidate report and stored evaluator data.",
                )
            ],
        )
    except Exception as exc:
        log.warning("report_analyst: invalid payload from model, using fallback: %s", exc)
        return _fallback_analysis(session_id, report, evaluation)

    if not analysis.summary:
        return _fallback_analysis(session_id, report, evaluation)
    return analysis
