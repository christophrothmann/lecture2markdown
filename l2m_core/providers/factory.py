from ..config import (
    PROVIDER_OPENAI,
    PROVIDER_GOOGLE,
    PROVIDER_ANTHROPIC,
    PROVIDER_MISTRAL,
)
from .base import BaseProvider
from .openai_provider import OpenAIProvider
from .gemini_provider import GeminiProvider
from .anthropic_provider import AnthropicProvider
from .mistral_provider import MistralProvider

def get_provider(provider_name: str, api_key: str) -> BaseProvider:
    clean_name = (provider_name or PROVIDER_OPENAI).strip().lower()
    
    if clean_name == PROVIDER_GOOGLE:
        return GeminiProvider(api_key)
    elif clean_name == PROVIDER_ANTHROPIC:
        return AnthropicProvider(api_key)
    elif clean_name == PROVIDER_MISTRAL:
        return MistralProvider(api_key)
    elif clean_name == PROVIDER_OPENAI:
        return OpenAIProvider(api_key)
    else:
        raise ValueError(f"Unknown AI Provider: '{provider_name}'. Supported: openai, google, anthropic, mistral.")
