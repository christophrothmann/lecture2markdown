use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::Command;

pub struct RenderedSlide {
    pub page_number: usize,
    pub webp_base64: String,
    pub hash: String,
    pub is_visual: bool,
}

/// Computes a deterministic SHA-256 hash over raw image bytes.
pub fn hash_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// High-speed PDF rendering pipeline producing In-Memory WebP.
pub fn render_pdf_slide_to_webp(
    pdf_path: &Path,
    page_index: usize,
    py_bin: Option<&Path>,
) -> Result<RenderedSlide, String> {
    let page_number = page_index + 1;

    // Fast In-Memory WebP Rendering & Lightweight Complexity Check
    let py_exec = py_bin.unwrap_or_else(|| Path::new("python3"));
    let script = format!(
        r#"
import fitz, base64, io
from PIL import Image

doc = fitz.open(r'{}')
page = doc[{}]
rect = page.rect
zoom = 200 / 72
if rect.width * zoom > 4096 or rect.height * zoom > 4096:
    zoom = min(4096 / rect.width, 4096 / rect.height)

pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

buf = io.BytesIO()
img.save(buf, format="WEBP", quality=80)
raw_bytes = buf.getvalue()

# Ultra-fast heuristic (< 2ms):
img_count = len(page.get_images())
text = page.get_text()
text_len = len(text.strip())

# Math & formula indicators
math_chars = ['\\int', '\\sum', '\\partial', '∑', '∫', '∂', '√', '≈', '≠', '≤', '≥', '∈', '∀', '∃', 'λ', 'μ', 'σ', 'θ', 'ω', 'Δ', '∇']
math_count = sum(text.count(c) for c in math_chars)

# Classify as complex visual if:
# 1. Slide has images AND sparse text (diagram/photo slide)
# 2. Slide has dense mathematical notation (>= 4 formula symbols)
is_vis = bool((img_count > 0 and text_len < 300) or math_count >= 4)
doc.close()

print(str(int(is_vis)) + ":::" + base64.b64encode(raw_bytes).decode('utf-8'))
"#,
        pdf_path.display(),
        page_index
    );

    let output = Command::new(py_exec)
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Fehler beim Rendern von Folie {}: {}", page_number, e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Rendering-Fehler auf Folie {}: {}", page_number, err.trim()));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = stdout_str.split(":::").collect();
    if parts.len() != 2 {
        return Err(format!("Ungültiges Rendering-Ergebnis für Folie {}", page_number));
    }

    let is_visual = parts[0] == "1";
    let webp_base64 = parts[1].to_string();
    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(&webp_base64)
        .map_err(|e| format!("Base64-Dekodierungsfehler: {}", e))?;

    let hash = hash_bytes(&raw_bytes);

    Ok(RenderedSlide {
        page_number,
        webp_base64,
        hash,
        is_visual,
    })
}

/// Reads the total page count of a PDF.
pub fn get_pdf_page_count(pdf_path: &Path, py_bin: Option<&Path>) -> Result<usize, String> {
    let py_exec = py_bin.unwrap_or_else(|| Path::new("python3"));
    let script = format!(
        r#"
import fitz
doc = fitz.open(r'{}')
print(len(doc))
doc.close()
"#,
        pdf_path.display()
    );

    let output = Command::new(py_exec)
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Fehler beim Öffnen der PDF: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("PDF-Fehler: {}", err.trim()));
    }

    let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    out_str
        .parse::<usize>()
        .map_err(|_| "Ungültige Seitenzahl".to_string())
}
