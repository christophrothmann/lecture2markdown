# Changelog

All notable changes to this project will be documented in this file.

## [1.6.2] - 2026-09-13 "native-clipboard-crossplatform"

### Fixed & Improved
- **📋 Native Dual-Format Cocoa Pasteboard Bridge on macOS (`macos_clipboard.m`)**:
  - Replaced the short-lived `osascript` subprocess with a native Objective-C Cocoa bridge compiled directly via `cc` and linked against `AppKit`.
  - Fixes clipboard loss on modern macOS (Sonoma / Sequoia) where `osascript` process exit immediately caused macOS `pboard` to purge lazy file URL promises.
  - Registers both file representations (`public.file-url`, `NSFilenamesPboardType`) and full UTF-8 Markdown text (`public.utf8-plain-text`, `NSStringPboardType`) simultaneously via `[NSPasteboard writeObjects:]`.
  - Guarantees seamless file attachments (file upload pill) in web apps and messengers (ChatGPT, Claude, Gemini, Slack, Discord) while supporting direct Markdown text pasting in standard editors.
- **🪟 Hardened Dual-Format Windows Clipboard Hand-off (`commands/fs.rs`)**:
  - Upgraded Windows clipboard integration to `.NET System.Windows.Forms.DataObject` in STA mode, registering both FileDrop (`CF_HDROP`) and UTF-8 text (`CF_UNICODETEXT`).
  - Switched to `-LiteralPath` with single-quote escaping to prevent PowerShell syntax and wildcard errors on paths containing brackets, apostrophes, or wildcards (e.g. `[CS101] Vorlesung.md`).
  - Automatic fallback to `Set-Clipboard -LiteralPath` in restricted shell environments.
- **🏷️ Clean Filename Stem Normalization**:
  - Fixed duplicate extensions (`.md.md`) in `MarkdownPreview.tsx` and `QuickDropOverlay.tsx` by stripping both `.pdf` and `.md` prior to appending the file extension.

## [1.6.1] - 2026-09-10 "perf-compression-and-history-cleanup"

### Added & Improved
- **⚡ SQLite Slide-Cache with WAL Mode (`slide_cache.db`)**:
  - Replaced the file-based `.l2m_slide_cache.json` with an atomic, thread-safe SQLite database (`slide_cache.db`) powered by `rusqlite`.
  - Configured with `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;` to support parallel worker streams without race conditions.
  - Automatic, non-destructive migration on first launch: existing entries in `.l2m_slide_cache.json` are seamlessly imported while leaving the JSON file intact on disk as a rollback safety net.
  - Automatic LRU eviction capped at 2,000 entries and 180-day TTL cleanup on writes, with `VACUUM;` compaction support.
- **📦 Client-Streaming WebP Compression & Dynamic Multi-Provider MIME Detection**:
  - Standardized client-side slide rendering on WebP format with quality `0.82` and maximum dimension `1600px`, reducing network payload per slide by **~35–40%** while preserving pristine OCR accuracy.
  - Implemented dynamic magic-byte MIME detection (`detect_mime_type`) in Rust (`providers/mod.rs`) and Python (`l2m_core/pdf.py`).
  - Corrected all four vision providers (OpenAI, Anthropic Claude, Google Gemini, Mistral AI) to transmit precise MIME types, preventing API errors with strict providers like Claude and Gemini.
- **🐍 Python CLI Payload Optimization (`l2m_core/pdf.py`)**:
  - Switched PyMuPDF slide rasterization from uncompressed PNG to JPEG quality `85` (`pixmap.tobytes("jpg", jpg_quality=85)`), reducing Base64 upload payload by **~70%**.
- **🧠 Bounded Memory Management (LRU & Explicit Teardown)**:
  - `pdfDocCache` in `pdfRenderer.ts` now enforces an LRU limit of **2 loaded PDF documents**; evicted documents explicitly call `doc.destroy()` to immediately release worker threads and memory buffers.
  - History hover preview cache (`cacheRef`) is now bounded to an LRU cap of **50 entries**.

### Fixed
- **🎯 Immediate History Hover Preview Cleanup on Item Selection**:
  - Fixed an issue where selecting a history entry left the floating hover preview visible over the opened detail view.
  - Added `forceClosePreview()` to immediately abort active hover/close timers and destroy the preview state on click.
  - Bound the preview lifecycle directly to the sidebar drawer state (`isOpen={isHistoryOpen}`), guaranteeing instant teardown whenever the sidebar closes.

## [1.6.0] - 2026-09-07 "native-apkg-and-learning-suite"

### Added
- **🃏 Native Rust `.apkg` Deck Engine (Zero Python / Zero AnkiConnect Required)**:
  - High-performance, pure-Rust `.apkg` packager (`anki_apkg.rs`) built using `rusqlite`, `zip`, and `sha1`.
  - Generates 100% compliant Anki `.apkg` packages containing SQLite databases (`col`, `notes`, `cards`), `media` mappings, and embedded high-resolution WebP slide images.
  - Native note types: `Lecture2Markdown - Active Recall` (with collapsible slide context on back) and `Lecture2Markdown - Image Occlusion`.
  - 1-Click "In Anki öffnen" directly launches the default Anki installation across macOS and Windows with the generated `.apkg` package.
  - Optional AnkiConnect sync (`localhost:8765`) preserved as 1-click alternative.
- **🖥️ Integrated Flashcard Inspector Tab (`FlashcardInspectorTab.tsx`)**:
  - Replaced isolated export modals with a first-class segmented control view: `[ 📝 Markdown | 🔀 Split-Screen | 🃏 Lernkarten (count) ]`.
  - Slide-synchronized view: left side displays the PDF slide via Mozilla PDF.js, right side provides editable flashcards for that slide.
  - Card type filters (Definitions, Cloze deletions, LaTeX Formulas, Image Occlusion), inline front/back editing, card toggling, and addition/deletion.
- **🖼️ Visual Image Occlusion Builder (`ImageOcclusionCanvas.tsx`)**:
  - Interactive SVG/Canvas overlay directly over the rendered PDF slide canvas.
  - Draw custom rectangular occlusion masks over complex diagrams, anatomical illustrations, and architectural schematics.
  - Supports "Hide One, Guess One" and "Hide All, Guess One" mask modes with direct native `.apkg` export.
- **🔍 Interactive Multi-Slide History Hover Preview**:
  - Hovering over entries in the History Sidebar reveals an interactive flyout that persists when moving the mouse into the preview card (300 ms close grace period + hit-test bridge).
  - Displays Slide 1, Slide 2, and subsequent slides in a smooth, scrollable container (`overscroll-contain`).
  - Includes quick "Öffnen" button in the preview header to immediately load the selected document.

### Improved & Fixed
- **📂 Multi-File Batch Queue Usability**:
  - Batch queue remains persistently visible during conversion so students can monitor overall progress across multiple files.
  - Real-time pipeline status (`Wird konvertiert (3/40)` and `In Warteschlange`) is visible directly within the History Sidebar.
  - Pending items can be individually deleted from the queue even while conversion is actively running.
  - Completed batch rows are directly clickable anywhere on the card to open their detail view.
  - "Zurück zur Batch-Übersicht" button automatically hides once all documents in the batch have finished.
- **🛡️ Deactivation of Automatic Background File Saving**:
  - Completely stopped writing automatic `.md` files into the source PDF folder in the background to prevent cluttering downloads, cloud sync folders (Dropbox, OneDrive, iCloud), or read-only network shares.
  - Files are now persisted to disk only when explicitly chosen via the "Speichern" button.
- **🏗️ Rust Backend & Frontend Modularization**:
  - Refactored monolithic `main.rs` into specialized command modules under `commands/`: `transcription.rs`, `fs.rs`, `export.rs`, `keys.rs`, `cache.rs`, `pdf.rs`.
  - Extracted modular subcomponents for the flashcard inspector under `components/flashcards/` (`FlashcardHeader.tsx`, `FlashcardList.tsx`, `FlashcardSlideViewer.tsx`, `OcclusionToolbar.tsx`).

## [1.5.3] - 2026-09-04 "anki-export-and-base64-fix"

### Fixed
- **🃏 Anki Deck Export**:
  - Fixed native Rust file saving handler for Anki decks and added safe fallbacks.
  - Added null-safety and default title handling to card tag sanitization (`sanitizeTag`).
- **🖼️ Universal Vision API Image Sanitization**:
  - Enforced crisp white background rendering on canvas export to prevent transparent PDF backgrounds from turning dark.
  - Corrected base64 prefix handling across OpenAI, Anthropic Claude, Google Gemini, and Mistral OCR to eliminate `invalid_base64` API errors.
- **🎛️ Header Navigation**:
  - Converted the active model badge into a clean, non-clickable status indicator to avoid confusion with the settings modal button.

## [1.5.2] - 2026-08-28 "zero-config-standalone-engine"

### Added & Improved
- **🚀 100% Zero-Config Client-Side PDF Engine (Zero Python Required)**:
  - Transitioned desktop slide rendering entirely to the bundled, high-performance Mozilla PDF.js engine.
  - Generates high-resolution WebP slide representations directly in-memory and streams them to the native async Rust transcription pipeline.
  - Completely eliminates the need for Python, PyMuPDF, or Pillow installations on user machines — the desktop app is now 100% standalone out-of-the-box on Windows 11, macOS, and Linux.

## [1.5.1] - 2026-08-28 "windows-hotfix-and-drag-drop"

### Fixed
- **🪟 Windows 11 Subprocess Isolation (`CREATE_NO_WINDOW`)**:
  - Attached `0x08000000 (CREATE_NO_WINDOW)` creation flags to all Rust subprocess invocations (Python slide rendering and PowerShell clipboard handler).
  - Completely eliminates flashing `cmd.exe` terminal window popups during PDF conversion.
- **📂 Native Windows Drag & Drop**:
  - Replaced browser-level HTML5 drag events with Tauri's native `getCurrentWebview().onDragDropEvent` in `Dropzone.tsx`.
  - Fixes drag-and-drop file imports on Microsoft WebView2 / Windows 11 where browser security strips local file paths.
- **⌨️ Platform-Aware Shortcuts**:
  - Automatically displays `Ctrl + Shift + L` (and `Ctrl + V`) on Windows / Linux and `⌘ + ⇧ + L` on macOS.
- **🎛️ Provider Selector Indicator**:
  - Cleaned up the active provider pill in the navigation header to avoid confusing dropdown indicators.

## [1.5.0] - 2026-08-26 "internationalization-and-ui-polish"

### Added
- **🌐 Full Internationalization (i18n)**:
  - Integrated `i18next`, `react-i18next`, and `i18next-browser-languagedetector` with comprehensive dictionaries for both **German 🇩🇪** and **English 🇬🇧**.
  - Interactive language switcher in Settings modal with seamless, zero-reload runtime language toggle.
  - Automatic initial OS language detection with persistent user choice in `localStorage`.
  - 100% translation coverage across all UI modules: Header, Dropzone, Multi-File Batch Queue, Split-Screen Viewer, History Sidebar, and Spotlight Quick-Drop Widget.

### Improved & Fixed
- **🎛️ Settings Modal UX & Embedded Scrollbar**:
  - Padded internal scroll container with fixed header, keeping the close button (`✕`) and title persistently in view on small laptop screens and low window heights.
  - Fixed API key test validation handler integration with native Rust backend (`validate_api_key_native`).
  - Preserved active test feedback banner visibility on successful key validation.

## [1.4.2] - 2026-08-26 "free-tier-highlight-and-code-splitting"

### Added
- **🆓 Prominent Mistral AI Free-Tier Integration**:
  - Added a distinct green `FREE` pill directly on the Mistral AI provider tab and upgraded its badge to `🆓 Kostenlos (Free-Tier) • OCR`.
  - Added an in-modal student onboarding tip explaining that students can convert lectures completely free of charge using `console.mistral.ai` without needing pre-funded credit or credit cards.
  - Direct 1-click link to create free Mistral API keys.
- **⚡ Dynamic Code-Splitting & Startup Boost**:
  - Implemented `React.lazy()` and `<Suspense>` for heavy UI modules: `MarkdownPreview.tsx` (KaTeX, Mermaid.js, PDF.js), `ApiKeyModal.tsx`, and `QuickDropOverlay.tsx`.
  - Reduced the initial app bundle size from **710 kB down to 183 kB (~74% reduction)**, boosting desktop launch time down to ~4 ms.

## [1.4.1] - 2026-08-23 "dynamic-version-injection"

### Added
- **Dynamic Version Injection (`__APP_VERSION__`)**:
  - Configured Vite build system to automatically inject the application version at compile time from `package.json`.
  - Replaced hardcoded version text in the header with dynamic `v{__APP_VERSION__}`.

## [1.4.0] - 2026-08-23 "mental-load-reduction"

### Added
- **⚡ Spotlight Quick-Drop Widget (`⌘ + ⇧ + L` / `Ctrl + Shift + L`)**:
  - Global OS-wide keyboard shortcut registered via native Rust backend that brings the app to the foreground and opens an Apple Spotlight-inspired quick conversion modal from any active application (Chrome, Safari, Obsidian, Finder).
  - Drag & drop a lecture PDF into the dropzone (or pick a file) for automated background conversion.
  - Automatically saves the Markdown file next to the source PDF and copies it as an OS file descriptor directly into the system clipboard.
  - Audio chime feedback, native macOS notifications, and animated live progress bar with slide count.
- **🖥️ 100% Zero-Config Client-Side PDF Rendering (Mozilla PDF.js)**:
  - Slide preview in Split-Screen view now renders client-side via Mozilla PDF.js directly onto HTML5 `<canvas>`.
  - Works with **0 Python**, **0 PyMuPDF**, and **0 terminal setup** on every student laptop out of the box.
  - Bundled offline Web Worker (`pdf.worker.min.mjs`) supporting full offline operation without internet or external font CDNs.
- **🃏 1-Click Anki Deck Export**:
  - Instant conversion of lecture notes into structured, Anki-ready flashcards (`.txt` TSV export).
  - Automatically generates Definition Cards (`**Term**: Definition`), Formula Cards (LaTeX KaTeX/MathJax `\[...\]`), and Core Slide Takeaways.
  - Native file saving with interactive in-app toast notification banner.
- **🛡️ Smart History Deduplication & Dynamic Version Badge**:
  - Automatically updates existing entries rather than creating duplicate history cards when reconverting documents.
  - Clean, quiet update notification badge and live installed version indicator (`v1.4.0`) in the navigation bar.

## [1.3.6] - 2026-08-23 "clipboard-file-object-hand-off"

### Added
- **Native File Clipboard Copying (`copy_file_to_clipboard_native`)**:
  - Clicking **„Als Datei kopieren“** now places an actual `.md` file descriptor on the system clipboard (via `NSPasteboard` on macOS and `Set-Clipboard -Path` on Windows).
  - Pasting (`Ctrl+V` / `Cmd+V`) into **ChatGPT, Gemini, Claude, or Discord** instantly uploads the lecture as an attached document pill (`[📄 Vorlesung.md]`), keeping the chat input clean and empty for student prompts.

## [1.3.5] - 2026-08-23 "auto-updater-capabilities-and-macos-bundles"

### Fixed
- **In-App Updater Permissions**: Added missing `updater:default` and `process:default` capability permissions to `capabilities/default.json`.
- **macOS Update Bundle Support**: Enabled `"targets": "all"` in `tauri.conf.json` to generate signed macOS `.app.tar.gz` updater bundles alongside `.dmg` installers in GitHub Actions.

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
