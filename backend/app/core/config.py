from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
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


settings = Settings()
