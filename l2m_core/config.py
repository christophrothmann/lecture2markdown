import os
import argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Supported Providers
PROVIDER_OPENAI = "openai"
PROVIDER_GOOGLE = "google"
PROVIDER_ANTHROPIC = "anthropic"
PROVIDER_MISTRAL = "mistral"

# Default Model Mappings (Fast/Text vs Visual/Complex)
PROVIDER_MODELS = {
    PROVIDER_OPENAI: {
        "fast": "gpt-4o-mini",
        "visual": "gpt-4o",
    },
    PROVIDER_GOOGLE: {
        "fast": "gemini-2.0-flash",
        "visual": "gemini-1.5-pro",
    },
    PROVIDER_ANTHROPIC: {
        "fast": "claude-3-5-haiku-latest",
        "visual": "claude-3-7-sonnet",
    },
    PROVIDER_MISTRAL: {
        "fast": "pixtral-12b-2409",
        "visual": "mistral-ocr-latest",
    },
}

# Environment Variable Names per Provider
PROVIDER_ENV_KEYS = {
    PROVIDER_OPENAI: "OPENAI_API_KEY",
    PROVIDER_GOOGLE: "GEMINI_API_KEY",
    PROVIDER_ANTHROPIC: "ANTHROPIC_API_KEY",
    PROVIDER_MISTRAL: "MISTRAL_API_KEY",
}

DEFAULT_PROVIDER = PROVIDER_OPENAI
DEFAULT_LECTURES_DIR = "lectures"
DEFAULT_OUTPUT_DIR = "output"
DEFAULT_INPUT_FILE = "input.pdf"
DEFAULT_OUTPUT_FILE = "output.md"
DPI = 200
DEFAULT_WORKERS = 3

def parse_cli_arguments():
    parser = argparse.ArgumentParser(description="Lecture2Markdown: Multi-provider academic PDF to Markdown converter.")
    parser.add_argument("--pdf", type=str, default=None, help="Path to input PDF file")
    parser.add_argument("--output", type=str, default=None, help="Path to output Markdown file")
    parser.add_argument("--provider", type=str, default=DEFAULT_PROVIDER, choices=[PROVIDER_OPENAI, PROVIDER_GOOGLE, PROVIDER_ANTHROPIC, PROVIDER_MISTRAL], help="AI Provider to use")
    parser.add_argument("--api-key", type=str, default=None, help="API Key for the chosen provider")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Parallel worker threads")
    parser.add_argument("--pages", type=str, default=None, help="Page range to convert (e.g. '10-25', '5', '1-10')")
    parser.add_argument("--batch-dir", type=str, default=None, help="Process all PDF files in the specified directory")
    parser.add_argument("--hybrid", action="store_true", default=True, help="Enable automatic hybrid model routing")
    parser.add_argument("--json-stream", action="store_true", default=False, help="Stream JSON events for GUI/IPC")
    return parser.parse_args()

def resolve_provider_api_key(provider: str, cli_key: str | None = None) -> str | None:
    if cli_key and cli_key.strip():
        return cli_key.strip()
    env_var_name = PROVIDER_ENV_KEYS.get(provider, "OPENAI_API_KEY")
    key = os.getenv(env_var_name) or os.getenv("OPENAI_API_KEY")
    return key.strip() if key else None
