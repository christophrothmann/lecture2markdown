import sys
from pathlib import Path
from l2m_core.config import (
    parse_cli_arguments,
    resolve_provider_api_key,
    DEFAULT_LECTURES_DIR,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_INPUT_FILE,
    DEFAULT_OUTPUT_FILE,
    PROVIDER_ENV_KEYS,
)
from l2m_core.providers import get_provider
from l2m_core.converter import execute_conversion, emit_event

def main():
    args = parse_cli_arguments()
    api_key = resolve_provider_api_key(args.provider, args.api_key)

    if not api_key:
        env_name = PROVIDER_ENV_KEYS.get(args.provider, "API_KEY")
        err_msg = f"API Key for provider '{args.provider}' not found. Please set {env_name} or pass --api-key."
        if args.json_stream:
            emit_event("error", {"message": err_msg})
        sys.exit(f"Error: {err_msg}")

    if args.pdf:
        input_pdf_path = Path(args.pdf)
    else:
        input_pdf_path = Path(DEFAULT_LECTURES_DIR) / DEFAULT_INPUT_FILE

    if args.output:
        output_md_path = Path(args.output)
    else:
        output_md_path = Path(DEFAULT_OUTPUT_DIR) / DEFAULT_OUTPUT_FILE

    if not input_pdf_path.exists():
        err_msg = f"Input file '{input_pdf_path}' not found."
        if args.json_stream:
            emit_event("error", {"message": err_msg})
        sys.exit(f"Error: {err_msg}")

    try:
        provider = get_provider(args.provider, api_key)
        execute_conversion(
            pdf_path=input_pdf_path,
            output_path=output_md_path,
            provider=provider,
            workers=args.workers,
            hybrid=args.hybrid,
            pages=args.pages,
            json_stream=args.json_stream
        )
    except Exception as e:
        if args.json_stream:
            emit_event("error", {"message": str(e)})
        raise e

if __name__ == "__main__":
    main()