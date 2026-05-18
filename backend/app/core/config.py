import os
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict


def _extract_bedrock_region(base_url: str) -> str:
    host = (urlparse(base_url).hostname or "").strip().lower()
    if host.startswith("bedrock-runtime."):
        parts = host.split(".")
        return parts[1] if len(parts) > 1 else ""
    if host.startswith("bedrock-mantle."):
        parts = host.split(".")
        return parts[1] if len(parts) > 1 else ""
    return ""


class Settings(BaseSettings):
    store_backend: str = "memory"
    database_url: str = ""

    llm_type: str = ""
    llm_provider: str = "groq"
    llm_api_key: str = ""
    llm_model: str = "llama-3.3-70b-versatile"
    llm_api_base: str = ""
    bedrock_region: str = ""
    bedrock_auth_mode: str = "auto"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_session_token: str = ""
    aws_region: str = ""
    aws_default_region: str = ""

    # Backward-compatible aliases for the original Groq-only setup.
    groq_api_key: str = ""
    groq_model: str = ""
    allow_origins: str = "http://localhost:3000"
    allow_origin_regex: str = ""
    log_level: str = "INFO"

    # Where the candidate-facing app lives. Embedded in invite emails.
    app_base_url: str = "http://localhost:3000"

    # Sandbox (code-server) settings
    # sandbox_sessions_dir: where the backend WRITES files (host/container path)
    # sandbox_vscode_root:  path to that same dir AS SEEN BY code-server (may differ!)
    #   Leave empty to default to sandbox_sessions_dir (correct when both run on same host)
    #   Docker Compose: SANDBOX_SESSIONS_DIR=/sessions, SANDBOX_VSCODE_ROOT=/home/coder/sessions
    sandbox_sessions_dir: str = "/tmp/genex-sessions"
    sandbox_vscode_root: str = ""
    sandbox_url: str = "http://localhost:8080"
    sandbox_sync_url: str = "http://localhost:8081"

    @property
    def resolved_vscode_root(self) -> str:
        return self.sandbox_vscode_root.strip() or self.sandbox_sessions_dir

    # Email provider — Resend. If unset, invites are created but no email is
    # sent; the employer can copy the link from the UI instead.
    # Optional GitHub personal access token — raises rate-limit from 60 to 5000 req/hr
    github_token: str = ""

    resend_api_key: str = ""
    resend_from_email: str = "GenEx <onboarding@resend.dev>"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        if self.allow_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.allow_origins.split(",") if o.strip()]

    @property
    def cors_allow_all(self) -> bool:
        return self.allow_origins.strip() == "*" or self.allow_origin_regex.strip() == "*"

    @property
    def resolved_llm_provider(self) -> str:
        provider = (self.llm_type or self.llm_provider).strip().lower()
        if provider == "local":
            return "openai_compatible"
        return provider

    @property
    def resolved_llm_api_key(self) -> str:
        provider = self.resolved_llm_provider
        if provider == "groq":
            return self.groq_api_key or self.llm_api_key
        if provider == "bedrock":
            return (
                self.llm_api_key.strip()
                or os.getenv("AWS_BEARER_TOKEN_BEDROCK", "").strip()
            )
        return self.llm_api_key or self.groq_api_key

    @property
    def resolved_llm_model(self) -> str:
        if self.resolved_llm_provider == "groq":
            return self.groq_model or self.llm_model
        return self.llm_model or self.groq_model

    @property
    def resolved_bedrock_auth_mode(self) -> str:
        mode = self.bedrock_auth_mode.strip().lower() or "auto"
        if mode in {"auto", "iam", "api_key"}:
            return mode
        return "auto"

    @property
    def resolved_bedrock_region(self) -> str:
        candidates = (
            self.bedrock_region,
            self.aws_region,
            self.aws_default_region,
            os.getenv("AWS_REGION", ""),
            os.getenv("AWS_DEFAULT_REGION", ""),
            _extract_bedrock_region(self.llm_api_base),
        )
        for candidate in candidates:
            if candidate and candidate.strip():
                return candidate.strip()
        return ""


settings = Settings()
