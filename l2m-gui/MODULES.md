# Modul-Dokumentation: `l2m-gui`

Diese Dokumentation beschreibt die Komponenten, Module und Hilfsfunktionen im Unterordner `l2m-gui`.

## Dateisystem-Struktur

```
l2m-gui/
├── src-tauri/             # Tauri v2 Rust Backend
│   ├── Cargo.toml
│   └── src/main.rs        # Einstiegspunkt für den Tauri Rust-Prozess
├── src/                   # React + TypeScript Frontend
│   ├── components/
│   │   ├── ApiKeyModal.tsx        # Modal für API-Key Onboarding & client.models.list() Validierung
│   │   ├── Dropzone.tsx           # Drag & Drop PDF Uploader auf Deutsch
│   │   ├── ProgressDashboard.tsx  # Fortschrittsanzeige mit Live Hybrid Routing Badges & Kosten
│   │   ├── MarkdownPreview.tsx    # Live Preview mit "Markdown kopieren" & "Markdown speichern"
│   │   └── HistorySidebar.tsx     # Verlauf zuletzt verarbeiteter Vorlesungen
│   ├── App.tsx                    # Hauptansicht & App-State Management
│   └── index.css                  # TailwindCSS Styles (Clean Dark Mode)
├── py_sidecar/
│   └── lecture2md_gui.py          # Python Sidecar-Skript mit JSON-Event-Streaming
```

---

## React-Komponenten (`src/components/`)

### `ApiKeyModal` (`src/components/ApiKeyModal.tsx`)
- **Beschreibung**: Öffnet sich beim ersten Start oder per Einstellungs-Button. Fragt den `OPENAI_API_KEY` ab, bietet einen direkten Link zum OpenAI-Portal und führt einen kostenlosen Validierungstest (`GET https://api.openai.com/v1/models`) durch.
- **Props**:
  - `isOpen` (`boolean`): Gibt an, ob das Modal angezeigt wird.
  - `apiKey` (`string`): Aktueller Key-Wert.
  - `onSaveKey` (`(key: string) => void`): Callback zum Speichern des Keys.
  - `onClose` (`() => void`): Callback zum Schließen.

---

### `Dropzone` (`src/components/Dropzone.tsx`)
- **Beschreibung**: Bietet einen sauberen Drag & Drop-Bereich für PDF-Dateien auf Deutsch inkl. visueller Drag-Over-Effekte.
- **Props**:
  - `onFileSelected` (`(file: File) => void`): Callback bei Dateiauswahl.
  - `disabled` (`boolean`): Deaktiviert die Dropzone, falls kein API-Key hinterlegt ist.

---

### `ProgressDashboard` (`src/components/ProgressDashboard.tsx`)
- **Beschreibung**: Zeigt den Verarbeitungsfortschritt mit prozentualer Ladeleiste, Live-Badge des aktuell genutzten Modells (`gpt-4o-mini` vs `gpt-4o`) und geschätzten API-Kosten an.
- **Props**:
  - `fileName` (`string`): Name der Vorlesungs-PDF.
  - `completedPages` (`number`): Anzahl fertiggestellter Folien.
  - `totalPages` (`number`): Gesamtzahl der Folien.
  - `lastModelUsed` (`string`): Name des zuletzt verwendeten Modells.

---

### `MarkdownPreview` (`src/components/MarkdownPreview.tsx`)
- **Beschreibung**: Zeigt die generierte Markdown-Vorschau an und bietet zwei Aktionen: 1-Klick *"Markdown kopieren"* (in die Zwischenablage für ChatGPT) und *"Markdown speichern"* (als `.md`-Datei).
- **Props**:
  - `content` (`string`): Der generierte Markdown-Inhalt.
  - `fileName` (`string`): Dateiname für den Export.
  - `onSaveFile` (`() => void`): Callback zum Speichern.

---

### `HistorySidebar` (`src/components/HistorySidebar.tsx`)
- **Beschreibung**: Zeigt eine Seitenleiste mit den zuletzt konvertierten Vorlesungsdateien für den Schnellzugriff und schnelles erneutes Kopieren.
- **Props**:
  - `items` (`HistoryItem[]`): Liste der bisherigen Konvertierungen.
  - `onSelect` (`(item: HistoryItem) => void`): Auswählen eines Eintrags.
  - `onClear` (`() => void`): Verlauf leeren.

---

## Python Sidecar (`py_sidecar/lecture2md_gui.py`)

- **`emit_event(event_type: str, data: dict) -> None`**: Gibt strukturierte JSON-Events an stdout aus (`start`, `progress`, `complete`, `error`), damit Tauri und React den Live-Status anzeigen können.
- **`process_single_page(...)`**: Verarbeitet eine Folie und ermittelt dynamisch das passende Modell via Hybrid-Routing.
