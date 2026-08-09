# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-08-09

### Added
- Open-Source readiness with `.gitignore`, MIT License (`LICENSE`), and GitHub Actions release workflow (`.github/workflows/release.yml`).
- Dedicated folder structure: `lectures/` for input PDF files and `output/` for output Markdown files (with `.gitkeep`).
- `ensure_project_directories()` helper function to automatically create missing project directories.

## [0.3.1] - 2026-08-09

### Changed
- Updated OpenAI API `temperature` parameter from `0.2` to `0.0` for 100% deterministic, strict document transcription and zero creative variance.

## [0.3.0] - 2026-08-09

### Added
- Explicit slide Markdown anchors (`## [Folie X]`) replacing hidden HTML comments for immediate ChatGPT context targeting.
- Hybrid Routing (`select_model_for_page`) via PyMuPDF pre-analysis: automatically routes text-only slides to `gpt-4o-mini` and complex visual slides to `gpt-4o`, cutting API costs by up to 80%.

## [0.2.0] - 2026-08-09

### Added
- PDF validity pre-flight check (`validate_pdf_document`) to detect encrypted (`doc.is_encrypted`) or empty PDF files and terminate with clear error messages before starting threads.
- PDF metadata extraction (`format_metadata_header`, `extract_pdf_title`, `extract_pdf_author`) to automatically build a clean Markdown header with title, author, and source filename.

## [0.1.0] - 2026-08-02

### Added
- Initial prototype for converting PDF lecture slides to Markdown using OpenAI Vision API (`gpt-4o`).
- Mermaid.js diagram synthesis and explicit visual label transcription.
- ThreadPoolExecutor parallel processing with tenacity rate limit retries.
- `pyproject.toml` and `uv.lock` for Astral `uv` package management.
- Clean Code structure, `MODULES.md`, `NOTE.md`, and `README.md`.
