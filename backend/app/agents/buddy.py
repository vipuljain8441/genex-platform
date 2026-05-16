"""Buddy — the Helpful-but-Fallible AI coding copilot inside the candidate's IDE."""
from __future__ import annotations

import json

from app.core.llm import complete_json
from app.models.schemas import BuddyEdit, BuddyRequest, BuddyResponse
from app.prompts.library import BUDDY

# Soft cap on per-file content we ship in the workspace context. Beyond this
# Buddy doesn't need the whole file to suggest edits anyway, and we save tokens.
_MAX_FILE_CHARS = 8000


def _trim_workspace(ws: dict[str, str]) -> dict[str, str]:
    return {p: (c if len(c) <= _MAX_FILE_CHARS else c[:_MAX_FILE_CHARS] + "\n# ...(truncated)")
            for p, c in ws.items()}


async def run(req: BuddyRequest) -> BuddyResponse:
    history = [{"role": t.role, "content": t.content} for t in req.history[-12:]]
    workspace = _trim_workspace(req.workspace) if req.workspace else {}

    user = json.dumps(
        {
            "open_file": req.open_file,
            "selection": req.selection,
            "recent_chat": history,
            "workspace": workspace,
            "candidate_question": req.question,
        },
        indent=2,
    )
    data = await complete_json(BUDDY, user, temperature=0.7, max_tokens=4000)

    edits = [BuddyEdit(**e) for e in data.get("edits", [])]
    return BuddyResponse(
        hint=data["hint"],
        hint_level=data.get("hint_level", "nudge"),
        blocked=data.get("blocked", False),
        edits=edits,
    )
