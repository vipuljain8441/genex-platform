"""Candidate-side endpoints: start session, read workspace, save edits, submit, run code."""
from __future__ import annotations

import asyncio
import shlex
import shutil
import tempfile
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agents import evaluator
from app.models.schemas import (
    ActivityEvent,
    Assessment,
    CandidateSession,
    EventKind,
)
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
    ".ts": ["npx", "--yes", "tsx"],
    ".tsx": ["npx", "--yes", "tsx"],
    ".sh": ["bash"],
}

RUN_TIMEOUT_SECONDS = 10
RUN_OUTPUT_CAP = 8000  # cap each stream to keep the UI snappy


class StartSessionIn(BaseModel):
    assessment_id: str
    candidate_name: str = "Candidate"


class WorkspaceOut(BaseModel):
    session: CandidateSession
    assessment: Assessment


@router.post("/sessions", response_model=WorkspaceOut)
async def start_session(body: StartSessionIn) -> WorkspaceOut:
    assessment = await store.get_assessment(body.assessment_id)
    if not assessment or not assessment.buggy_codebase:
        raise HTTPException(404, "assessment not ready")

    session = CandidateSession(
        assessment_id=body.assessment_id,
        candidate_name=body.candidate_name,
        current_files={f.path: f.content for f in assessment.buggy_codebase.files},
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

    await store.append_event(ActivityEvent(session_id=session.id, kind=EventKind.SUBMIT))
    result = await evaluator.run(
        job=assessment.job,
        ticket=assessment.candidate_ticket,
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
    if not cmd:
        return RunOut(
            stdout="",
            stderr="No command provided.",
            exit_code=-1,
            duration_ms=0,
            command="",
            unsupported=True,
        )
    if shutil.which(cmd[0]) is None:
        return RunOut(
            stdout="",
            stderr=f"Runtime '{cmd[0]}' not found on PATH.",
            exit_code=-1,
            duration_ms=0,
            command=unsupported_command,
            unsupported=True,
        )
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="genex_run_") as td:
        root = Path(td)
        # Write the entire workspace so the target file's imports resolve.
        for path, content in session.current_files.items():
            full = root / path
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(content)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=root,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as e:
            return RunOut(
                stdout="", stderr=f"Failed to start runtime: {e}",
                exit_code=-1, duration_ms=0, command=" ".join(cmd), unsupported=True,
            )

        timed_out = False
        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=RUN_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            stdout_b, stderr_b = b"", f"\n--- timed out after {RUN_TIMEOUT_SECONDS}s ---\n".encode()
            timed_out = True

        duration_ms = int((time.monotonic() - started) * 1000)
        result = RunOut(
            stdout=stdout_b.decode("utf-8", errors="replace")[:RUN_OUTPUT_CAP],
            stderr=stderr_b.decode("utf-8", errors="replace")[:RUN_OUTPUT_CAP],
            exit_code=proc.returncode if proc.returncode is not None else -1,
            duration_ms=duration_ms,
            command=" ".join(cmd),
            timed_out=timed_out,
        )
    return result


@router.post("/sessions/{session_id}/run", response_model=RunOut)
async def run_file(session_id: str, body: RunIn) -> RunOut:
    """Execute the candidate's current file content in a sandboxed temp dir.

    Caveats:
    - Local-process execution, no container — fine for hackathon, not for prod.
    - 10s timeout, capped output, no network restrictions.
    """
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")
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
        },
    ))
    return result


@router.post("/sessions/{session_id}/terminal", response_model=RunOut)
async def run_terminal_command(session_id: str, body: TerminalIn) -> RunOut:
    session = await store.get_session(session_id)
    if not session:
        raise HTTPException(404, "session not found")

    command = body.command.strip()
    if not command:
        raise HTTPException(400, "command is required")

    try:
        cmd = shlex.split(command)
    except ValueError as e:
        raise HTTPException(400, f"invalid command: {e}") from e

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
        },
    ))
    return result
