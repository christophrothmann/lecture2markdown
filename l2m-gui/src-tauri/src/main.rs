#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod pdf;
mod providers;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Semaphore;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

pub struct AppState {
    pub cancel_requested: Arc<AtomicBool>,
}

fn get_secret_file_path(app: &tauri::AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = fs::create_dir_all(&config_dir);
    config_dir.join(".l2m_provider_keys.json")
}

fn read_keys_map(app: &tauri::AppHandle) -> HashMap<String, String> {
    let secret_path = get_secret_file_path(app);
    if secret_path.exists() {
        if let Ok(content) = fs::read_to_string(&secret_path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                return map;
            }
        }
    }
    HashMap::new()
}

/// Dynamically locates the Python binary (optional for PDF render helpers).
fn find_python_binary() -> Option<PathBuf> {
    let mut search_dirs = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        search_dirs.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            search_dirs.push(parent.to_path_buf());
        }
    }

    for start_dir in search_dirs {
        let mut curr = Some(start_dir.as_path());
        while let Some(dir) = curr {
            let venv_candidate = dir.join(".venv");
            if venv_candidate.exists() {
                #[cfg(unix)]
                let py_bin = venv_candidate.join("bin").join("python3");
                #[cfg(unix)]
                let py_bin_alt = venv_candidate.join("bin").join("python");
                #[cfg(windows)]
                let py_bin = venv_candidate.join("Scripts").join("python.exe");
                #[cfg(windows)]
                let py_bin_alt = venv_candidate.join("Scripts").join("python.exe");

                if py_bin.exists() {
                    return Some(py_bin);
                } else if py_bin_alt.exists() {
                    return Some(py_bin_alt);
                }
            }
            curr = dir.parent();
        }
    }
    None
}

#[tauri::command]
async fn cancel_conversion_native(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.cancel_requested.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn save_api_key_native(
    provider: String,
    key: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut map = read_keys_map(&app);
    map.insert(provider.trim().to_lowercase(), key.trim().to_string());

    let secret_path = get_secret_file_path(&app);
    let serialized = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    fs::write(&secret_path, serialized)
        .map_err(|e| format!("API-Key konnte nicht sicher gespeichert werden: {}", e))?;

    #[cfg(unix)]
    {
        if let Ok(file) = fs::File::open(&secret_path) {
            if let Ok(meta) = file.metadata() {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = fs::set_permissions(&secret_path, perms);
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn get_api_keys_native(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(read_keys_map(&app))
}

#[tauri::command]
async fn get_api_key_native(
    provider: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let target = provider.unwrap_or_else(|| "openai".to_string()).to_lowercase();
    let map = read_keys_map(&app);
    Ok(map.get(&target).cloned().unwrap_or_default())
}

#[tauri::command]
async fn validate_api_key_native(provider: String, key: String) -> Result<bool, String> {
    let sanitized_key = key.trim();
    if sanitized_key.is_empty() {
        return Err("Bitte gib einen API-Key ein.".to_string());
    }

    let prov = providers::get_provider(&provider, sanitized_key);
    prov.validate_key().await
}

#[tauri::command]
async fn clear_slide_cache_native(app: tauri::AppHandle) -> Result<usize, String> {
    cache::clear_slide_cache(&app)
}

#[tauri::command]
async fn get_slide_cache_stats_native(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let (count, size_bytes) = cache::get_cache_stats(&app);
    let size_kb = (size_bytes as f64 / 1024.0).round();
    Ok(serde_json::json!({
        "count": count,
        "size_kb": size_kb
    }))
}

#[tauri::command]
async fn convert_lecture_native(
    pdf_path: String,
    _output_path: String,
    provider: Option<String>,
    api_key: String,
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    state.cancel_requested.store(false, Ordering::SeqCst);
    let chosen_provider = provider.unwrap_or_else(|| "openai".to_string()).to_lowercase();
    let path = Path::new(&pdf_path);
    if !path.exists() {
        return Err(format!("PDF-Datei nicht gefunden: {}", pdf_path));
    }

    let py_bin = find_python_binary();
    let total_pages = pdf::get_pdf_page_count(path, py_bin.as_deref())?;

    let file_name = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "Vorlesung.pdf".to_string());

    // Emit start event
    let _ = window.emit(
        "python-event",
        serde_json::json!({
            "type": "start",
            "total_pages": total_pages,
            "pdf_name": file_name
        })
        .to_string(),
    );

    let prov: Arc<Box<dyn providers::BaseProvider>> = Arc::new(providers::get_provider(&chosen_provider, &api_key));
    let mut sections: Vec<String> = vec![String::new(); total_pages];
    
    // Provider-specific balanced concurrency to prevent hitting RPM/TPM tier caps:
    let concurrency = match chosen_provider.as_str() {
        "google" => 2,
        "anthropic" => 4,
        "mistral" => 4,
        _ => 6,
    };
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let completed_counter = Arc::new(AtomicUsize::new(0));

    let mut tasks: Vec<tokio::task::JoinHandle<Result<(usize, String, String), String>>> = Vec::new();

    for idx in 0..total_pages {
        let path_buf = path.to_path_buf();
        let py_bin_clone = py_bin.clone();
        let prov_clone = Arc::clone(&prov);
        let sem_clone = Arc::clone(&semaphore);
        let app_handle = app.clone();
        let win_clone = window.clone();
        let comp_clone = Arc::clone(&completed_counter);
        let cancel_flag = Arc::clone(&state.cancel_requested);
        let total_pages_val = total_pages;

        let task = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.unwrap();

            if cancel_flag.load(Ordering::SeqCst) {
                return Err("Abgebrochen".to_string());
            }

            // 1. Render slide to WebP and compute SHA-256 hash
            let rendered = pdf::render_pdf_slide_to_webp(
                &path_buf,
                idx,
                py_bin_clone.as_deref(),
            )?;

            if cancel_flag.load(Ordering::SeqCst) {
                return Err("Abgebrochen".to_string());
            }

            // 2. Check Slide Cache
            if let Some(cached_md) = cache::get_cached_slide(&app_handle, &rendered.hash) {
                let comp = comp_clone.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = win_clone.emit(
                    "python-event",
                    serde_json::json!({
                        "type": "progress",
                        "completed": comp,
                        "total": total_pages_val,
                        "page_number": rendered.page_number,
                        "model_used": "cache-hit"
                    })
                    .to_string(),
                );

                return Ok((
                    idx,
                    format!("## [Folie {}]\n{}\n", rendered.page_number, cached_md),
                    "cache-hit".to_string(),
                ));
            }

            // 3. Execute Async Multi-Provider Inferenz
            let (markdown, model_used) = prov_clone
                .as_ref()
                .transcribe_slide(
                    &rendered.webp_base64,
                    rendered.page_number,
                    rendered.is_visual,
                    true,
                )
                .await?;

            if cancel_flag.load(Ordering::SeqCst) {
                return Err("Abgebrochen".to_string());
            }

            // 4. Save to Cache
            cache::store_cached_slide(&app_handle, &rendered.hash, &markdown);

            // 5. Emit real-time progress INSTANTLY upon slide completion!
            let comp = comp_clone.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = win_clone.emit(
                "python-event",
                serde_json::json!({
                    "type": "progress",
                    "completed": comp,
                    "total": total_pages_val,
                    "page_number": rendered.page_number,
                    "model_used": model_used
                })
                .to_string(),
            );

            Ok((
                idx,
                format!("## [Folie {}]\n{}\n", rendered.page_number, markdown),
                model_used,
            ))
        });

        tasks.push(task);
    }

    for task in tasks {
        match task.await {
            Ok(Ok((page_idx, formatted_content, _model_used))) => {
                sections[page_idx] = formatted_content;
            }
            Ok(Err(err)) => {
                if state.cancel_requested.load(Ordering::SeqCst) || err == "Abgebrochen" {
                    return Err("Konvertierung abgebrochen.".to_string());
                }
                return Err(format!("Verarbeitungsfehler: {}", err));
            }
            Err(e) => {
                if state.cancel_requested.load(Ordering::SeqCst) {
                    return Err("Konvertierung abgebrochen.".to_string());
                }
                return Err(format!("Task-Join-Fehler: {}", e));
            }
        }
    }

    if state.cancel_requested.load(Ordering::SeqCst) {
        return Err("Konvertierung abgebrochen.".to_string());
    }

    let file_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Lecture".to_string());

    let header = format!(
        "# Lecture: {}\n**Source:** {}\n\n",
        file_stem, file_name
    );

    let full_markdown = format!("{}{}", header, sections.join("\n---\n\n"));

    let _ = window.emit(
        "python-event",
        serde_json::json!({
            "type": "complete",
            "total_pages": total_pages,
            "content": full_markdown
        })
        .to_string(),
    );

    Ok(full_markdown)
}

fn main() {
    let app_state = AppState {
        cancel_requested: Arc::new(AtomicBool::new(false)),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            convert_lecture_native,
            cancel_conversion_native,
            save_api_key_native,
            get_api_keys_native,
            get_api_key_native,
            validate_api_key_native,
            clear_slide_cache_native,
            get_slide_cache_stats_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
