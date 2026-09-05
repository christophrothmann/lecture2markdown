use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::Semaphore;

use crate::AppState;
use crate::cache;
use crate::pdf;
use crate::providers;
use super::pdf::find_python_binary;

type SlideTaskResult = Result<(usize, String, String), String>;

#[derive(Deserialize, Clone, Debug)]
pub struct SlideInput {
    pub page_number: usize,
    pub webp_base64: String,
    pub is_visual: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SingleSlideResult {
    pub page_number: usize,
    pub markdown: String,
    pub model_used: String,
    pub is_cache_hit: bool,
}

#[tauri::command]
pub async fn cancel_conversion_native(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.cancel_requested.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn convert_lecture_native(
    pdf_path: String,
    _output_path: String,
    provider: Option<String>,
    api_key: String,
    start_page: Option<usize>,
    end_page: Option<usize>,
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
    let total_doc_pages = pdf::get_pdf_page_count(path, py_bin.as_deref())?;

    // Determine target slide range (1-indexed input converted to 0-indexed indices)
    let s_page = start_page.unwrap_or(1).clamp(1, total_doc_pages);
    let e_page = end_page.unwrap_or(total_doc_pages).clamp(s_page, total_doc_pages);
    let selected_indices: Vec<usize> = ((s_page - 1)..e_page).collect();
    let total_selected_pages = selected_indices.len();

    let file_name = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "Vorlesung.pdf".to_string());

    // Emit start event with total selected pages
    let _ = window.emit(
        "python-event",
        serde_json::json!({
            "type": "start",
            "total_pages": total_selected_pages,
            "pdf_name": file_name
        })
        .to_string(),
    );

    let prov: Arc<Box<dyn providers::BaseProvider>> = Arc::new(providers::get_provider(&chosen_provider, &api_key));
    let mut sections: Vec<(usize, String)> = Vec::new();
    
    // Provider-specific balanced concurrency to prevent hitting RPM/TPM tier caps:
    let concurrency = match chosen_provider.as_str() {
        "google" => 2,
        "anthropic" => 4,
        "mistral" => 4,
        _ => 6,
    };
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let completed_counter = Arc::new(AtomicUsize::new(0));

    let mut tasks: Vec<tokio::task::JoinHandle<SlideTaskResult>> = Vec::new();

    for idx in selected_indices {
        let path_buf = path.to_path_buf();
        let py_bin_clone = py_bin.clone();
        let prov_clone = Arc::clone(&prov);
        let sem_clone = Arc::clone(&semaphore);
        let app_handle = app.clone();
        let win_clone = window.clone();
        let comp_clone = Arc::clone(&completed_counter);
        let cancel_flag = Arc::clone(&state.cancel_requested);
        let total_pages_val = total_selected_pages;

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
                sections.push((page_idx, formatted_content));
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

    // Sort sections by original page index
    sections.sort_by_key(|k| k.0);
    let joined_sections: Vec<String> = sections.into_iter().map(|(_, s)| s).collect();

    let file_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Lecture".to_string());

    let header = if s_page == 1 && e_page == total_doc_pages {
        format!(
            "# Lecture: {}\n**Source:** {} ({} Folien)\n\n",
            file_stem, file_name, total_doc_pages
        )
    } else {
        format!(
            "# Lecture: {}\n**Source:** {} (Folien {} bis {} von {})\n\n",
            file_stem, file_name, s_page, e_page, total_doc_pages
        )
    };

    let full_markdown = format!("{}{}", header, joined_sections.join("\n---\n\n"));

    let _ = window.emit(
        "python-event",
        serde_json::json!({
            "type": "complete",
            "total_pages": total_selected_pages,
            "content": full_markdown
        })
        .to_string(),
    );

    Ok(full_markdown)
}

#[tauri::command]
pub async fn transcribe_slides_native(
    slides: Vec<SlideInput>,
    provider: Option<String>,
    api_key: String,
    file_name: Option<String>,
    window: tauri::Window,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    state.cancel_requested.store(false, Ordering::SeqCst);
    let chosen_provider = provider.unwrap_or_else(|| "openai".to_string()).to_lowercase();
    let total_selected_pages = slides.len();
    let clean_file_name = file_name.unwrap_or_else(|| "Vorlesung.pdf".to_string());

    // Emit start event with total selected pages
    let _ = window.emit(
        "python-event",
        serde_json::json!({
            "type": "start",
            "total_pages": total_selected_pages,
            "pdf_name": clean_file_name
        })
        .to_string(),
    );

    let prov: Arc<Box<dyn providers::BaseProvider>> = Arc::new(providers::get_provider(&chosen_provider, &api_key));
    let mut sections: Vec<(usize, String)> = Vec::new();
    
    // Provider-specific balanced concurrency to prevent hitting RPM/TPM tier caps:
    let concurrency = match chosen_provider.as_str() {
        "google" => 2,
        "anthropic" => 4,
        "mistral" => 4,
        _ => 6,
    };
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let completed_counter = Arc::new(AtomicUsize::new(0));

    let mut tasks: Vec<tokio::task::JoinHandle<SlideTaskResult>> = Vec::new();

    for (idx, slide) in slides.into_iter().enumerate() {
        let prov_clone = Arc::clone(&prov);
        let sem_clone = Arc::clone(&semaphore);
        let app_handle = app.clone();
        let win_clone = window.clone();
        let comp_clone = Arc::clone(&completed_counter);
        let cancel_flag = Arc::clone(&state.cancel_requested);
        let total_pages_val = total_selected_pages;
        let is_visual_val = slide.is_visual.unwrap_or(true);
        let page_num = slide.page_number;
        let base64_clean = slide.webp_base64.trim().strip_prefix("data:image/webp;base64,").unwrap_or(&slide.webp_base64).to_string();

        let task = tokio::spawn(async move {
            let _permit = sem_clone.acquire().await.unwrap();

            if cancel_flag.load(Ordering::SeqCst) {
                return Err("Abgebrochen".to_string());
            }

            // 1. Compute SHA-256 hash of slide image
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(base64_clean.as_bytes());
            let hash_bytes = hasher.finalize();
            let slide_hash: String = hash_bytes.iter().map(|b| format!("{:02x}", b)).collect();

            // 2. Check Slide Cache
            if let Some(cached_md) = cache::get_cached_slide(&app_handle, &slide_hash) {
                let comp = comp_clone.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = win_clone.emit(
                    "python-event",
                    serde_json::json!({
                        "type": "progress",
                        "completed": comp,
                        "total": total_pages_val,
                        "page_number": page_num,
                        "model_used": "cache-hit"
                    })
                    .to_string(),
                );

                return Ok((
                    idx,
                    format!("## [Folie {}]\n{}\n", page_num, cached_md),
                    "cache-hit".to_string(),
                ));
            }

            // 3. Execute Multi-Provider Inference
            let (markdown, model_used) = prov_clone
                .as_ref()
                .transcribe_slide(
                    &base64_clean,
                    page_num,
                    is_visual_val,
                    true,
                )
                .await?;

            if cancel_flag.load(Ordering::SeqCst) {
                return Err("Abgebrochen".to_string());
            }

            // 4. Save to Cache
            cache::store_cached_slide(&app_handle, &slide_hash, &markdown);

            let comp = comp_clone.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = win_clone.emit(
                "python-event",
                serde_json::json!({
                    "type": "progress",
                    "completed": comp,
                    "total": total_pages_val,
                    "page_number": page_num,
                    "model_used": model_used.clone()
                })
                .to_string(),
            );

            Ok((
                idx,
                format!("## [Folie {}]\n{}\n", page_num, markdown),
                model_used,
            ))
        });

        tasks.push(task);
    }

    let mut model_tallies: HashMap<String, usize> = HashMap::new();

    for task in tasks {
        let result = task
            .await
            .map_err(|e| format!("Task-Fehler: {}", e))??;
        *model_tallies.entry(result.2).or_insert(0) += 1;
        sections.push((result.0, result.1));
    }

    sections.sort_by_key(|k| k.0);

    let joined_sections: Vec<String> = sections.into_iter().map(|s| s.1).collect();
    let file_stem = clean_file_name.strip_suffix(".pdf").or_else(|| clean_file_name.strip_suffix(".PDF")).unwrap_or(&clean_file_name);

    let header = format!(
        "# Lecture: {}\n**Source:** {} ({} Folien)\n\n",
        file_stem, clean_file_name, total_selected_pages
    );

    let full_markdown = format!("{}{}", header, joined_sections.join("\n---\n\n"));

    let _ = window.emit(
        "python-event",
        serde_json::json!({
            "type": "complete",
            "total_pages": total_selected_pages,
            "content": full_markdown
        })
        .to_string(),
    );

    Ok(full_markdown)
}

#[tauri::command]
pub async fn transcribe_single_slide_native(
    slide: SlideInput,
    provider: Option<String>,
    api_key: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SingleSlideResult, String> {
    if state.cancel_requested.load(Ordering::SeqCst) {
        return Err("Abgebrochen".to_string());
    }

    let chosen_provider = provider.unwrap_or_else(|| "openai".to_string()).to_lowercase();
    let prov = providers::get_provider(&chosen_provider, &api_key);
    let base64_raw = slide.webp_base64.trim();
    let base64_clean = base64_raw
        .strip_prefix("data:image/webp;base64,")
        .or_else(|| base64_raw.strip_prefix("data:image/jpeg;base64,"))
        .or_else(|| base64_raw.strip_prefix("data:image/png;base64,"))
        .unwrap_or(base64_raw);

    // 1. Compute SHA-256 hash of slide image
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(base64_clean.as_bytes());
    let hash_bytes = hasher.finalize();
    let slide_hash: String = hash_bytes.iter().map(|b| format!("{:02x}", b)).collect();

    // 2. Check Slide Cache
    if let Some(cached_md) = cache::get_cached_slide(&app, &slide_hash) {
        return Ok(SingleSlideResult {
            page_number: slide.page_number,
            markdown: format!("## [Folie {}]\n{}\n", slide.page_number, cached_md),
            model_used: "cache-hit".to_string(),
            is_cache_hit: true,
        });
    }

    // 3. Execute Multi-Provider Inference
    let is_visual = slide.is_visual.unwrap_or(true);
    let (markdown, model_used) = prov
        .transcribe_slide(base64_clean, slide.page_number, is_visual, true)
        .await?;

    if state.cancel_requested.load(Ordering::SeqCst) {
        return Err("Abgebrochen".to_string());
    }

    // 4. Save to Cache
    cache::store_cached_slide(&app, &slide_hash, &markdown);

    Ok(SingleSlideResult {
        page_number: slide.page_number,
        markdown: format!("## [Folie {}]\n{}\n", slide.page_number, markdown),
        model_used,
        is_cache_hit: false,
    })
}
