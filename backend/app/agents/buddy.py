"""Buddy — scoped engineering mentor for the candidate IDE.

v6: hint-ladder mode (STRICT / MODERATE / GUIDED), structured section layout,
and mode-aware edit gating. The system prompt lives at app.prompts.library.BUDDY.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Literal

from app.core.llm import complete_json
from app.models.schemas import (
    ActivityEvent,
    BuddyEdit,
    BuddyRequest,
    BuddyResponse,
    CandidateChallenge,
    EventKind,
)
from app.prompts.library import BUDDY

log = logging.getLogger(__name__)

Mode = Literal["STRICT", "MODERATE", "GUIDED"]
HintLevel = Literal["nudge", "guide", "concrete"]
LadderLevel = int  # 1..4

_MAX_FILE_CHARS = 8000
_MAX_GROUNDING_CHARS = 3500
_DEFAULT_MODE: Mode = "MODERATE"

# Section headers required for every non-blocked reply. We match on the plain
# text (no emoji) so encoding/rendering differences cannot break validation.
_REQUIRED_SECTIONS = (
    "WHAT'S HAPPENING",
    "ISSUES",
    "WHY THIS WORKS",
    "THINK ABOUT THIS",
    "NEXT STEP",
)
_CHANGES_SECTION = "CHANGES"

# Student explicitly asked Buddy to write/apply code.
_EXPLICIT_CODE = re.compile(
    r"(?i)\b("
    r"make\s+(this|the)\s+change|apply\s+(this|the|it)|"
    r"write\s+(this|it)\s+for\s+me|do\s+it\s+for\s+me|"
    r"implement\s+(this|it)\s+for\s+me|"
    r"go\s+ahead\s+and\s+(fix|change|apply|implement)|"
    r"please\s+(apply|implement|write)\s+(this|it)|"
    r"\bapply\s+the\s+(fix|change|patch)\b|"
    r"\bmake\s+the\s+(change|edit|fix)\b|"
    r"\bfix\s+(this|it)\b|"
    r"\bupdate\s+(this|it)\b|"
    r"\bjust\s+do\s+it\b"
    r")\b"
)

# Demanding the full ticket/assessment solution.
_FULL_SOLUTION = re.compile(
    r"(?i)\b("
    r"just\s+give\s+me\s+(the\s+)?(answer|solution|code)|"
    r"give\s+me\s+the\s+(full|complete|entire)\s+(solution|answer|code)|"
    r"do\s+(the\s+)?(whole|entire|full)\s+(ticket|assessment|task)\s+for\s+me|"
    r"solve\s+(the\s+)?(whole|entire|full)\s+(ticket|problem)|"
    r"complete\s+(the\s+)?(whole|entire)\s+(ticket|assessment)\s+for\s+me|"
    r"write\s+the\s+whole\s+thing"
    r")\b"
)

# Clearly unrelated to ticket/codebase.
_OUT_OF_SCOPE = re.compile(
    r"(?i)\b("
    r"what\s+is\s+the\s+capital\s+of|who\s+won\s+the|"
    r"write\s+me\s+a\s+poem|tell\s+me\s+a\s+joke|"
    r"how\s+do\s+i\s+reverse\s+a\s+string\s+in\s+python(?!\s+for\s+this)|"
    r"explain\s+react\s+native|teach\s+me\s+javascript\s+from\s+scratch|"
    r"what\s+is\s+machine\s+learning|crypto\s+price|"
    r"help\s+me\s+with\s+my\s+homework(?!\s+on\s+this)"
    r")\b"
)

# Verbatim scope and full-solution redirects from the v6 spec.
_SCOPE_REDIRECT = (
    "I can't help with that — I'm here for your assessment. "
    "Ask me anything about the ticket or the code."
)
_FULL_SOLUTION_REDIRECT = (
    "You're closer than you think. Tell me where it's blocking you "
    "and we'll fix that part."
)

_LLM_UNAVAILABLE_HINT = (
    "I couldn't reach the AI service just now — your message is still saved. "
    "Try again in a moment. If it keeps failing, ask me one short question about a single file or error."
)
_LLM_RATE_LIMIT_HINT = (
    "The AI service is rate-limited for a moment — your message is still saved. "
    "Wait about 10 seconds and send again. A shorter question helps if it keeps happening."
)

_GREETING = re.compile(
    r"(?i)^("
    r"hi|hello|hey|howdy|yo|"
    r"good\s+(morning|afternoon|evening)|"
    r"thanks|thank\s+you|thx|ty|"
    r"ok|okay|k|got\s+it|cool|nice|great|perfect|"
    r"sup|what'?s\s+up"
    r")[\s!.?,]*$"
)

_STUCK_VAGUE = re.compile(
    r"(?i)^("
    r"help(\s+me)?|yes|yep|yeah|ok|okay|sure|"
    r"lets\s+solve\s+this|let'?s\s+solve\s+this|"
    r"what\s+next|what\s+now|what\s+do\s+i\s+do|"
    r"i'?m\s+stuck|i\s+am\s+stuck|"
    r"what\s+should\s+i\s+do|"
    r"let'?s\s+go|continue|keep\s+going|"
    r"just\s+fix\s+it\s+for\s+me"
    r")[\s!.?,]*$"
)

_CODE_SAMPLE_REQUEST = re.compile(
    r"(?i)\b("
    r"show\s+me\s+(the\s+)?(code|syntax|example|query|snippet)|"
    r"show\s+me\s+an?\s+example|"
    r"give\s+me\s+(an?\s+)?(example|sample|snippet)|"
    r"what('s|\s+is)\s+the\s+(syntax|query|code)|"
    r"how\s+do\s+i\s+write\s+(the\s+)?(query|code|sql)|"
    r"can\s+i\s+see\s+(the\s+)?(code|example)|"
    r"example\s+of\s+(how|this|that)|"
    r"sample\s+(code|query)|"
    r"write\s+(the\s+)?query\s+for"
    r")\b"
)

_CODE_IN_MESSAGE = re.compile(
    r"(?m)^\s*(def |async def |class |import |from \S+ import |@|"
    r"function |const |let |var |return |if |for |while )"
)

_ASKS_WHAT_CODE_DOES = re.compile(
    r"(?i)\b("
    r"what\s+does\s+(this|it|that|\w+)\s+do|"
    r"what\s+is\s+(this|it|that|\w+)\s+doing|"
    r"explain\s+(this|it|that|how|why|the)|"
    r"walk\s+me\s+through\s+(this|it|that)|"
    r"help\s+me\s+understand"
    r")\b"
)

_NEEDS_EXPLANATION = re.compile(
    r"(?i)\b("
    r"i\s+don'?t\s+understand|don'?t\s+get\s+it|still\s+confused|"
    r"i'?m\s+lost|makes\s+no\s+sense|no\s+idea|"
    r"can\s+you\s+explain|explain\s+it\s+to\s+me|"
    r"what\s+does\s+.+\s+mean|"
    r"say\s+that\s+again|say\s+it\s+differently"
    r")\b"
)

_VAGUE_QUESTION = re.compile(
    r"(?i)\b("
    r"how\s+do\s+i\s+fix|how\s+to\s+fix|help\s+me\s+fix|"
    r"what'?s\s+wrong|not\s+working|doesn'?t\s+work|"
    r"how\s+do\s+i\s+(do|solve|implement)\s+this|"
    r"can\s+you\s+help|need\s+help|"
    r"tell\s+me\s+how\s+to"
    r")\b"
)


# ── trimming helpers ─────────────────────────────────────────────────────────

def _trim_workspace(ws: dict[str, str]) -> dict[str, str]:
    return {
        p: (c if len(c) <= _MAX_FILE_CHARS else c[:_MAX_FILE_CHARS] + "\n# ...(truncated)")
        for p, c in ws.items()
    }


def _trim_grounding(files: dict[str, str]) -> dict[str, str]:
    return {
        p: (
            c
            if len(c) <= _MAX_GROUNDING_CHARS
            else c[:_MAX_GROUNDING_CHARS] + "\n# ...(truncated)"
        )
        for p, c in files.items()
    }


# ── intent detection ────────────────────────────────────────────────────────

def _explicit_code_request(text: str) -> bool:
    return bool(_EXPLICIT_CODE.search(text))


def _looks_full_solution(text: str) -> bool:
    return bool(_FULL_SOLUTION.search(text))


def _looks_out_of_scope(text: str, *, has_ticket: bool) -> bool:
    if not has_ticket:
        return False
    if _OUT_OF_SCOPE.search(text):
        return True
    if re.match(
        r"(?i)^(how do i|what is|explain)\s+(python|javascript|java|go)\s*\??$",
        text.strip(),
    ):
        return True
    return False


def _is_greeting_or_small_talk(text: str) -> bool:
    return bool(_GREETING.match(text.strip()))


def _is_stuck_vague(text: str) -> bool:
    t = text.strip()
    if len(t) > 40:
        return False
    return bool(_STUCK_VAGUE.match(t))


def _asks_for_code_sample(text: str) -> bool:
    return bool(_CODE_SAMPLE_REQUEST.search(text))


def _is_vague_question(text: str) -> bool:
    if _is_stuck_vague(text):
        return True
    t = text.strip()
    if len(t) < 12:
        return True
    if _asks_for_code_sample(text):
        return False
    return bool(_VAGUE_QUESTION.search(text))


def _asks_what_code_does(question: str) -> bool:
    return bool(_ASKS_WHAT_CODE_DOES.search(question.strip()))


def _student_needs_explanation(question: str) -> bool:
    return bool(_NEEDS_EXPLANATION.search(question.strip()))


def _student_repeated_question(question: str, history: list[dict]) -> bool:
    q = _normalize_compare(question)
    if len(q) < 12:
        return False
    for turn in history:
        if turn.get("role") != "user":
            continue
        prior = _normalize_compare(str(turn.get("content", "")))
        if not prior or len(prior) < 12:
            continue
        if prior == q:
            return True
        if len(q) >= 20 and (q in prior or prior in q):
            return True
    return False


def _student_shared_code(question: str, selection: str | None) -> bool:
    if selection and len(selection.strip()) >= 12:
        if _CODE_IN_MESSAGE.search(selection) or "```" in selection:
            return True
        if "(" in selection and ")" in selection:
            return True
    text = question.strip()
    if not text:
        return False
    if "```" in text:
        return True
    lines = [line for line in text.splitlines() if line.strip()]
    code_lines = sum(1 for line in lines if _CODE_IN_MESSAGE.match(line))
    if code_lines >= 2:
        return True
    if code_lines >= 1 and len(text) >= 40:
        return True
    if code_lines >= 1 and any(
        kw in text for kw in ("def ", "class ", "import ", "async def ")
    ):
        return True
    return False


def _code_escalation_strike(
    history: list[dict], question: str, *, shared_code: bool
) -> int:
    """1..3. Used as one of the inputs to the hint-ladder calculation."""
    if (
        shared_code
        or _asks_for_code_sample(question)
        or _asks_what_code_does(question)
        or _student_needs_explanation(question)
        or _student_repeated_question(question, history)
    ):
        return 3
    prior_user = [t["content"] for t in history if t.get("role") == "user"]
    prior_vague = sum(
        1 for c in prior_user if _is_vague_question(c) or _is_stuck_vague(c)
    )
    if _is_vague_question(question) or _is_stuck_vague(question):
        return min(prior_vague + 1, 2)
    return 1


# ── session/context helpers ─────────────────────────────────────────────────

def _last_buddy_message(history: list[dict]) -> str | None:
    for turn in reversed(history):
        if turn.get("role") == "buddy":
            content = turn.get("content", "").strip()
            if content:
                return content
    return None


def _normalize_compare(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.lower())


def _too_similar_to_last(new_hint: str, last_buddy: str | None) -> bool:
    if not last_buddy:
        return False
    a = _normalize_compare(new_hint)
    b = _normalize_compare(last_buddy)
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) < 60 and (a in b or b in a):
        return True
    wa, wb = set(a.split()), set(b.split())
    if len(wa) < 6:
        return a == b
    overlap = len(wa & wb) / len(wa)
    return overlap > 0.72


def _last_buddy_challenge_id(events: list[ActivityEvent]) -> str | None:
    last: str | None = None
    for event in events:
        if event.kind != EventKind.BUDDY_QUERY:
            continue
        cid = (event.payload or {}).get("challenge_id")
        if isinstance(cid, str) and cid:
            last = cid
    return last


def _detect_ticket_switch(
    events: list[ActivityEvent],
    current_challenge_id: str | None,
) -> tuple[bool, str | None]:
    if not current_challenge_id:
        return False, None
    prior = _last_buddy_challenge_id(events)
    if not prior or prior == current_challenge_id:
        return False, prior
    return True, prior


def _grounding_files(
    workspace: dict[str, str],
    ticket: dict | None,
    open_file: str | None,
) -> dict[str, str]:
    paths: list[str] = []
    if open_file:
        paths.append(open_file)
    if ticket:
        for path in ticket.get("related_files") or []:
            if path not in paths:
                paths.append(path)
    return {p: workspace[p] for p in paths if p in workspace}


def _ticket_payload(challenge: CandidateChallenge | None) -> dict | None:
    if not challenge:
        return None
    return {
        "id": challenge.id,
        "title": challenge.title,
        "description": challenge.description,
        "acceptance_criteria": challenge.acceptance_criteria,
        "related_files": challenge.related_files,
        "labels": challenge.labels,
    }


# ── hint-ladder logic ───────────────────────────────────────────────────────

def _resolve_mode(req: BuddyRequest, challenge: CandidateChallenge | None) -> Mode:
    """Active challenge wins; client-provided req.mode only used as a fallback."""
    if challenge and getattr(challenge, "buddy_mode", None) in ("STRICT", "MODERATE", "GUIDED"):
        return challenge.buddy_mode  # type: ignore[return-value]
    if req.mode in ("STRICT", "MODERATE", "GUIDED"):
        return req.mode  # type: ignore[return-value]
    return _DEFAULT_MODE


def _ladder_level(
    mode: Mode,
    *,
    strike: int,
    explicit_code: bool,
    shared_code: bool,
    needs_explanation: bool,
    asks_what_code: bool,
    asks_example: bool,
    repeated: bool,
) -> LadderLevel:
    """L1..L4. Mode acts as a hard ceiling.

    STRICT   → L1 baseline, L2 ceiling.
    MODERATE → L1 baseline, L3 freely, L4 only after 2 failed attempts or
               explicit code request with strike ≥ 3.
    GUIDED   → L1 baseline, L4 available after 1 attempt.
    """
    wants_concrete = (
        explicit_code
        or shared_code
        or needs_explanation
        or asks_what_code
        or asks_example
        or repeated
    )

    if mode == "STRICT":
        # No diffs ever — cap at L2.
        return 2 if (wants_concrete or strike >= 2) else 1

    if mode == "GUIDED":
        if wants_concrete or strike >= 2:
            return 4
        if strike >= 1:
            return 3
        return 2

    # MODERATE (default)
    if explicit_code and strike >= 2:
        return 4
    if wants_concrete and strike >= 3:
        return 4
    if wants_concrete or strike >= 2:
        return 3
    if strike >= 1:
        return 2
    return 1


def _level_to_hint_level(level: LadderLevel) -> HintLevel:
    if level >= 4:
        return "concrete"
    if level >= 3:
        return "guide"
    return "nudge"


# ── response validation ─────────────────────────────────────────────────────

def _has_required_sections(hint: str) -> bool:
    return all(marker in hint for marker in _REQUIRED_SECTIONS)


def _has_changes_section(hint: str) -> bool:
    return _CHANGES_SECTION in hint


def _normalize_edits(
    raw: object,
    workspace: dict[str, str],
    *,
    allow: bool,
) -> list[BuddyEdit]:
    if not allow or not isinstance(raw, list):
        return []
    edits: list[BuddyEdit] = []
    for item in raw[:5]:
        if not isinstance(item, dict):
            continue
        path = item.get("file_path") or item.get("path")
        content = item.get("new_content") or item.get("content")
        if not path or path not in workspace or not isinstance(content, str):
            continue
        if not content.strip():
            continue
        edits.append(
            BuddyEdit(
                file_path=str(path),
                new_content=content,
                rationale=str(item.get("rationale", ""))[:500],
            )
        )
    return edits


def _clamp_hint_length(hint: str, max_words: int = 600) -> str:
    """The v6 layout is structurally bounded — a generous ceiling is enough."""
    words = hint.split()
    if len(words) <= max_words:
        return hint
    return " ".join(words[:max_words]) + "\n\n*(Truncated — ask a follow-up if you need more.)*"


# ── main entry point ────────────────────────────────────────────────────────

async def run(
    req: BuddyRequest,
    *,
    active_challenge: CandidateChallenge | None = None,
    session_events: list[ActivityEvent] | None = None,
) -> BuddyResponse:
    challenge_id = req.challenge_id or (
        active_challenge.id if active_challenge else None
    )
    ticket_switched, _prior_challenge = _detect_ticket_switch(
        session_events or [], challenge_id
    )

    history = [] if ticket_switched else [
        {"role": t.role, "content": t.content} for t in req.history[-12:]
    ]
    workspace = _trim_workspace(req.workspace) if req.workspace else {}
    ticket = _ticket_payload(active_challenge)
    ticket_has = ticket is not None

    explicit_code = _explicit_code_request(req.question)
    shared_code = _student_shared_code(req.question, req.selection)
    strike = _code_escalation_strike(history, req.question, shared_code=shared_code)

    full_solution = _looks_full_solution(req.question)
    out_of_scope = _looks_out_of_scope(req.question, has_ticket=ticket_has)
    greeting = _is_greeting_or_small_talk(req.question)
    stuck_vague = _is_stuck_vague(req.question) and not shared_code

    asks_what_code = _asks_what_code_does(req.question)
    needs_explanation = _student_needs_explanation(req.question)
    asks_example = _asks_for_code_sample(req.question)
    repeated_question = _student_repeated_question(req.question, history)

    mode = _resolve_mode(req, active_challenge)
    ladder_level = _ladder_level(
        mode,
        strike=strike,
        explicit_code=explicit_code,
        shared_code=shared_code,
        needs_explanation=needs_explanation,
        asks_what_code=asks_what_code,
        asks_example=asks_example,
        repeated=repeated_question,
    )
    hint_level: HintLevel = _level_to_hint_level(ladder_level)

    # Edits are gated by: explicit request, mode allowing L4, AND ladder reached L4.
    edits_allowed = explicit_code and mode != "STRICT" and ladder_level >= 4

    # ── short-circuit: out of scope ─────────────────────────────────────────
    if out_of_scope:
        return BuddyResponse(
            hint=_SCOPE_REDIRECT,
            hint_level="nudge",
            blocked=True,
            edits=[],
        )

    # ── short-circuit: full-solution demand ────────────────────────────────
    if full_solution:
        return BuddyResponse(
            hint=_FULL_SOLUTION_REDIRECT,
            hint_level="nudge",
            blocked=True,
            edits=[],
        )

    grounding = _trim_grounding(_grounding_files(workspace, ticket, req.open_file))
    if greeting and not shared_code:
        grounding = {}
    last_buddy = _last_buddy_message(history)
    avoid_repetition = bool(
        last_buddy
        and (stuck_vague or greeting or repeated_question or needs_explanation)
        and not ticket_switched
    )

    payload = {
        "active_ticket": ticket,
        "ticket_switched": ticket_switched,
        "ticket_grounding_files": grounding,
        "workspace_paths": sorted(workspace.keys()),
        "mode": mode,
        "hint_ladder_level": ladder_level,
        "hint_level": hint_level,
        "edits_allowed": edits_allowed,
        "student_shared_code": shared_code,
        "student_asks_what_code_does": asks_what_code,
        "student_needs_explanation": needs_explanation,
        "student_asks_for_example": asks_example,
        "student_repeated_question": repeated_question,
        "code_escalation_strike": strike,
        "explicit_code_request": explicit_code,
        "out_of_scope": False,
        "full_solution_demand": False,
        "is_greeting_or_small_talk": greeting,
        "student_stuck_vague": stuck_vague,
        "avoid_repetition": avoid_repetition,
        "last_buddy_message": last_buddy,
        "open_file": req.open_file,
        "selection": req.selection,
        "recent_chat": history[-6:],
        "candidate_question": req.question,
    }
    if ticket_switched:
        log.info(
            "Buddy ticket switch: prior=%s current=%s — hard reset context",
            _prior_challenge,
            challenge_id,
        )

    user = json.dumps(payload, indent=2)

    async def _call_buddy(extra_note: str = "") -> dict:
        u = user
        if extra_note:
            u = json.dumps({**payload, "retry_note": extra_note}, indent=2)
        tokens = 1800 if ladder_level >= 3 else 1100
        result = await complete_json(BUDDY, u, temperature=0.5, max_tokens=tokens)
        return result if isinstance(result, dict) else {"hint": str(result)}

    try:
        data = await _call_buddy()
    except (json.JSONDecodeError, ValueError) as exc:
        log.warning("Buddy LLM JSON failed: %s", exc)
        return BuddyResponse(
            hint=_LLM_UNAVAILABLE_HINT,
            hint_level="nudge",
            blocked=False,
            edits=[],
        )
    except Exception as exc:  # noqa: BLE001 — network/SDK failures vary by provider
        log.warning("Buddy LLM request failed: %s", exc)
        err = str(exc).lower()
        hint = (
            _LLM_RATE_LIMIT_HINT
            if "rate_limit" in err or "429" in err
            else _LLM_UNAVAILABLE_HINT
        )
        return BuddyResponse(
            hint=hint,
            hint_level="nudge",
            blocked=False,
            edits=[],
        )

    if not isinstance(data, dict):
        data = {"hint": str(data), "hint_level": hint_level, "blocked": False, "edits": []}

    hint = str(data.get("hint") or "").strip()
    blocked_from_model = bool(data.get("blocked", False))

    # If the model claimed blocked (e.g. it detected out-of-scope we missed),
    # short-circuit with whatever single line it returned.
    if blocked_from_model:
        return BuddyResponse(
            hint=hint or _SCOPE_REDIRECT,
            hint_level="nudge",
            blocked=True,
            edits=[],
        )

    # Structure validation: every non-blocked reply must carry the layout.
    if not hint or not _has_required_sections(hint):
        log.info("Buddy reply missing required sections; retrying with explicit reminder")
        try:
            data = await _call_buddy(
                "Your previous reply did not include the required sections. "
                "Emit EVERY section header literally: WHAT'S HAPPENING, ISSUES, "
                "WHY THIS WORKS, THINK ABOUT THIS, NEXT STEP. Include CHANGES only "
                "if you proposed edits. Use the exact emoji + uppercase headers."
            )
            hint = str(data.get("hint") or hint).strip()
        except Exception:  # noqa: BLE001 — retry is best-effort
            pass

    # Anti-repetition: rerun once if the structured reply is too similar.
    if _too_similar_to_last(hint, last_buddy):
        log.info("Buddy reply too similar to last message; retrying with new angle")
        try:
            data = await _call_buddy(
                "Your last reply was too similar to your previous message. "
                "Change angle — name a different concrete issue, point at a different "
                "file/line, and give a different next step. Keep the section layout."
            )
            hint = str(data.get("hint") or hint).strip()
        except Exception:  # noqa: BLE001 — retry is best-effort
            pass

    hint = _clamp_hint_length(hint)

    edits = _normalize_edits(data.get("edits"), workspace, allow=edits_allowed)

    # If the model returned edits but our gating forbids them, drop them.
    if edits and not edits_allowed:
        log.info(
            "Buddy returned edits but gating disallowed (mode=%s, level=%d, explicit=%s) — dropping",
            mode, ladder_level, explicit_code,
        )
        edits = []

    # Final hint_level is what the ladder said, but bump to concrete if edits survived.
    final_hint_level: HintLevel = "concrete" if edits else hint_level

    return BuddyResponse(
        hint=hint or _LLM_UNAVAILABLE_HINT,
        hint_level=final_hint_level,
        blocked=False,
        edits=edits,
    )
