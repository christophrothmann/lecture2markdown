import sys
import base64
from pathlib import Path
import fitz

MAX_ALLOWED_PAGES = 1000
MAX_RENDER_DIMENSION = 4096

def validate_pdf_document(doc: fitz.Document, pdf_path: Path) -> None:
    if doc.is_encrypted:
        sys.exit(f"Error: PDF file '{pdf_path}' is encrypted and cannot be processed.")
    if len(doc) == 0:
        sys.exit(f"Error: PDF file '{pdf_path}' contains no pages.")
    if len(doc) > MAX_ALLOWED_PAGES:
        sys.exit(f"Error: PDF file '{pdf_path}' exceeds the maximum allowed limit of {MAX_ALLOWED_PAGES} pages.")

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
    rect = page.rect
    zoom_factor = dpi / 72
    
    # Cap render dimensions to prevent memory exhaustion DoS
    if rect.width * zoom_factor > MAX_RENDER_DIMENSION or rect.height * zoom_factor > MAX_RENDER_DIMENSION:
        zoom_factor = min(MAX_RENDER_DIMENSION / rect.width, MAX_RENDER_DIMENSION / rect.height)

    transformation_matrix = fitz.Matrix(zoom_factor, zoom_factor)
    pixmap = page.get_pixmap(matrix=transformation_matrix)
    return base64.b64encode(pixmap.tobytes("png")).decode("utf-8")

def is_page_visual(page: fitz.Page) -> bool:
    rect = page.rect
    page_area = max(rect.width * rect.height, 1.0)

    # 1. Raster image coverage check (> 8% of slide area to filter out corner logos)
    img_area = 0.0
    for img_info in page.get_images():
        xref = img_info[0]
        for rect_inst in page.get_image_rects(xref):
            img_area += rect_inst.width * rect_inst.height
    has_significant_images = (img_area / page_area) > 0.08

    # 2. Complex vector graphics (ignoring simple bounding boxes/underlines < 15 paths)
    drawings = page.get_drawings()
    has_complex_drawings = len(drawings) >= 15

    # 3. Dense mathematical formula detection
    text = page.get_text()
    math_indicators = ['\\int', '\\sum', '\\partial', '∑', '∫', '∂', '√', '≈', '≠', '≤', '≥', '∈', '∀', '∃', 'λ', 'μ', 'σ', 'θ', 'ω', 'Δ', '∇']
    math_count = sum(text.count(c) for c in math_indicators)
    has_dense_math = math_count >= 4

    return bool(has_significant_images or has_complex_drawings or has_dense_math)
