import time
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import fitz
from tqdm import tqdm
from .pdf import (
    validate_pdf_document,
    format_metadata_header,
    render_page_to_base64,
    is_page_visual,
)
from .security import sanitize_markdown_output
from .providers import BaseProvider

SLIDE_TIMEOUT_SECONDS = 90

def emit_event(event_type: str, data: dict) -> None:
    message = {"type": event_type, **data}
    print(json.dumps(message), flush=True)

def parse_page_range(pages_str: str | None, total_pages: int) -> list[int]:
    if not pages_str:
        return list(range(total_pages))
    
    selected = []
    parts = pages_str.split(",")
    for part in parts:
        part = part.strip()
        if "-" in part:
            s_str, e_str = part.split("-", 1)
            start = max(1, int(s_str.strip()))
            end = min(total_pages, int(e_str.strip()))
            selected.extend(range(start - 1, end))
        else:
            p = int(part)
            if 1 <= p <= total_pages:
                selected.append(p - 1)
    
    unique_sorted = sorted(list(set(selected)))
    return unique_sorted if unique_sorted else list(range(total_pages))

def process_page_worker(
    pdf_path: Path,
    page_index: int,
    provider: BaseProvider,
    hybrid: bool,
    dpi: int = 200
) -> tuple[int, str, str]:
    page_number = page_index + 1
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    
    visual_flag = is_page_visual(page)
    base64_image = render_page_to_base64(page, dpi=dpi)
    doc.close()

    raw_markdown, used_model = provider.transcribe_slide(
        base64_image=base64_image,
        page_number=page_number,
        is_visual=visual_flag,
        hybrid=hybrid
    )

    sanitized_markdown = sanitize_markdown_output(raw_markdown)
    formatted_segment = f"## [Folie {page_number}]\n{sanitized_markdown}\n"
    return page_index, formatted_segment, used_model

def execute_conversion(
    pdf_path: Path,
    output_path: Path,
    provider: BaseProvider,
    workers: int = 3,
    hybrid: bool = True,
    pages: str | None = None,
    json_stream: bool = False,
    dpi: int = 200
) -> None:
    start_time = time.time()
    
    doc = fitz.open(pdf_path)
    validate_pdf_document(doc, pdf_path)
    header = format_metadata_header(doc, pdf_path)
    total_pages = len(doc)
    doc.close()

    target_indices = parse_page_range(pages, total_pages)
    selected_count = len(target_indices)

    if json_stream:
        emit_event("start", {"total_pages": selected_count, "pdf_name": pdf_path.name})
    else:
        print(f"Starting processing of {selected_count} slides (of {total_pages}) with {workers} threads...")

    sections = []
    completed_count = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(process_page_worker, pdf_path, idx, provider, hybrid, dpi): idx
            for idx in target_indices
        }

        if json_stream:
            for future in as_completed(futures):
                idx = futures[future]
                try:
                    page_index, page_content, used_model = future.result(timeout=SLIDE_TIMEOUT_SECONDS)
                except Exception as err:
                    page_index = idx
                    page_content = f"*(Fehler bei Folienverarbeitung: {err})*"
                    used_model = "error"

                sections.append((page_index, page_content))
                completed_count += 1
                emit_event("progress", {
                    "completed": completed_count,
                    "total": selected_count,
                    "page_number": page_index + 1,
                    "model_used": used_model
                })
        else:
            for future in tqdm(as_completed(futures), total=selected_count, desc="Processing slides"):
                idx = futures[future]
                try:
                    page_index, page_content, _ = future.result(timeout=SLIDE_TIMEOUT_SECONDS)
                except Exception as err:
                    page_index = idx
                    page_content = f"*(Fehler bei Folienverarbeitung: {err})*"
                sections.append((page_index, page_content))

    sections.sort(key=lambda x: x[0])
    ordered_contents = [content for _, content in sections]
    final_content = header + "\n---\n\n".join(ordered_contents)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as file:
        file.write(final_content)

    elapsed_time = time.time() - start_time
    if json_stream:
        emit_event("complete", {
            "output_path": str(output_path),
            "total_pages": selected_count,
            "elapsed_seconds": round(elapsed_time, 1),
            "content": final_content
        })
    else:
        minutes, seconds = divmod(elapsed_time, 60)
        print(f"\nDone! Processing {selected_count} slides took {int(minutes)}m {seconds:.1f}s. Saved to: '{output_path}'")
