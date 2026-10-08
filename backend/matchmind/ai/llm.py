"""Chat-client factory. Microsoft Foundry first; other OpenAI-compatible endpoints for development."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass
class ModelConfig:
    client: Any | None
    provider: str
    model: str | None

    @property
    def available(self) -> bool:
        return self.client is not None


def make_client() -> ModelConfig:
    provider = os.getenv("LLM_PROVIDER", "auto").lower()

    if provider in ("foundry", "auto") and os.getenv("FOUNDRY_PROJECT_ENDPOINT"):
        from agent_framework.foundry import FoundryChatClient
        from azure.identity import DefaultAzureCredential

        model = os.getenv("FOUNDRY_MODEL", "gpt-4.1-mini")
        return ModelConfig(
            FoundryChatClient(project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"], model=model,
                              credential=DefaultAzureCredential()),
            "Microsoft Foundry", model)

    if provider in ("azure_openai", "auto") and os.getenv("AZURE_OPENAI_ENDPOINT"):
        from agent_framework.openai import OpenAIChatCompletionClient

        model = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini")
        kwargs: dict[str, Any] = {"model": model, "azure_endpoint": os.environ["AZURE_OPENAI_ENDPOINT"],
                                  "api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")}
        if os.getenv("AZURE_OPENAI_API_KEY"):
            kwargs["api_key"] = os.environ["AZURE_OPENAI_API_KEY"]
        else:
            from azure.identity import DefaultAzureCredential

            kwargs["credential"] = DefaultAzureCredential()
        return ModelConfig(OpenAIChatCompletionClient(**kwargs), "Azure OpenAI (Foundry)", model)

    if provider in ("openai", "auto") and os.getenv("OPENAI_API_KEY"):
        from agent_framework.openai import OpenAIChatCompletionClient

        model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        return ModelConfig(OpenAIChatCompletionClient(model=model, api_key=os.environ["OPENAI_API_KEY"],
                                                      base_url=os.getenv("OPENAI_BASE_URL")), "OpenAI-compatible",
                           model)

    return ModelConfig(None, "template", None)
