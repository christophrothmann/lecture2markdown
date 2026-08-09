# Lecture2Markdown (Python Prototyp)

Ein blitzschnelles Python-Tool zur Konvertierung von PDF-Vorlesungsfolien in strukturierte Markdown-Dateien unter Verwendung der OpenAI Multimodal Vision API (`gpt-4o` / `gpt-4o-mini`) und dem **uv** Paketmanager.

## Features
- 📁 **Saubere Ordnerstruktur**: Trennung von Eingabedateien (`lectures/`) und erzeugten Dokumenten (`output/`).
- ⚡ **Paketverwaltung mit uv**: Extrem schnelle Installation und Ausführung.
- 🔀 **Dynamisches Hybrid-Routing**: Schaltet automatisch zwischen `gpt-4o-mini` (Textfolien) und `gpt-4o` (visuelle Folien) um (~80% Kostenersparnis).
- 🏷️ **Folie-Anker (`## [Folie X]`)**: Perfekt optimiert für den Upload in ChatGPT ohne Halluzinationen.
- 🎯 **Deterministische Konvertierung**: `temperature=0.0` für 100% präzise Transkriptionen.
- 📐 **LaTeX-Formeln & Mermaid.js**: Konvertiert mathematische Ausdrücke in LaTeX und Diagramme in Mermaid.js.
- 🔒 **Sichere API-Key Verwaltung**: Verwendet `.env` für den OpenAI API-Schlüssel.

---

## 🛠️ Installation & Einrichtung mit `uv`

```bash
# 1. Virtuelle Umgebung erstellen & Abhängigkeiten installieren
uv venv
uv pip install -r requirements.txt

# 2. .env Datei erstellen & API-Key eintragen
cp .env.example .env
```

---

## 🚀 Nutzung

### 1. Vorlesungs-PDF ablegen
Lege deine PDF-Datei im Unterordner `lectures/` ab (z.B. `lectures/input-2.pdf`).

### 2. Skript ausführen
```bash
uv run python lecture2md.py
```

Nach Abschluss findest du das generierte Ergebnis im Ordner `output/` (z.B. `output/output-2.md`).
