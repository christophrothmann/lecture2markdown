import sys
import base64
from pathlib import Path
import fitz

def validate_pdf_document(doc: fitz.Document, pdf_path: Path) -> None:
    if doc.is_encrypted:
        sys.exit(f"Error: PDF file '{pdf_path}' is encrypted and cannot be processed.")
    if len(doc) == 0:
        sys.exit(f"Error: PDF file '{pdf_path}' contains no pages.")

def extract_pdf_title(metadata: dict, fallback_name: str) -> str:
    title = metadata.get("title", "").strip() if metadata else ""
    return title if title else fallback_name

def extract_pdf_author(metadata: dict) -> str:
    return metadata.get("author", "").strip() if metadata else ""

def format_metadata_header(doc: fitz.Document, pdf_path: Path) -> str:
    metadata = doc.metadata or {}
    fallback_name = pdf_path.stem
    title = extract_pdf_title(metadata, fallback_name)
    author = extract_pdf_author(metadata)
    
    header_lines = [f"# Lecture: {title}"]
    meta_info = []
    if author:
        meta_info.append(f"**Author:** {author}")
    meta_info.append(f"**Source:** {pdf_path.name}")
    header_lines.append(" | ".join(meta_info))
    
    return "\n\n".join(header_lines) + "\n\n"

def render_page_to_base64(page: fitz.Page, dpi: int = 200) -> str:
    zoom_factor = dpi / 72
    transformation_matrix = fitz.Matrix(zoom_factor, zoom_factor)
    pixmap = page.get_pixmap(matrix=transformation_matrix)
    return base64.b64encode(pixmap.tobytes("png")).decode("utf-8")

def is_page_visual(page: fitz.Page) -> bool:
    has_images = len(page.get_images()) > 0
    has_drawings = len(page.get_drawings()) > 0
    return has_images or has_drawings
