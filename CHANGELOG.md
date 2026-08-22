# Changelog

All notable changes to this project will be documented in this file.

## [1.3.4] - 2026-08-22 "pure-rust-pdf-and-updater"

### Added
- **Pure-Rust PDF Engine (`lopdf`)**: Fully native, instant PDF page count parsing without any external Python dependency.
- **Smart Python Environment Discovery**: Automatically locates and verifies PyMuPDF (`fitz`) across `.venv`, Homebrew (`/opt/homebrew`), Pyenv, and custom Python environments.

## [1.3.3] - 2026-08-22 "batch-and-updater"

### Added
- **In-App Auto-Updater (`@tauri-apps/plugin-updater`)**:
  - Non-blocking, asynchronous background release check on app startup (0 ms UI delay).
  - Unobtrusive header notification button (`[✨ Update verfügbar!]`) next to the provider selector when a new version is released.
  - 1-click background download, signature verification (`minisign`), and automatic application restart (`relaunch()`).
  - Automated release artifact signing and `latest.json` manifest generation in GitHub Actions CI/CD.
- **Multi-File Batch Processing & Queue Dashboard**:
  - Drag & drop multiple PDF files or entire directories simultaneously into the Dropzone.
  - Interactive **Batch Queue Dashboard** with live slide count, per-document status badges (`⏳ Wartend`, `🔄 In Arbeit`, `✅ Gespeichert`, `❌ Fehler`), and clear/add actions.
  - **Automatic Fail-Safe Export**: Each converted Markdown file is automatically saved to disk next to the source PDF upon completion.
  - Python CLI support for batch folders via `--batch-dir <DIR>`.
- **Page Range Filter (Seitenbereich-Filter)**:
  - Support for converting targeted slide subsets (e.g. slides 10–25 of 80) in GUI and CLI (`--pages 10-25`, `--pages 1,3,5-7`).
  - Native instant PDF page count detection (`get_pdf_page_count_native`) without full rendering overhead.
  - Live cost & time savings preview in GUI (e.g. *"spart ~75% Kosten & Zeit"*).
- **Dynamic Estimated Time Remaining (ETA)**:
  - Real-time rolling average ETA calculation displayed directly in the progress bar (`Folie 12 von 45 • ⏱️ ~38s verbleibend`).
  - Global batch ETA in the queue header (`Dokument 2 von 5 • ⏱️ ~2m 15s verbleibend`).
- **Enhanced History Management & Single-Item Deletion**:
  - Dedicated trash button in the Markdown detail view toolbar to delete individual history entries.
  - Seamless vertical scrolling for long conversion histories (persisting up to 100 recent lectures).
  - Selected item highlighting and clean state reset.

### Changed & Optimized
- **Symmetric Layout Heights**: Synchronized vertical container heights between the left detail/dashboard view and the right history sidebar (`items-stretch h-[calc(100vh-80px)]`).
- **C-Speed In-Memory Hashing**: Optimized WebP slide hashing using `hashlib.sha256` directly during image compression, eliminating redundant base64 decoding and memory allocations.
- **Cached Runtime Binary Resolution**: Wrapped Python environment lookup in `std::sync::OnceLock` for instant 0 ms execution on subsequent slide and batch conversions.
- **Resilient 90s Client Timeouts**: Extended provider HTTP client timeouts to 90s for dense mathematical slides.
- **Frontend Codebase Polish**: Cleaned up unneeded imports, consolidated state management, and optimized render cycles.

## [1.2.1] - 2026-08-21

### Added
- **RustSec Security Audit**: Integrated automated `cargo audit` security scanning for all Rust dependencies in the GitHub Actions CI/CD release workflow.
- **Embedded Demo Video & Branding**: Added interactive native GitHub video player and centered app icon to README.
- **Enhanced Visual Transcription Prompt**: Refined system prompt to prevent combinatorial Mermaid graph loops on dense attention maps and bipartite scientific diagrams.

## [1.2.0] - 2026-08-21 "pure-rust-core"

### Added
- **Pure-Rust Core Engine**: Migrated the entire multimodal inference and PDF conversion pipeline to native Rust using `tokio` and `reqwest`.
- **In-Memory WebP Pipeline**: Replaced uncompressed PNGs with memory-efficient WebP encoding (Quality: 80), reducing payload size by ~80% and eliminating temporary disk I/O.
- **Content-Addressed Slide-Cache (SHA-256)**: Added instant local slide cache with 180-day (6 months) TTL and LRU eviction (0 ms, 0 Tokens, 0 € for repeated slides).
- **"Folien Cache leeren" Button**: Added slide-specific cache management with live storage stats in settings modal.
- **Instant Cancel Button**: Added conversion cancellation support with immediate background task abort and clean state reset.
- **Live In-Progress History Badge**: Real-time conversion tracking in the History sidebar with progress indicator (`Folie X/Y`).
- **Resilient Multi-Provider Rate Limiting**:
  - Google Gemini: 4.1s pacing rate limiter for free-tier quotas (15 RPM) and automatic 503/429 recovery.
  - OpenAI: Adaptive vision tiling (`detail: low` vs `high`) and fallback to `gpt-4o-mini` on rate limits.
  - Anthropic Claude & Mistral AI: Automatic model deprecation & quota fallback recovery.
- **LiteLLM Dynamic Cost Calculator**: Integrated official LiteLLM pricing matrix for accurate, model-specific cost estimation.
- **Scientific Visualization Optimization**: Streamlined system prompt for complex attention plots and bipartite figures.

## [1.1.2] - 2026-08-15

### Changed
- Updated project version to `v1.1.2` across core Python packages (`l2m_core`), Desktop GUI (`l2m-gui`), Tauri config, Rust dependencies, and package manifests (`pyproject.toml`, `package.json`, `tauri.conf.json`, `Cargo.toml`).

## [1.1.0] - 2026-08-14 "chronical-canical"

### Added
- **Multi-Provider Architecture**: Added full support for 4 major AI providers:
  - **Mistral AI**: Support for **`mistral-ocr-latest`** (specialized document OCR) and `pixtral-12b-2409`.
  - **Google Gemini**: Support for `gemini-2.0-flash` and `gemini-1.5-pro`.
  - **Anthropic Claude**: Support for `claude-3-7-sonnet` and `claude-3-5-haiku`.
  - **OpenAI**: Support for `gpt-4o` and `gpt-4o-mini`.
- **Modular Core Package (`l2m_core/`)**: Reorganized codebase into clean, maintainable modules (`config.py`, `pdf.py`, `security.py`, `converter.py`, `providers/`).
- **Desktop GUI Multi-Provider Tabs**: Added 4 provider tabs in Settings modal with individual API key stores and native validation.
- **Header Provider Switcher**: 1-click active provider switcher in the desktop navigation bar.
- **Subprocess Security Hardening**: Implemented strict canonical path verification (`std::fs::canonicalize`) for all Python binary and script invocations.

## [1.0.0] - 2026-08-14 "frosty-fox-gui"

### Added
- Official **v1.0.0 "frosty-fox-gui"** major release!
- Single-Source-of-Truth Architecture: Consolidated all CLI and GUI conversion logic directly into `lecture2md.py` with `--json-stream` support.
- Created brand new Desktop GUI application in `l2m-gui/` using **Tauri v2**, **Bun.js**, **React + TypeScript**, and **TailwindCSS**.
- Initial API Key onboarding modal with `client.models.list()` validation (0 Tokens cost) and link to OpenAI portal.
- Drag & Drop PDF uploader with German UI labels and native absolute file path resolution via Tauri dialogs.
- Real-time progress dashboard with live Hybrid Routing badges (`gpt-4o-mini` vs `gpt-4o`) and estimated API cost calculator.
- Markdown Live Preview with 1-click **"Markdown kopieren"** (full document ChatGPT clipboard) and native **"Markdown speichern"** OS dialogs.
- **Anti-AI Canary & Trap Filtering**: Enhanced System Prompt security rules in `lecture2md.py` and `lecture2md_gui.py` to automatically detect, ignore, and strip out hidden professor anti-AI traps, micro-text, and canary instructions from generated Markdown files.
- History sidebar for recent conversion tracking.
- Multi-Platform GitHub Actions CI/CD pipeline generating `.msi` (Windows) and `.dmg` (macOS) installers.
- Developed on feature branch `feature/frosty-fox-gui`.

## [0.5.0] - 2026-08-13

### Added
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
