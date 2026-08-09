# Modul-Dokumentation: Lecture2Markdown

Diese Datei beschreibt die Funktionen und Module im Ordner `Lecture2Markdown`.

## Dateisystem-Übersicht

- **`lecture2md.py`**: Hauptskript zur Konvertierung von PDF-Dateien in Markdown unter Verwendung der OpenAI Multimodal Vision API, dynamischem Hybrid-Routing (`gpt-4o` vs. `gpt-4o-mini`), separaten Eingabe- (`lectures/`) und Ausgabe-Ordnern (`output/`), paralleler Threading-Verarbeitung und Metadaten-Extraktion.

---

## Funktionen in `lecture2md.py`

### `get_openai_client() -> OpenAI`
- **Beschreibung**: Liest den `OPENAI_API_KEY` aus der `.env`-Datei und initialisiert den `OpenAI`-Client mit 6 automatischen Retries.
- **Parameter**: Keine.
- **Rückgabe**: `OpenAI` Client-Instanz.

---

### `ensure_project_directories() -> tuple[Path, Path]`
- **Beschreibung**: Erstellt die Ordner `lectures/` und `output/` automatisch auf der Festplatte, falls diese noch nicht existieren.
- **Parameter**: Keine.
- **Rückgabe**: `tuple[Path, Path]` – Pfad-Objekte für `lectures/` und `output/`.

---

### `validate_pdf_document(doc: fitz.Document, pdf_path: Path) -> None`
- **Beschreibung**: Führt Pre-Flight-Prüfungen durch (bricht ab, falls PDF verschlüsselt ist oder 0 Seiten enthält).
- **Parameter**:
  - `doc` (`fitz.Document`): Das geöffnete PyMuPDF-Dokument.
  - `pdf_path` (`Path`): Pfad zur PDF-Datei.
- **Rückgabe**: `None`.

---

### `select_model_for_page(page: fitz.Page) -> str`
- **Beschreibung**: Prüft lokal via PyMuPDF, ob die Folie Bilder oder Vektorgrafiken enthält, und wählt dynamisch das passende Modell (`gpt-4o` für visuelle Folien, `gpt-4o-mini` für reine Textfolien).
- **Parameter**:
  - `page` (`fitz.Page`): Die aktuelle PDF-Folie.
- **Rückgabe**: `str` – Modellname (`"gpt-4o"` oder `"gpt-4o-mini"`).

---

### `extract_pdf_title(metadata: dict, fallback_name: str) -> str`
- **Beschreibung**: Liest den Titel aus den PDF-Metadaten aus oder gibt den Dateinamen als Fallback zurück.
- **Parameter**:
  - `metadata` (`dict`): Metadaten-Dictionary der PDF.
  - `fallback_name` (`str`): Fallback-Name (z.B. Dateiname ohne Endung).
- **Rückgabe**: `str` – Titel der Vorlesung.

---

### `extract_pdf_author(metadata: dict) -> str`
- **Beschreibung**: Extrahierte den Autoren- / Dozentennamen aus den PDF-Metadaten, falls vorhanden.
- **Parameter**:
  - `metadata` (`dict`): Metadaten-Dictionary der PDF.
- **Rückgabe**: `str` – Autor/Dozent oder leerer String.

---

### `format_metadata_header(doc: fitz.Document, pdf_path: Path) -> str`
- **Beschreibung**: Formatiert den Markdown-Header inkl. Titel, Autor und Quell-Dateiname.
- **Parameter**:
  - `doc` (`fitz.Document`): Das PDF-Dokument.
  - `pdf_path` (`Path`): Pfad zur PDF-Datei.
- **Rückgabe**: `str` – Formatisierter Markdown-Header-String.

---

### `render_page_to_base64(page: fitz.Page, dpi: int = 200) -> str`
- **Beschreibung**: Rendert eine PDF-Seite als PNG-Grafik und gibt diese Base64-codiert zurück.
- **Parameter**:
  - `page` (`fitz.Page`): Die PyMuPDF PDF-Seite.
  - `dpi` (`int`, optional): Auflösung in DPI (Standard: `200`).
- **Rückgabe**: `str` – Base64-codierter String.

---

### `get_system_prompt() -> str`
- **Beschreibung**: Gibt den System-Prompt inklusive Prompt-Injection-Schutz, Mermaid.js-Regeln und Formatierungsvorgaben zurück.
- **Parameter**: Keine.
- **Rückgabe**: `str` – System-Prompt.

---

### `build_user_message(base64_image: str, page_number: int) -> list[dict]`
- **Beschreibung**: Erstellt die Benutzer-Nachricht mit XML-Metadaten und Bild-URL.
- **Parameter**:
  - `base64_image` (`str`): Base64-codiertes Folienbild.
  - `page_number` (`int`): Seitennummer.
- **Rückgabe**: `list[dict]` – Strukturierte Liste von Inhalts-Objekten.

---

### `request_slide_markdown(client: OpenAI, model: str, base64_image: str, page_number: int) -> str`
- **Beschreibung**: Sendet die Anfrage an OpenAI mit dynamischem Modell, `temperature=0.0` und automatischer `tenacity`-Retry-Logik bei Rate-Limits.
- **Parameter**:
  - `client` (`OpenAI`): API-Client.
  - `model` (`str`): Name des Modells (`gpt-4o` oder `gpt-4o-mini`).
  - `base64_image` (`str`): Folienbild als Base64.
  - `page_number` (`int`): Seitennummer.
- **Rückgabe**: `str` – Generiertes Markdown.

---

### `process_single_page(client: OpenAI, page: fitz.Page, page_number: int) -> str`
- **Beschreibung**: Ermittelt das optimale Modell, wandelt die Folie um und fügt den expliziten Folien-Anker (`## [Folie X]`) hinzu.
- **Parameter**:
  - `client` (`OpenAI`): API-Client.
  - `page` (`fitz.Page`): PDF-Seite.
  - `page_number` (`int`): Seitennummer.
- **Rückgabe**: `str` – Formatiertes Markdown-Segment für die Folie.

---

### `process_page_worker(pdf_path: Path, page_index: int, client: OpenAI) -> tuple[int, str]`
- **Beschreibung**: Worker-Funktion für die parallele Verarbeitung im `ThreadPoolExecutor`.
- **Parameter**:
  - `pdf_path` (`Path`): Pfad zur PDF.
  - `page_index` (`int`): Index der Seite (0-basiert).
  - `client` (`OpenAI`): API-Client.
- **Rückgabe**: `tuple[int, str]` – Paar aus Seiten-Index und generiertem Markdown.

---

### `convert_pdf_to_markdown(pdf_path: Path, output_path: Path) -> None`
- **Beschreibung**: Koordiniert Validierung, Header-Generierung, parallele Konvertierung und Speichern im `output/`-Ordner.
- **Parameter**:
  - `pdf_path` (`Path`): Eingabe-PDF.
  - `output_path` (`Path`): Ziel-Markdown.
- **Rückgabe**: `None`.

---

### `main() -> None`
- **Beschreibung**: Einstiegspunkt des Skripts. Erstellt benötigte Verzeichnisse und startet den Konvertierungsablauf.
- **Parameter**: Keine.
- **Rückgabe**: `None`.
