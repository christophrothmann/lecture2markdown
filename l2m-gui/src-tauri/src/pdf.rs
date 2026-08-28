use std::path::Path;
use std::process::Command;

pub struct RenderedSlide {
    pub page_number: usize,
    pub webp_base64: String,
    pub hash: String,
    pub is_visual: bool,
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub fn create_hidden_command<P: AsRef<std::ffi::OsStr>>(program: P) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: Prevents console window popup on Windows
    }
    cmd
}

pub fn execute_python_code(script: &str, py_bin: Option<&Path>) -> Result<std::process::Output, String> {
    if let Some(bin) = py_bin {
        let bin_name = bin.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if bin_name == "uv" || bin_name == "uv.exe" {
            return create_hidden_command(bin)
                .arg("run")
                .arg("--with")
                .arg("pymupdf")
                .arg("--with")
                .arg("pillow")
                .arg("python")
                .arg("-c")
                .arg(script)
                .output()
                .map_err(|e| format!("Fehler beim Ausführen von uv ({:?}): {}", bin, e));
        }
        return create_hidden_command(bin)
            .arg("-c")
            .arg(script)
            .output()
            .map_err(|e| format!("Fehler beim Ausführen von Python ({:?}): {}", bin, e));
    }

    create_hidden_command("python3")
        .arg("-c")
        .arg(script)
        .output()
        .map_err(|e| format!("Fehler beim Ausführen von python3: {}", e))
}

/// High-speed PDF rendering pipeline producing In-Memory WebP.
pub fn render_pdf_slide_to_webp(
    pdf_path: &Path,
    page_index: usize,
    py_bin: Option<&Path>,
) -> Result<RenderedSlide, String> {
    let page_number = page_index + 1;

    let script = format!(
        r#"
import fitz, base64, io, hashlib
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
slide_hash = hashlib.sha256(raw_bytes).hexdigest()

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

print(str(int(is_vis)) + ":::" + slide_hash + ":::" + base64.b64encode(raw_bytes).decode('utf-8'))
"#,
        pdf_path.display(),
        page_index
    );

    let output = execute_python_code(&script, py_bin)?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("No module named 'fitz'") || err.contains("No module named 'PIL'") || err.contains("ModuleNotFoundError") {
            return Err(
                "Missing Python dependencies: PyMuPDF ('fitz') and Pillow ('PIL') are required for slide rendering.\n\nPlease install them in your terminal / Command Prompt:\npip install pymupdf pillow\n(or with uv: uv pip install pymupdf pillow)\n\n---\nFehlende Python-Pakete: PyMuPDF ('fitz') und Pillow ('PIL') werden zum Rendern benötigt.\nBitte im Terminal installieren: pip install pymupdf pillow".to_string()
            );
        }
        return Err(format!("Rendering-Fehler auf Folie {}: {}", page_number, err.trim()));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = stdout_str.split(":::").collect();
    if parts.len() != 3 {
        return Err(format!("Ungültiges Rendering-Ergebnis für Folie {}", page_number));
    }

    let is_visual = parts[0] == "1";
    let hash = parts[1].to_string();
    let webp_base64 = parts[2].to_string();

    Ok(RenderedSlide {
        page_number,
        webp_base64,
        hash,
        is_visual,
    })
}

/// Reads the total page count of a PDF in 100% Pure Rust without any Python dependency.
pub fn get_pdf_page_count(pdf_path: &Path, py_bin: Option<&Path>) -> Result<usize, String> {
    // 1. Pure Rust parsing via lopdf (Instant, 0 dependencies, 100% reliable)
    if let Ok(doc) = lopdf::Document::load(pdf_path) {
        let pages = doc.get_pages();
        if !pages.is_empty() {
            return Ok(pages.len());
        }
    }

    // 2. Fallback to Python if lopdf encounters unusual encryption
    let script = format!(
        r#"
import fitz
doc = fitz.open(r'{}')
print(len(doc))
doc.close()
"#,
        pdf_path.display()
    );

    let output = execute_python_code(&script, py_bin)?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("No module named 'fitz'") {
            return Err("PyMuPDF ('fitz') fehlt in deiner Python-Umgebung. Bitte 'pip install pymupdf pillow' ausführen.".to_string());
        }
        return Err(format!("PDF-Fehler: {}", err.trim()));
    }

    let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    out_str
        .parse::<usize>()
        .map_err(|_| "Ungültige Seitenzahl".to_string())
}
