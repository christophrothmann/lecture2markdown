# Modul-Dokumentation: Lecture2Markdown

Diese Datei beschreibt die modulare Architektur und Komponenten im Projekt **Lecture2Markdown**.

## Dateisystem- & Modul-Übersicht

```
lecture2markdown/
├── l2m_core/
│   ├── __init__.py           # Paket-Initialisierung
│   ├── config.py             # Provider-Konstanten, Modelle, CLI-Argument-Parser
│   ├── pdf.py                # PyMuPDF: Validierung, Base64-Rendering, Metadaten-Extraktion
│   ├── security.py           # System-Prompts, Anti-AI-Canary-Filter & Prompt Injection Schutz
│   ├── converter.py          # Parallelisierung (ThreadPoolExecutor) & JSON-Event-Streaming
│   └── providers/
│       ├── __init__.py       # Provider-Export
│       ├── base.py           # Abstrakte BaseProvider Basisklasse
│       ├── factory.py        # get_provider() Factory-Funktion
│       ├── openai_provider.py    # OpenAI (gpt-4o & gpt-4o-mini)
│       ├── gemini_provider.py    # Google Gemini (gemini-2.0-flash & gemini-1.5-pro)
│       ├── anthropic_provider.py # Anthropic Claude (claude-3-7-sonnet & claude-3-5-haiku)
│       └── mistral_provider.py   # Mistral AI (mistral-ocr-latest & pixtral-12b)
├── l2m-gui/                  # Desktop-App (Tauri v2, React, TailwindCSS)
├── lecture2md.py             # Schlanker CLI & IPC Einstiegspunkt
├── requirements.txt          # Multi-Provider Python-Abhängigkeiten
└── pyproject.toml            # Projekt-Konfiguration
```

---

## 1. `l2m_core/config.py`
- **`PROVIDER_OPENAI`, `PROVIDER_GOOGLE`, `PROVIDER_ANTHROPIC`, `PROVIDER_MISTRAL`**: Unterstützte KI-Provider.
- **`PROVIDER_MODELS`**: Mapping der schnellen Textmodelle vs. visuellen Diagramm-Modelle für jeden Anbieter.
- **`parse_cli_arguments()`**: Parst CLI-Parameter (`--pdf`, `--output`, `--provider`, `--api-key`, `--workers`, `--hybrid`, `--json-stream`).
- **`resolve_provider_api_key(provider, cli_key)`**: Ermittelt den passenden Key aus CLI oder `.env`.

---

## 2. `l2m_core/providers/`
- **`BaseProvider` (`base.py`)**: Abstrakte Basisklasse mit `transcribe_slide(base64_image, page_number, is_visual, hybrid) -> tuple[str, str]`.
- **`OpenAIProvider` (`openai_provider.py`)**: Bindet `gpt-4o` und `gpt-4o-mini` via `openai` SDK ein.
- **`GeminiProvider` (`gemini_provider.py`)**: Nutzt das `google-genai` SDK für `gemini-2.0-flash` und `gemini-1.5-pro`.
- **`AnthropicProvider` (`anthropic_provider.py`)**: Verarbeitet Folien über `anthropic` SDK mit `claude-3-7-sonnet` und `claude-3-5-haiku`.
- **`MistralProvider` (`mistral_provider.py`)**: Unterstützt das spezialisierte `mistral-ocr-latest` Modell sowie `pixtral-12b-2409`.
- **`get_provider(provider_name, api_key)` (`factory.py`)**: Instanziiert die passende Provider-Klasse.

---

## 3. `l2m_core/pdf.py`
- **`validate_pdf_document(doc, pdf_path)`**: Prüft auf Verschlüsselung und Seitenzahl.
- **`format_metadata_header(doc, pdf_path)`**: Erzeugt den einheitlichen Markdown-Header.
- **`render_page_to_base64(page, dpi)`**: Rendert PDF-Seiten als hochauflösende Base64-PNGs.
- **`is_page_visual(page)`**: Erkennt Bilder und Vektorgrafiken für intelligentes Hybrid-Routing.

---

## 4. `l2m_core/security.py`
- **`get_system_prompt()`**: Vollständiger System-Prompt mit Anti-AI Canary Filter, LaTeX-Regeln und Mermaid.js-Konvertierung.

---

## 5. `l2m_core/converter.py`
- **`execute_conversion(pdf_path, output_path, provider, workers, hybrid, json_stream, dpi)`**: Koordiniert den gesamten Ablauf, steuert den ThreadPoolExecutor und streamt strukturierte JSON-Events für GUI und CLI.
