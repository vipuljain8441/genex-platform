from __future__ import annotations

import unittest

from app.core.config import Settings


class LLMSettingsTests(unittest.TestCase):
    def test_local_type_maps_to_openai_compatible_provider(self) -> None:
        settings = Settings(
            _env_file=None,
            llm_type="local",
            llm_provider="groq",
        )
        self.assertEqual(settings.resolved_llm_provider, "openai_compatible")

    def test_bedrock_type_is_preferred_over_provider(self) -> None:
        settings = Settings(
            _env_file=None,
            llm_type="bedrock",
            llm_provider="openai_compatible",
        )
        self.assertEqual(settings.resolved_llm_provider, "bedrock")

    def test_bedrock_region_can_be_derived_from_api_base(self) -> None:
        settings = Settings(
            _env_file=None,
            llm_type="bedrock",
            llm_api_base="https://bedrock-runtime.ap-south-1.amazonaws.com/v1",
        )
        self.assertEqual(settings.resolved_bedrock_region, "ap-south-1")


if __name__ == "__main__":
    unittest.main()
