use std::sync::atomic::Ordering;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::cache;
use crate::providers;

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
    let base64_clean = if let Some(idx) = base64_raw.find(',') {
        &base64_raw[idx + 1..]
    } else {
        base64_raw
    };

    // 1. Compute SHA-256 hash of binary slide image
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_clean)
        .unwrap_or_else(|_| base64_clean.as_bytes().to_vec());
    let mut hasher = Sha256::new();
    hasher.update(&image_bytes);
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
