# Modul-Dokumentation: `l2m-gui`

Diese Dokumentation beschreibt die Komponenten, Module und Hilfsfunktionen der Desktop-Applikation **Lecture2Markdown** (`l2m-gui`).

---

## Dateisystem-Struktur

```
l2m-gui/
├── src-tauri/                     # Tauri v2 Rust Backend (100% Pure-Rust Core)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                # App-Einstiegspunkt, State & Concurrency-Management
│       ├── anki_apkg.rs           # Native Rust .apkg Deck-Engine (SQLite col/notes/cards, zip, WebP)
│       ├── cache.rs               # Content-Addressed SHA-256 Slide-Cache (180 Tage TTL)
│       ├── pdf.rs                 # In-Memory WebP Renderer & Smart Visual Heuristic
│       ├── commands/              # Modulare Tauri IPC Command Handler
│       │   ├── mod.rs
│       │   ├── transcription.rs   # LLM-Konvertierung & Cancellation
│       │   ├── export.rs          # .apkg & TSV Native Export Handlers
│       │   ├── fs.rs              # Native Datei-I/O & Clipboard Hand-off
│       │   ├── keys.rs            # Sichere API-Key Persistierung
│       │   ├── cache.rs           # Cache-Statistiken & Bereinigung
│       │   └── pdf.rs             # PDF-Rendering IPC
│       └── providers/             # Native Multi-Provider API Clients
│           ├── mod.rs             # BaseProvider Trait & System-Prompts
│           ├── openai.rs          # OpenAI Client (gpt-4o & gpt-4o-mini, adaptive Tiling)
│           ├── gemini.rs          # Google Gemini (Pacing-Limiter, 404/429 Auto-Recovery)
│           ├── claude.rs          # Anthropic Claude (claude-3-7-sonnet & claude-3-5-haiku)
│           └── mistral.rs         # Mistral AI (mistral-ocr-latest & pixtral-12b)
├── src/                           # React + TypeScript Frontend
│   ├── components/
│   │   ├── ApiKeyModal.tsx        # Multi-Provider Modal (OpenAI, Gemini, Claude, Mistral)
│   │   ├── BatchQueue.tsx         # Multi-File Batch-Warteschlange mit Seitenbereichs-Filtern
│   │   ├── Dropzone.tsx           # Drag & Drop PDF Uploader mit nativer Pfaderfassung
│   │   ├── FlashcardInspectorTab.tsx # Slide-synchronisierter Lernkarten-Editor & Deck-Export
│   │   ├── flashcards/            # Modularisierte Subkomponenten des Lernkarten-Inspektors
│   │   │   ├── FlashcardHeader.tsx
│   │   │   ├── FlashcardList.tsx
│   │   │   ├── FlashcardSlideViewer.tsx
│   │   │   └── OcclusionToolbar.tsx
│   │   ├── HistorySidebar.tsx     # Verlaufs-Sidebar mit interaktiver Multi-Slide-Hover-Vorschau
│   │   ├── ImageOcclusionCanvas.tsx # Visueller Image-Occlusion Masken-Editor
│   │   ├── MarkdownPreview.tsx    # Live Preview mit Tab-Umschaltung (Markdown, Split, Flashcards)
│   │   ├── ProgressDashboard.tsx  # Fortschrittsanzeige mit Live Hybrid Routing Badges
│   │   └── QuickDropOverlay.tsx   # Spotlight-inspiriertes globales Schnell-Drop-Overlay
│   ├── i18n/                      # Internationalisierung (Deutsch 🇩🇪 & Englisch 🇬🇧)
│   ├── utils/                     # Hilfsfunktionen
│   │   ├── anki.ts                # Flashcard-Extraktion, LaTeX-MathJax & TSV-Parser
│   │   ├── historyStorage.ts      # Verlaufs-Deduplizierung & Speicher-Cache
│   │   └── slideParser.ts         # Markdown-Folienextraktor & Struktur-Parser
│   ├── App.tsx                    # Hauptansicht, Provider-Umschaltung & App-State
│   └── index.css                  # TailwindCSS Styles (Clean Dark Mode)
```

---

## React-Komponenten (`src/components/`)

### `ApiKeyModal` (`src/components/ApiKeyModal.tsx`)
- **Beschreibung**: Modal zur Verwaltung von API-Keys für alle 4 Provider (OpenAI, Google Gemini, Anthropic Claude, Mistral AI), Sprachumschaltung (Deutsch/Englisch) und Cache-Statistiken.

### `BatchQueue` (`src/components/BatchQueue.tsx`)
- **Beschreibung**: Verwaltet mehrere ausgewählte Vorlesungs-PDFs gleichzeitig. Erlaubt individuelle Seitenbereichsfilterung pro Datei, Löschen wartender Dokumente während aktiver Ausführung und direktes Öffnen fertig konvertierter Dokumente.

### `Dropzone` (`src/components/Dropzone.tsx`)
- **Beschreibung**: Drag & Drop-Bereich für PDF-Dateien mit plattformübergreifender Pfadauflösung (macOS & Windows WebView2).

### `FlashcardInspectorTab` (`src/components/FlashcardInspectorTab.tsx`)
- **Beschreibung**: Vollintegrierter Lernkarten-Inspektor. Synchronisiert die Folien-Ansicht (PDF.js) mit den extrahierten Lernkarten der jeweiligen Folie. Unterstützt Kartentyp-Filter (Definitionen, Lückentexte, Formeln, Image Occlusion), Inline-Bearbeitung und direkten 1-Klick-Export nach Anki (`.apkg`).

### `ImageOcclusionCanvas` (`src/components/ImageOcclusionCanvas.tsx`)
- **Beschreibung**: Visueller SVG/Canvas-Masken-Editor über dem Folien-Canvas. Ermöglicht das interaktive Zeichnen von Occlusion-Rechtecken über Diagrammen, Schaltplänen und anatomischen Abbildungen für "Hide One" und "Hide All" Lernkarten.

### `MarkdownPreview` (`src/components/MarkdownPreview.tsx`)
- **Beschreibung**: Dreiteiliger Segmented-Control-Viewer (`[ 📝 Markdown | 🔀 Split-Screen | 🃏 Lernkarten ]`) mit KaTeX-Formel-Rendering, Mermaid.js-Diagrammen, Copy-to-Clipboard als Dateiobjekt und manuellem Speichern.

### `HistorySidebar` (`src/components/HistorySidebar.tsx`)
- **Beschreibung**: Verlaufs-Sidebar mit Multi-Selection-Löschmodus, Live-Anzeige aktiver Batch-Konvertierungen und einer interaktiven Multi-Slide-Hover-Vorschau (Folie 1, Folie 2 und Folgeseiten scrollbar mit 300 ms Close-Grace-Period).

### `QuickDropOverlay` (`src/components/QuickDropOverlay.tsx`)
- **Beschreibung**: Spotlight-inspiriertes Widget (`⌘ + ⇧ + L` / `Ctrl + Shift + L`), das aus jeder Anwendung heraus geöffnet werden kann, um Vorlesungen im Hintergrund zu konvertieren und als Datei-Objekt in die Zwischenablage zu legen.

---

## Rust Backend (`src-tauri/src/`)

- **`anki_apkg.rs`**: High-Speed Pure-Rust `.apkg`-Generator. Erstellt native SQLite-Tabellen (`col`, `notes`, `cards`) und zip-Archive mit eingebetteten WebP-Folienbildern ohne externe Abhängigkeiten.
- **`commands/`**: Modularisierte Tauri-IPC-Befehle für Dateisystem-Operationen (`fs.rs`), Transkription (`transcription.rs`), Deck-Exporte (`export.rs`), API-Key-Verwaltung (`keys.rs`), Cache (`cache.rs`) und PDF-Rendering (`pdf.rs`).
- **`providers/`**: Native asynchrone API-Clients mit Streaming, automatischer Fehlerbehandlung und adaptiver Ratenbegrenzung.
