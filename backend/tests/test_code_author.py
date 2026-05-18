from __future__ import annotations

import unittest

from app.agents import code_author
from app.models.schemas import ExtractedContext, JobSpec, RoleFamily


def make_context() -> ExtractedContext:
    return ExtractedContext(
        sample_tickets=[{"title": "Stabilize scheduling flow", "key": "OPS-12", "type": "bug", "summary": ""}],
        tech_signals=["python", "fastapi", "react", "typescript"],
        domain_summary="The team owns operational workflows and scheduling reliability.",
    )


class CodeAuthorFallbackTests(unittest.TestCase):
    def test_backend_fallback_includes_requirements_and_setup(self) -> None:
        job = JobSpec(
            title="Platform API Engineer",
            role_family=RoleFamily.BACKEND,
            seniority="mid",
            industry="Devtools",
            must_have_skills=["Python", "FastAPI"],
            nice_to_have_skills=["PostgreSQL"],
            jd_text="Build APIs and improve service reliability.",
            duration_minutes=60,
            pm_tool="none",
        )

        codebase = code_author._build_fallback_codebase(job, make_context(), "test")

        self.assertTrue(any(file.path == "requirements.txt" for file in codebase.files))
        self.assertIn("pip install -r requirements.txt", codebase.setup_instructions)

    def test_frontend_fallback_includes_package_bootstrap(self) -> None:
        job = JobSpec(
            title="Frontend Engineer",
            role_family=RoleFamily.FRONTEND,
            seniority="mid",
            industry="SaaS",
            must_have_skills=["React", "TypeScript"],
            nice_to_have_skills=["Vite"],
            jd_text="Build polished frontend experiences.",
            duration_minutes=60,
            pm_tool="none",
        )

        codebase = code_author._build_fallback_codebase(job, make_context(), "test")
        paths = {file.path for file in codebase.files}

        self.assertIn("package.json", paths)
        self.assertIn("tsconfig.json", paths)
        self.assertIn("index.html", paths)
        self.assertIn("src/main.tsx", paths)
        self.assertIn("npm install", codebase.setup_instructions)


if __name__ == "__main__":
    unittest.main()
