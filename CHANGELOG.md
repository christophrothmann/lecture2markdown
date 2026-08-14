# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-08-14 "frosty-fox-gui"

### Added
- Official **v1.0.0 "frosty-fox-gui"** major release!
- Created brand new Desktop GUI application in `l2m-gui/` using **Tauri v2**, **Bun.js**, **React + TypeScript**, and **TailwindCSS**.
- Initial API Key onboarding modal with `client.models.list()` validation (0 Tokens cost) and link to OpenAI portal.
- Drag & Drop PDF uploader with German UI labels and native absolute file path resolution via Tauri dialogs.
- Real-time progress dashboard with live Hybrid Routing badges (`gpt-4o-mini` vs `gpt-4o`) and estimated API cost calculator.
- Markdown Live Preview with 1-click **"Markdown kopieren"** (full document ChatGPT clipboard) and native **"Markdown speichern"** OS dialogs.
- **Anti-AI Canary & Trap Filtering**: Enhanced System Prompt security rules in `lecture2md.py` and `lecture2md_gui.py` to automatically detect, ignore, and strip out hidden professor anti-AI traps, micro-text, and canary instructions from generated Markdown files.
- History sidebar for recent conversion tracking.
- Multi-Platform GitHub Actions CI/CD pipeline generating `.msi` (Windows) and `.dmg` (macOS) installers.
- Developed on feature branch `feature/frosty-fox-gui`.

## [0.4.4] - 2026-08-09

### Added
- Added explicit **Legal Disclaimer & Copyright Notice** section to `README.md` clarifying user copyright responsibilities, personal study scope, and author liability limitation.
- Fixed GitHub Actions release workflow (`.github/workflows/release.yml`) using `uv venv` and `uvx` for automated `bandit` and `pip-audit` security scans.

## [0.4.0] - 2026-08-09

### Added
- Professional English Open-Source `README.md` with feature badges, setup instructions, and configuration guide.
- Automated Security CI/CD Pipeline in `.github/workflows/release.yml`:
  - Secret scanning via `gitleaks`.
  - Static Application Security Testing (SAST) via `bandit`.
  - Dependency vulnerability auditing via `pip-audit`.
- Open-Source readiness with `.gitignore`, MIT License (`LICENSE`), and GitHub Actions release workflow.
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
