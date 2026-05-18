"""Candidate-side endpoints: start session, read workspace, save edits, submit, run code."""
from __future__ import annotations

import shlex
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agents import evaluator
from app.models.schemas import (
    ActivityEvent,
    Assessment,
    CandidateFeedback,
    CandidateSession,
    ChallengeResponse,
    EventKind,
    FeedbackCategory,
)
from app.services import sandbox
from app.store import store

router = APIRouter(prefix="/candidate", tags=["candidate"])


# Map file extensions to a runner command. We pick the runtime that's most
# likely to be installed on a developer machine; if a runtime isn't on PATH
# the /run endpoint returns a friendly stderr message instead of crashing.
LANG_RUNNERS: dict[str, list[str]] = {
    ".py": ["python3"],
    ".js": ["node"],
    ".mjs": ["node"],
    ".cjs": ["node"],
    ".ts": ["tsx"],
    ".tsx": ["tsx"],
    ".sh": ["bash"],
}

RUN_TIMEOUT_SECONDS = 10
RUN_OUTPUT_CAP = 8000  # cap each stream to keep the UI snappy
BLOCKED_TERMINAL_COMMANDS = {"bash", "sh", "zsh", "sudo", "su"}


class StartSessionIn(BaseModel):
    assessment_id: str
    candidate_name: str = "Candidate"


class WorkspaceOut(BaseModel):
    session: CandidateSession
    assessment: Assessment


def _build_initial_responses(assessment: Assessment) -> dict[str, ChallengeResponse]:
    return {
        challenge.id: ChallengeResponse(
            challenge_id=challenge.id,
            challenge_kind=challenge.kind,
        )
        for challenge in assessment.candidate_challenges
    }


@router.post("/sessions", response_model=WorkspaceOut)
async def start_session(body: StartSessionIn) -> WorkspaceOut:
    assessment = await store.get_assessment(body.assessment_id)
    if not assessment or not assessment.buggy_codebase:
        raise HTTPException(404, "assessment not ready")

    session = CandidateSession(
        assessment_id=body.assessment_id,
        candidate_name=body.candidate_name,
        current_challenge_id=(
            assessment.candidate_challenges[0].id if assessment.candidate_challenges else None
        ),
        current_files={f.path: f.content for f in assessment.buggy_codebase.files},
        challenge_responses=_build_initial_responses(assessment),
    )
    await store.put_session(session)
    await store.append_event(
        ActivityEvent(session_id=session.id, kind=EventKind.FILE_OPEN,
                      file_path=assessment.buggy_codebase.entry_point
                      or assessment.buggy_codebase.files[0].path)
    )
    return WorkspaceOut(session=session, assessment=assessment)


@router.get("/sessions/{session_id}", response_model=WorkspaceOut)
async def get_session(session_id: str) -> WorkspaceOut:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment:
        raise HTTPException(500, "assessment missing")
    return WorkspaceOut(session=session, assessment=assessment)


class FileEditIn(BaseModel):
    path: str
    content: str


@router.put("/sessions/{session_id}/files", response_model=CandidateSession)
async def save_file(session_id: str, body: FileEditIn) -> CandidateSession:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    session.current_files[body.path] = body.content
    await store.put_session(session)
    return session


class ChallengeResponseIn(BaseModel):
    status: Literal["pending", "in_progress", "completed"] | None = None
    answer_text: str | None = None
    selected_option_ids: dict[str, list[str]] | None = None


class CurrentChallengeIn(BaseModel):
    challenge_id: str


class FeedbackIn(BaseModel):
    category: FeedbackCategory = FeedbackCategory.GENERAL
    message: str
    challenge_id: str | None = None


@router.put("/sessions/{session_id}/current-challenge", response_model=CandidateSession)
async def set_current_challenge(session_id: str, body: CurrentChallengeIn) -> CandidateSession:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment:
        raise HTTPException(500, "assessment missing")
    if body.challenge_id not in {c.id for c in assessment.candidate_challenges}:
        raise HTTPException(404, "challenge not found")
    session.current_challenge_id = body.challenge_id
    await store.put_session(session)
    await store.append_event(ActivityEvent(
        session_id=session.id,
        kind=EventKind.CHALLENGE_SWITCH,
        payload={"challenge_id": body.challenge_id},
    ))
    return session


@router.put("/sessions/{session_id}/challenges/{challenge_id}/response", response_model=CandidateSession)
async def save_challenge_response(
    session_id: str,
    challenge_id: str,
    body: ChallengeResponseIn,
) -> CandidateSession:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment:
        raise HTTPException(500, "assessment missing")
    challenge = next((c for c in assessment.candidate_challenges if c.id == challenge_id), None)
    if not challenge:
        raise HTTPException(404, "challenge not found")

    response = session.challenge_responses.get(challenge_id) or ChallengeResponse(
        challenge_id=challenge_id,
        challenge_kind=challenge.kind,
    )
    if body.status is not None:
        response.status = body.status  # type: ignore[assignment]
    if body.answer_text is not None:
        response.answer_text = body.answer_text
    if body.selected_option_ids is not None:
        response.selected_option_ids = body.selected_option_ids
    response.updated_at = datetime.now(timezone.utc)
    session.challenge_responses[challenge_id] = response
    await store.put_session(session)
    await store.append_event(ActivityEvent(
        session_id=session.id,
        kind=EventKind.CHALLENGE_RESPONSE,
        payload={
            "challenge_id": challenge_id,
            "challenge_kind": challenge.kind.value,
            "status": response.status,
            "answer_chars": len(response.answer_text or ""),
            "selected_count": sum(len(v) for v in response.selected_option_ids.values()),
        },
    ))
    return session


@router.post("/sessions/{session_id}/feedback", response_model=CandidateFeedback)
async def submit_feedback(session_id: str, body: FeedbackIn) -> CandidateFeedback:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment:
        raise HTTPException(500, "assessment missing")

    message = body.message.strip()
    if len(message) < 8:
        raise HTTPException(400, "feedback message is too short")

    challenge_id = body.challenge_id or session.current_challenge_id
    if challenge_id and challenge_id not in {challenge.id for challenge in assessment.candidate_challenges}:
        raise HTTPException(404, "challenge not found")

    feedback = CandidateFeedback(
        assessment_id=session.assessment_id,
        session_id=session.id,
        candidate_name=session.candidate_name,
        challenge_id=challenge_id,
        category=body.category,
        message=message,
    )
    await store.append_feedback(feedback)
    await store.append_event(ActivityEvent(
        session_id=session.id,
        kind=EventKind.FEEDBACK_SUBMIT,
        payload={
            "feedback_id": feedback.id,
            "category": feedback.category.value,
            "challenge_id": challenge_id,
            "message_length": len(message),
        },
    ))
    return feedback


class SubmitOut(BaseModel):
    session_id: str
    status: Literal["evaluating", "done"]


@router.post("/sessions/{session_id}/submit", response_model=SubmitOut)
async def submit(session_id: str) -> SubmitOut:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    assessment = await store.get_assessment(session.assessment_id)
    if not assessment or not assessment.candidate_ticket or not assessment.golden_codebase:
        raise HTTPException(500, "assessment incomplete")

    session.submitted_at = datetime.now(timezone.utc)
    await store.put_session(session)
    await store.append_event(ActivityEvent(session_id=session.id, kind=EventKind.SUBMIT))
    result = await evaluator.run(
        job=assessment.job,
        ticket=assessment.candidate_ticket,
        challenges=assessment.candidate_challenges,
        golden=assessment.golden_codebase,
        session=session,
        events=await store.get_events(session.id),
        buddy_history=await store.get_buddy_history(session.id),
    )
    await store.put_evaluation(result)
    return SubmitOut(session_id=session.id, status="done")


class RunIn(BaseModel):
    file_path: str


class RunOut(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    command: str
    timed_out: bool = False
    unsupported: bool = False


class TerminalIn(BaseModel):
    command: str


async def _execute_workspace_command(
    session: CandidateSession,
    cmd: list[str],
    unsupported_command: str,
) -> RunOut:
    result = await sandbox.run_command(
        session.id,
        cmd,
        command=unsupported_command,
        timeout_seconds=RUN_TIMEOUT_SECONDS,
        output_cap=RUN_OUTPUT_CAP,
    )
    return RunOut(**result)


async def _prepare_workspace_for_execution(session: CandidateSession) -> CandidateSession:
    """Run commands against the live sandbox workspace when available."""
    try:
        files = await sandbox.read_files(session.id)
        if not files:
            await sandbox.provision(session.id, session.current_files)
            files = await sandbox.read_files(session.id)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    if files and files != session.current_files:
        session.current_files = files
        await store.put_session(session)
    return session


@router.post("/sessions/{session_id}/run", response_model=RunOut)
async def run_file(session_id: str, body: RunIn) -> RunOut:
    """Execute the candidate's current file content in the live sandbox workspace."""
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    session = await _prepare_workspace_for_execution(session)
    if body.file_path not in session.current_files:
        raise HTTPException(404, f"file not in session: {body.file_path}")

    ext = "." + body.file_path.rsplit(".", 1)[-1].lower()
    runner = LANG_RUNNERS.get(ext)
    if not runner:
        return RunOut(
            stdout="",
            stderr=f"Live execution for {ext!r} files isn't supported yet.",
            exit_code=-1,
            duration_ms=0,
            command="",
            unsupported=True,
        )

    cmd = runner + [body.file_path]
    result = await _execute_workspace_command(session, cmd, " ".join(runner))

    # Activity event so the heatmap captures "ran code" intensity per file.
    await store.append_event(ActivityEvent(
        session_id=session.id,
        kind=EventKind.RUN,
        file_path=body.file_path,
        payload={
            "exit_code": result.exit_code,
            "duration_ms": result.duration_ms,
            "timed_out": result.timed_out,
            "unsupported": result.unsupported,
            "command": result.command,
            "stdout_preview": result.stdout[:1200],
            "stderr_preview": result.stderr[:1200],
        },
    ))
    return result


@router.post("/sessions/{session_id}/terminal", response_model=RunOut)
async def run_terminal_command(session_id: str, body: TerminalIn) -> RunOut:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
    session = await _prepare_workspace_for_execution(session)

    command = body.command.strip()
    if not command:
        raise HTTPException(400, "command is required")

    try:
        cmd = shlex.split(command)
    except ValueError as e:
        raise HTTPException(400, f"invalid command: {e}") from e
    if not cmd:
        raise HTTPException(400, "command is required")
    head = cmd[0].strip()
    if head in BLOCKED_TERMINAL_COMMANDS or "/" in head:
        raise HTTPException(
            400,
            "That terminal command is disabled in the assessment environment.",
        )

    result = await _execute_workspace_command(session, cmd, command)
    await store.append_event(ActivityEvent(
        session_id=session.id,
        kind=EventKind.TERMINAL_COMMAND,
        payload={
            "command": command,
            "exit_code": result.exit_code,
            "duration_ms": result.duration_ms,
            "timed_out": result.timed_out,
            "unsupported": result.unsupported,
            "stdout_preview": result.stdout[:1200],
            "stderr_preview": result.stderr[:1200],
        },
    ))
    return result
