"""Email delivery for candidate invites.

Uses Resend (https://resend.com) when `RESEND_API_KEY` is set. Falls back to a
no-op send so the rest of the invite flow still works for local dev — the
employer can copy the invite URL from the UI manually.
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings
from app.models.schemas import Assessment, Invite

log = logging.getLogger(__name__)


def invite_url(invite: Invite) -> str:
    base = settings.app_base_url.rstrip("/")
    return f"{base}/candidate/invite/{invite.token}"


def _html_body(invite: Invite, assessment: Assessment, url: str) -> str:
    job = assessment.job
    name = invite.candidate_name or invite.candidate_email.split("@")[0]
    # Per spec — no task specifics in the invite.
    return f"""<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background:#faf8f3; padding:40px 20px; color:#0f0f17;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:20px; padding:36px 32px; box-shadow:0 12px 40px -16px rgba(15,15,23,0.10);">
    <div style="font-family: 'Bricolage Grotesque', sans-serif; font-size:14px; color:#7c3aed; letter-spacing:0.18em; text-transform:uppercase; margin-bottom:6px;">GenEx · SkillBrew</div>
    <h1 style="margin:0 0 14px 0; font-size:26px; line-height:1.15; letter-spacing:-0.01em;">Hi {name}, your assessment is ready.</h1>
    <p style="margin:0 0 18px 0; line-height:1.55; color:#52525b;">
      You've been invited to take a <strong style="color:#0f0f17;">{job.title}</strong> assessment.
      It's a live, hands-on simulation — a real codebase, a Jira-style ticket, and a buddy AI on call.
    </p>
    <p style="margin:0 0 22px 0; line-height:1.55; color:#52525b;">
      <strong style="color:#0f0f17;">~{job.duration_minutes} minutes</strong>. Pick a quiet block when you can focus.
    </p>
    <a href="{url}" style="display:inline-block; background:#7c3aed; color:#fff; text-decoration:none; padding:13px 22px; border-radius:12px; font-weight:600; font-size:15px;">Start assessment →</a>
    <p style="margin-top:28px; font-size:12px; color:#a1a1aa; line-height:1.5;">
      Or open this link in your browser:<br/>
      <span style="font-family:monospace; word-break:break-all; color:#52525b;">{url}</span>
    </p>
    <hr style="border:none; border-top:1px solid rgba(15,15,23,0.08); margin:28px 0;"/>
    <p style="margin:0; font-size:11px; color:#a1a1aa; letter-spacing:0.04em;">
      Sent by GenEx — the assessment platform from SkillBrew.
    </p>
  </div>
</body></html>"""


async def send_invite_email(invite: Invite, assessment: Assessment) -> tuple[bool, str | None]:
    """Returns (sent_ok, error_message). Never raises."""
    url = invite_url(invite)
    if not settings.resend_api_key:
        log.info(
            "RESEND_API_KEY not set — skipping email for %s. Invite URL: %s",
            invite.candidate_email, url,
        )
        return False, "email provider not configured (link still works)"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.resend_from_email,
                    "to": [invite.candidate_email],
                    "subject": f"Your {assessment.job.title} assessment is ready",
                    "html": _html_body(invite, assessment, url),
                },
            )
        if resp.status_code >= 400:
            return False, f"resend {resp.status_code}: {resp.text[:200]}"
        return True, None
    except Exception as e:
        log.exception("send_invite_email failed")
        return False, f"{type(e).__name__}: {e}"
