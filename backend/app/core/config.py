from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    store_backend: str = "memory"
    database_url: str = ""

    llm_provider: str = "groq"
    llm_api_key: str = ""
    llm_model: str = "llama-3.3-70b-versatile"
    llm_api_base: str = ""

    # Backward-compatible aliases for the original Groq-only setup.
    groq_api_key: str = ""
    groq_model: str = ""
    allow_origins: str = "http://localhost:3000"
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
    resend_api_key: str = ""
    resend_from_email: str = "GenEx <onboarding@resend.dev>"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allow_origins.split(",") if o.strip()]

    @property
    def resolved_llm_api_key(self) -> str:
        if self.llm_provider.strip().lower() == "groq":
            return self.groq_api_key or self.llm_api_key
        return self.llm_api_key or self.groq_api_key

    @property
    def resolved_llm_model(self) -> str:
        if self.llm_provider.strip().lower() == "groq":
            return self.groq_model or self.llm_model
        return self.llm_model or self.groq_model


settings = Settings()
