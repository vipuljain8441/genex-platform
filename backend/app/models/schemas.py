"""Pydantic schemas — every artifact that crosses an agent boundary lives here.

The data model is deliberately role-agnostic. The `role_family` field on an
assessment lets the same pipeline produce a debugging task for a backend dev,
a flaky-test triage for a QA, or an ambiguous-spec refinement for a PM.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


# ── Role taxonomy ─────────────────────────────────────────────────────────────

class RoleFamily(str, Enum):
    BACKEND = "backend"
    FRONTEND = "frontend"
    FULLSTACK = "fullstack"
    QA = "qa"
    DEVOPS = "devops"
    DATA = "data"
    PM = "pm"
    DESIGN = "design"


class ArtifactKind(str, Enum):
    CODE = "code"
    TEST_SUITE = "test_suite"
    PIPELINE = "pipeline"
    SPEC = "spec"
    DESIGN_DOC = "design_doc"


class DefectKind(str, Enum):
    BUG = "bug"
    FLAKE = "flake"
    MISCONFIG = "misconfig"
    AMBIGUITY = "ambiguity"
    GAP = "gap"


# ── Phase 1: Employer intake ──────────────────────────────────────────────────

class RecruiterContext(BaseModel):
    """Hand-entered context the recruiter provides when no PM tool is connected.

    Lets us ground the assessment in *real* team specifics instead of letting
    the Extractor agent hallucinate tickets out of thin air.
    """
    domain_summary: str = ""
    sample_ticket_titles: list[str] = Field(default_factory=list)
    common_bug_patterns: str = ""
    additional_tech_notes: str = ""


class JobSpec(BaseModel):
    """Everything the employer tells us at intake."""
    title: str
    role_family: RoleFamily
    seniority: Literal["junior", "mid", "senior", "staff"] = "mid"
    must_have_skills: list[str] = Field(default_factory=list)
    nice_to_have_skills: list[str] = Field(default_factory=list)
    jd_text: str
    duration_minutes: int = 60
    pm_tool: Literal["jira", "linear", "github", "none"] = "jira"
    recruiter_context: RecruiterContext | None = None


# ── Phase 1 outputs ───────────────────────────────────────────────────────────

class ExtractedContext(BaseModel):
    """What Agent A pulls from the employer's PM tool."""
    sample_tickets: list[dict] = Field(default_factory=list)
    tech_signals: list[str] = Field(default_factory=list)
    domain_summary: str = ""


class CodeFile(BaseModel):
    path: str
    language: str
    content: str


class Codebase(BaseModel):
    """A bundle of files that together form an artifact (code, tests, pipeline)."""
    artifact_kind: ArtifactKind = ArtifactKind.CODE
    entry_point: str | None = None
    files: list[CodeFile]
    setup_instructions: str = ""


class BugInjectionBrief(BaseModel):
    """Internal-only — Agent C → Agent D."""
    defects: list[dict]  # [{kind, location_hint, behavior_change, severity}]
    notes: str = ""


class CandidateTicket(BaseModel):
    """The Jira-style ticket the candidate sees."""
    id: str = Field(default_factory=lambda: _id("TKT"))
    title: str
    description: str
    acceptance_criteria: list[str]
    priority: Literal["low", "medium", "high", "critical"] = "high"
    labels: list[str] = Field(default_factory=list)
    reporter: str = "Priya Menon"
    assignee: str = "you"


# ── Assessment (the top-level employer-side object) ──────────────────────────

class PipelineStage(str, Enum):
    PENDING = "pending"
    EXTRACTING = "extracting"
    AUTHORING = "authoring"
    TICKETING = "ticketing"
    INJECTING = "injecting"
    READY = "ready"
    FAILED = "failed"


class AssessmentStatus(BaseModel):
    stage: PipelineStage = PipelineStage.PENDING
    detail: str = ""
    updated_at: datetime = Field(default_factory=_now)


class Assessment(BaseModel):
    id: str = Field(default_factory=lambda: _id("AST"))
    job: JobSpec
    status: AssessmentStatus = Field(default_factory=AssessmentStatus)
    context: ExtractedContext | None = None
    golden_codebase: Codebase | None = None
    buggy_codebase: Codebase | None = None
    candidate_ticket: CandidateTicket | None = None
    bug_brief: BugInjectionBrief | None = None
    created_at: datetime = Field(default_factory=_now)


# ── Invites ───────────────────────────────────────────────────────────────────

class Invite(BaseModel):
    """An email invitation to take a specific assessment.

    `token` is the random handle that goes in the candidate URL. We deliberately
    keep id and token distinct so the employer-visible id is short and pretty,
    while the URL token is opaque/longer.
    """
    id: str = Field(default_factory=lambda: _id("INV"))
    assessment_id: str
    candidate_email: str
    candidate_name: str = ""
    token: str = Field(default_factory=lambda: uuid4().hex[:24])
    invited_at: datetime = Field(default_factory=_now)
    accepted_at: datetime | None = None
    expires_at: datetime | None = None
    session_id: str | None = None
    email_sent: bool = False
    email_error: str | None = None

    @property
    def status(self) -> Literal["pending", "accepted", "expired"]:
        if self.accepted_at is not None:
            return "accepted"
        if self.expires_at is not None and self.expires_at < _now():
            return "expired"
        return "pending"


# ── Phase 2: Candidate session ───────────────────────────────────────────────

class CandidateSession(BaseModel):
    id: str = Field(default_factory=lambda: _id("SES"))
    assessment_id: str
    candidate_name: str = "Candidate"
    started_at: datetime = Field(default_factory=_now)
    submitted_at: datetime | None = None
    current_files: dict[str, str] = Field(default_factory=dict)  # path → content


class EventKind(str, Enum):
    EDIT = "edit"
    FILE_OPEN = "file_open"
    FILE_SWITCH = "file_switch"
    RUN = "run"
    BUDDY_QUERY = "buddy_query"
    BUDDY_HINT = "buddy_hint"
    IDLE = "idle"
    SUBMIT = "submit"


class ActivityEvent(BaseModel):
    """A single observation captured during a candidate session.

    These feed the heatmap and the evaluator's behavioural signal pipeline.
    """
    id: str = Field(default_factory=lambda: _id("EVT"))
    session_id: str
    kind: EventKind
    at: datetime = Field(default_factory=_now)
    file_path: str | None = None
    payload: dict = Field(default_factory=dict)


# ── Buddy ─────────────────────────────────────────────────────────────────────

class BuddyTurn(BaseModel):
    role: Literal["user", "buddy"]
    content: str
    at: datetime = Field(default_factory=_now)


class BuddyRequest(BaseModel):
    session_id: str
    question: str
    open_file: str | None = None
    selection: str | None = None
    history: list[BuddyTurn] = Field(default_factory=list)
    # path → content. Sent by the client so Buddy can read the workspace and
    # produce real edits. The server-side store also has this, but the client's
    # in-memory copy may be newer if there are unsaved edits.
    workspace: dict[str, str] = Field(default_factory=dict)


class BuddyEdit(BaseModel):
    """A full-file replacement Buddy proposes. The candidate decides via Apply / Dismiss."""
    file_path: str
    new_content: str
    rationale: str = ""


class BuddyResponse(BaseModel):
    hint: str
    hint_level: Literal["nudge", "guide", "concrete"] = "nudge"
    blocked: bool = False  # true if we refused to answer (solution-seeking)
    edits: list[BuddyEdit] = Field(default_factory=list)


# ── Phase 3: Evaluation ──────────────────────────────────────────────────────

class SignalScore(BaseModel):
    name: str
    score: float  # 0..1
    notes: str = ""


class EvaluationResult(BaseModel):
    session_id: str
    overall_score: float
    signals: list[SignalScore]
    narrative: str
    strengths: list[str]
    gaps: list[str]
    completed_acceptance: list[str]
    missed_acceptance: list[str]
    generated_at: datetime = Field(default_factory=_now)
