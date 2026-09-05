use crate::cache;

#[tauri::command]
pub async fn clear_slide_cache_native(app: tauri::AppHandle) -> Result<usize, String> {
    cache::clear_slide_cache(&app)
}

#[tauri::command]
pub async fn get_slide_cache_stats_native(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let (count, size_bytes) = cache::get_cache_stats(&app);
    let size_kb = (size_bytes as f64 / 1024.0).round();
    Ok(serde_json::json!({
        "count": count,
        "size_kb": size_kb
    }))
}
