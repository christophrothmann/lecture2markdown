use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;

use crate::cache;
use crate::providers;
use crate::AppState;

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

fn slide_cache_key(image_bytes: &[u8], provider: &str, is_visual: bool) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(b"l2m-slide-cache-v2\0");
    hasher.update(image_bytes);
    hasher.update([0]);
    hasher.update(provider.as_bytes());
    hasher.update([u8::from(is_visual)]);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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

    let requested_provider = provider
        .as_deref()
        .unwrap_or("openai")
        .trim()
        .to_lowercase();
    let chosen_provider = match requested_provider.as_str() {
        "google" | "anthropic" | "mistral" => requested_provider,
        _ => "openai".to_string(),
    };
    let prov = providers::get_provider(&chosen_provider, &api_key);
    let is_visual = slide.is_visual.unwrap_or(true);
    let base64_raw = slide.webp_base64.trim();
    let base64_clean = if let Some(idx) = base64_raw.find(',') {
        &base64_raw[idx + 1..]
    } else {
        base64_raw
    };

    // 1. Compute SHA-256 hash of binary slide image
    use base64::Engine;
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_clean)
        .map_err(|e| format!("Ungültiges Folienbild: {}", e))?;
    let slide_hash = slide_cache_key(&image_bytes, &chosen_provider, is_visual);

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

#[cfg(test)]
mod tests {
    use super::slide_cache_key;

    #[test]
    fn cache_key_includes_provider_and_routing_class() {
        let image = b"slide image";
        let openai_visual = slide_cache_key(image, "openai", true);

        assert_ne!(openai_visual, slide_cache_key(image, "anthropic", true));
        assert_ne!(openai_visual, slide_cache_key(image, "openai", false));
        assert_ne!(
            openai_visual,
            slide_cache_key(b"different image", "openai", true)
        );
    }
}
