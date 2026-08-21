# Modul-Dokumentation: Lecture2Markdown

Diese Datei beschreibt die modulare Architektur und Komponenten im Projekt **Lecture2Markdown**.

---

## Dateisystem- & Modul-Übersicht

```
lecture2markdown/
├── l2m-gui/                           # Desktop-Applikation (Tauri v2 + Pure-Rust Core)
│   ├── src/                          # React + TypeScript Frontend
│   │   ├── components/
│   │   │   ├── ApiKeyModal.tsx       # Multi-Provider API-Key & Cache-Verwaltung
│   │   │   ├── Dropzone.tsx          # Drag & Drop PDF Uploader
│   │   │   ├── HistorySidebar.tsx    # Verlaufs-Sidebar mit Live-In-Progress-Badge
│   │   │   ├── MarkdownPreview.tsx   # Live-Markdown-Editor & Export-Dialoge
│   │   │   └── ProgressDashboard.tsx # Echtzeit-Fortschritt, Kostenrechner & Abbrechen-Button
│   │   └── App.tsx                   # Hauptkomponente & Tauri Event-Listener
│   └── src-tauri/src/                # Nativer Pure-Rust Core
│       ├── main.rs                   # App-Einstiegspunkt, State, Concurrency & Commands
│       ├── cache.rs                  # Content-Addressed SHA-256 Slide-Cache (180 Tage TTL)
│       ├── pdf.rs                    # In-Memory WebP Renderer & Smart Visual Heuristic
│       └── providers/                # Native Multi-Provider API Clients
│           ├── mod.rs                # BaseProvider Trait & System-Prompts
│           ├── openai.rs             # OpenAI Client (gpt-4o & gpt-4o-mini, adaptive Tiling)
│           ├── gemini.rs             # Google Gemini (Pacing-Limiter, 404/429 Auto-Recovery)
│           ├── claude.rs             # Anthropic Claude (claude-3-7-sonnet & claude-3-5-haiku)
│           └── mistral.rs            # Mistral AI (mistral-ocr-latest & pixtral-12b)
├── l2m_core/                         # Eigenständiges Python CLI & SDK Paket
│   ├── __init__.py                   # Paket-Initialisierung
│   ├── config.py                     # Provider-Konstanten, Modelle, CLI-Parser
│   ├── pdf.py                        # PyMuPDF: Validierung & Smart Visual Heuristic
│   ├── security.py                   # System-Prompts & Prompt-Injection-Schutz
│   ├── converter.py                  # Parallelisierung (ThreadPoolExecutor) & JSON-Streaming
│   └── providers/                    # Python SDK Provider
│       ├── base.py                   # Abstrakte BaseProvider Basisklasse
│       ├── factory.py                # get_provider() Factory-Funktion
│       ├── openai_provider.py        # OpenAI (gpt-4o & gpt-4o-mini)
│       ├── gemini_provider.py        # Google Gemini Client
│       ├── anthropic_provider.py     # Anthropic Claude Client
│       └── mistral_provider.py       # Mistral AI Client
├── assets/                           # Projekt-Assets (App-Icon, Demo-Video)
├── lectures/                         # PDF-Ablageverzeichnis für CLI
├── output/                           # Markdown-Ausgabeverzeichnis
├── pyproject.toml                    # Python Build-Konfiguration
└── requirements.txt                  # Python-Abhängigkeiten
```

---

## 1. Nativer Pure-Rust Core (`l2m-gui/src-tauri/src/`)

- **`main.rs`**: Verwaltet den Anwendungszustand (`AppState`), steuert providerspezifisch kalibrierte Concurrency-Semaphoren, streamt Echtzeit-Events an die UI und bietet Abbruch-Handler (`cancel_conversion_native`).
- **`cache.rs`**: Implementiert einen **Content-Addressed Slide Cache**. Bilddaten werden deterministisch per SHA-256 gehasht. Identische Folien werden sofort in 0 ms ohne API-Kosten aus dem Cache geladen (TTL: 180 Tage, LRU-Eviction).
- **`pdf.rs`**: High-Speed In-Memory PDF-Rendering direkt zu WebP-Puffern. Verhindert Festplatten-I/O und führt eine leichtgewichtige **Smart Visual Heuristic** (< 2 ms) zur Erkennung von echten Diagrammen vs. Textfolien durch.
- **`providers/`**:
  - **`openai.rs`**: Parallele async Requests mit adaptiver Kachelauflösung (`detail: low` vs `high`) für 4-fach schnellere Inferenz.
  - **`gemini.rs`**: Integrierter 4,1-Sekunden Pacing Rate Limiter zum ausfallsicheren Betrieb auf Google Free-Tier-Quotas (15 RPM) und automatischer 404/429-Recovery.
  - **`claude.rs`**: Asynchrone Inferenz mit `claude-3-7-sonnet` und nahtlosem Fallback auf `claude-3-5-haiku`.
  - **`mistral.rs`**: Unterstützung für das Dokumenten-OCR-Modell `mistral-ocr-latest` und Vision-Modell `pixtral-12b`.

---

## 2. Python CLI & Kernpaket (`l2m_core/`)

- **`config.py`**: Zentrale Modell-Mappings, Konstanten und CLI-Parameter-Parser (`--pdf`, `--output`, `--provider`, `--api-key`, `--workers`, `--hybrid`).
- **`pdf.py`**: PDF-Validierung, Metadaten-Extraktion und Seitenrasterung für Headless-Nutzung.
- **`security.py`**: Härtung gegen Prompt-Injections, Bereinigung unsichtbarer Steuerzeichen und Unterdrückung von Anti-AI-Canary-Fallen.
- **`converter.py`**: Parallele Batch-Konvertierung im Terminal via ThreadPoolExecutor.
