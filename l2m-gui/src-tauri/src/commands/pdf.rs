use std::path::{Path, PathBuf};
use crate::pdf;

static PYTHON_BIN_CACHE: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

pub fn check_python_candidate(candidate: &Path) -> bool {
    let bin_name = candidate.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if bin_name == "uv" || bin_name == "uv.exe" {
        if let Ok(output) = pdf::create_hidden_command(candidate)
            .arg("run")
            .arg("--with")
            .arg("pymupdf")
            .arg("--with")
            .arg("pillow")
            .arg("python")
            .arg("-c")
            .arg("import fitz, PIL")
            .output()
        {
            return output.status.success();
        }
        return false;
    }

    if !candidate.exists() {
        return false;
    }
    if let Ok(output) = pdf::create_hidden_command(candidate)
        .arg("-c")
        .arg("import fitz, PIL")
        .output()
    {
        return output.status.success();
    }
    false
}

/// Dynamically locates a working Python or uv binary.
pub fn find_python_binary() -> Option<PathBuf> {
    PYTHON_BIN_CACHE
        .get_or_init(|| {
            let mut candidate_paths = Vec::new();

            // 1. Check local & parent virtual environments
            if let Ok(cwd) = std::env::current_dir() {
                let mut curr = Some(cwd.as_path());
                while let Some(dir) = curr {
                    candidate_paths.push(dir.join(".venv/bin/python3"));
                    candidate_paths.push(dir.join(".venv/bin/python"));
                    candidate_paths.push(dir.join(".venv/Scripts/python.exe"));
                    curr = dir.parent();
                }
            }

            // 2. Check user home directories & tools
            if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
                let home_path = PathBuf::from(home);
                candidate_paths.push(home_path.join(".cargo/bin/uv"));
                candidate_paths.push(home_path.join(".local/bin/uv"));
                candidate_paths.push(home_path.join(".local/bin/python3"));
                candidate_paths.push(home_path.join(".venv/bin/python3"));
                candidate_paths.push(home_path.join(".virtualenvs/lecture2markdown/bin/python3"));
                candidate_paths.push(home_path.join(".pyenv/shims/python3"));
                candidate_paths.push(home_path.join(".pyenv/shims/python"));
            }

            // 3. Check standard Unix/macOS package manager paths
            #[cfg(unix)]
            {
                candidate_paths.push(PathBuf::from("/opt/homebrew/bin/uv"));
                candidate_paths.push(PathBuf::from("/usr/local/bin/uv"));
                candidate_paths.push(PathBuf::from("/opt/homebrew/bin/python3"));
                candidate_paths.push(PathBuf::from("/opt/homebrew/bin/python3.12"));
                candidate_paths.push(PathBuf::from("/opt/homebrew/bin/python3.11"));
                candidate_paths.push(PathBuf::from("/opt/homebrew/bin/python3.10"));
                candidate_paths.push(PathBuf::from("/usr/local/bin/python3"));
                candidate_paths.push(PathBuf::from("/Library/Frameworks/Python.framework/Versions/Current/bin/python3"));
            }

            // 4. Check standard Windows installation paths
            #[cfg(windows)]
            {
                if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
                    let local_path = PathBuf::from(local_appdata);
                    for ver in &["Python313", "Python312", "Python311", "Python310", "Python39"] {
                        candidate_paths.push(local_path.join("Programs/Python").join(ver).join("python.exe"));
                        candidate_paths.push(local_path.join("Programs/Python").join(ver).join("Scripts/uv.exe"));
                    }
                }
                if let Ok(prog_files) = std::env::var("ProgramFiles") {
                    let pf_path = PathBuf::from(prog_files);
                    for ver in &["Python313", "Python312", "Python311", "Python310"] {
                        candidate_paths.push(pf_path.join(ver).join("python.exe"));
                    }
                }
                for drive in &["C:\\", "D:\\"] {
                    for ver in &["Python313", "Python312", "Python311", "Python310"] {
                        candidate_paths.push(PathBuf::from(drive).join(ver).join("python.exe"));
                    }
                }
            }

            // 5. Test PATH binaries
            candidate_paths.push(PathBuf::from("uv"));
            candidate_paths.push(PathBuf::from("python3"));
            candidate_paths.push(PathBuf::from("python"));

            // Pick the first candidate where `import fitz, PIL` succeeds!
            for candidate in &candidate_paths {
                if check_python_candidate(candidate) {
                    return Some(candidate.clone());
                }
            }

            // If no candidate with fitz was found, return the first existing candidate
            candidate_paths.into_iter().find(|c| c.exists())
        })
        .clone()
}

#[tauri::command]
pub async fn get_pdf_page_count_native(pdf_path: String) -> Result<usize, String> {
    let path = Path::new(&pdf_path);
    if !path.exists() {
        return Err(format!("PDF-Datei nicht gefunden: {}", pdf_path));
    }
    // 1. Fast pure-Rust PDF parser (0 Python!)
    if let Ok(doc) = lopdf::Document::load(path) {
        let pages = doc.get_pages();
        if !pages.is_empty() {
            return Ok(pages.len());
        }
    }
    // 2. Fallback
    let py_bin = find_python_binary();
    pdf::get_pdf_page_count(path, py_bin.as_deref())
}

#[tauri::command]
pub async fn get_slide_image_native(
    pdf_path: String,
    page_index: usize,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&pdf_path);
        if !path.exists() {
            return Err(format!("PDF-Datei nicht gefunden: {}", pdf_path));
        }
        let py_bin = find_python_binary();
        let rendered = pdf::render_pdf_slide_to_webp(&path, page_index, py_bin.as_deref())?;
        Ok(rendered.webp_base64)
    })
    .await
    .map_err(|e| format!("Task-Fehler: {}", e))?
}
