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
