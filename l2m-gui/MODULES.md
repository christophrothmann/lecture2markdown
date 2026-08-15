# Modul-Dokumentation: `l2m-gui`

Diese Dokumentation beschreibt die Komponenten, Module und Hilfsfunktionen im Unterordner `l2m-gui`.

## Dateisystem-Struktur

```
l2m-gui/
├── src-tauri/             # Tauri v2 Rust Backend
│   ├── Cargo.toml
│   └── src/main.rs        # Rust-Backend, IPC-Bridge & Canonical-Path-Subprocess Runner
├── src/                   # React + TypeScript Frontend
│   ├── components/
│   │   ├── ApiKeyModal.tsx        # Multi-Provider Modal (OpenAI, Gemini, Claude, Mistral)
│   │   ├── Dropzone.tsx           # Drag & Drop PDF Uploader mit nativer Pfaderfassung
│   │   ├── ProgressDashboard.tsx  # Fortschrittsanzeige mit Live Hybrid Routing Badges
│   │   ├── MarkdownPreview.tsx    # Live Preview mit "Markdown kopieren" & "Markdown speichern"
│   │   └── HistorySidebar.tsx     # Verlauf zuletzt verarbeiteter Vorlesungen
│   ├── App.tsx                    # Hauptansicht, Provider-Umschaltung & App-State
│   └── index.css                  # TailwindCSS Styles (Clean Dark Mode)
```

> **Hinweis zur Python-Geschäftslogik (Single Source of Truth)**:
> Die Desktop-App nutzt direkt das modulare Paket `l2m_core/` und den Einstiegspunkt `lecture2md.py` aus dem Root-Verzeichnis mit dem Flag `--json-stream`.

---

## React-Komponenten (`src/components/`)

### `ApiKeyModal` (`src/components/ApiKeyModal.tsx`)
- **Beschreibung**: Öffnet sich beim ersten Start oder per Provider-/Einstellungs-Button. Bietet Tabs für alle 4 Provider (OpenAI, Google Gemini, Anthropic Claude, Mistral AI), direkte Links zu den Entwicklerportalen und führt native Backend-Tests aus.
- **Props**:
  - `isOpen` (`boolean`): Gibt an, ob das Modal angezeigt wird.
  - `activeProvider` (`ProviderType`): Der aktuell gewählte Provider.
  - `providerKeys` (`Record<string, string>`): Gespeicherte Keys pro Provider.
  - `onSelectProvider` (`(provider: ProviderType) => void`): Provider aktivieren.
  - `onSaveKey` (`(provider: ProviderType, key: string) => void`): Key speichern.
  - `onClose` (`() => void`): Modal schließen.

---

### `Dropzone` (`src/components/Dropzone.tsx`)
- **Beschreibung**: Drag & Drop-Bereich für PDF-Dateien mit nativer Pfadauflösung über `@tauri-apps/plugin-dialog`.
- **Props**:
  - `onFileSelectedPath` (`(filePath: string, fileName: string) => void`): Callback bei Dateiauswahl mit absolutem Dateipfad.
  - `disabled` (`boolean`): Deaktiviert die Dropzone, falls für den aktiven Provider kein API-Key hinterlegt ist.

---

### `ProgressDashboard` (`src/components/ProgressDashboard.tsx`)
- **Beschreibung**: Zeigt den Verarbeitungsfortschritt mit Ladeleiste, Live-Badge des aktiven Modells (z. B. `gpt-4o-mini`, `gemini-2.0-flash`, `claude-3-7-sonnet`, `mistral-ocr-latest`) und Kostenrechner.
- **Props**:
  - `fileName` (`string`): Name der Vorlesungs-PDF.
  - `completedPages` (`number`): Anzahl fertiggestellter Folien.
  - `totalPages` (`number`): Gesamtzahl der Folien.
  - `lastModelUsed` (`string`): Name des zuletzt verwendeten Modells.

---

### `MarkdownPreview` (`src/components/MarkdownPreview.tsx`)
- **Beschreibung**: Zeigt die generierte Markdown-Vorschau an mit 1-Klick *"Markdown kopieren"*, nativer Datei-Speicherung via `@tauri-apps/plugin-fs` und *"Neue Vorlesung"*.
- **Props**:
  - `content` (`string`): Der generierte Markdown-Inhalt.
  - `fileName` (`string`): Dateiname für den Export.
  - `onSaveFile` (`() => void`): Callback zum Speichern.
  - `onNewConversion` (`() => void`): Zurücksetzen zur Standardansicht.

---

### `HistorySidebar` (`src/components/HistorySidebar.tsx`)
- **Beschreibung**: Seitenleiste mit den zuletzt konvertierten Vorlesungsdateien für den Schnellzugriff.
- **Props**:
  - `items` (`HistoryItem[]`): Liste der bisherigen Konvertierungen.
  - `onSelect` (`(item: HistoryItem) => void`): Auswählen eines Eintrags.
  - `onClear` (`() => void`): Verlauf leeren.
