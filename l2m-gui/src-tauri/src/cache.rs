use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const DEFAULT_TTL_DAYS: u64 = 180; // 6 months TTL
const MAX_CACHE_ENTRIES: usize = 1500; // LRU cap

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SlideCacheEntry {
    pub hash: String,
    pub markdown: String,
    pub created_at: u64,
    pub last_accessed: u64,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct SlideCacheStore {
    pub entries: HashMap<String, SlideCacheEntry>,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn get_cache_file_path(app: &tauri::AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = fs::create_dir_all(&config_dir);
    config_dir.join(".l2m_slide_cache.json")
}

pub fn load_cache(app: &tauri::AppHandle) -> SlideCacheStore {
    let path = get_cache_file_path(app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mut store) = serde_json::from_str::<SlideCacheStore>(&content) {
                // Auto prune expired items older than 180 days
                let cutoff = now_unix().saturating_sub(DEFAULT_TTL_DAYS * 86400);
                store.entries.retain(|_, v| v.created_at >= cutoff);
                return store;
            }
        }
    }
    SlideCacheStore::default()
}

pub fn save_cache(app: &tauri::AppHandle, store: &SlideCacheStore) -> Result<(), String> {
    let path = get_cache_file_path(app);
    let json_data = serde_json::to_string(store).map_err(|e| e.to_string())?;
    fs::write(&path, json_data).map_err(|e| e.to_string())
}

pub fn get_cached_slide(app: &tauri::AppHandle, hash: &str) -> Option<String> {
    let mut store = load_cache(app);
    if let Some(entry) = store.entries.get_mut(hash) {
        entry.last_accessed = now_unix();
        let md = entry.markdown.clone();
        let _ = save_cache(app, &store);
        return Some(md);
    }
    None
}

pub fn store_cached_slide(app: &tauri::AppHandle, hash: &str, markdown: &str) {
    let mut store = load_cache(app);

    // LRU eviction if cache exceeds max capacity
    if store.entries.len() >= MAX_CACHE_ENTRIES {
        if let Some((oldest_key, _)) = store
            .entries
            .iter()
            .min_by_key(|(_, v)| v.last_accessed)
            .map(|(k, v)| (k.clone(), v.clone()))
        {
            store.entries.remove(&oldest_key);
        }
    }

    let now = now_unix();
    store.entries.insert(
        hash.to_string(),
        SlideCacheEntry {
            hash: hash.to_string(),
            markdown: markdown.to_string(),
            created_at: now,
            last_accessed: now,
        },
    );

    let _ = save_cache(app, &store);
}

pub fn clear_slide_cache(app: &tauri::AppHandle) -> Result<usize, String> {
    let mut store = load_cache(app);
    let count = store.entries.len();
    store.entries.clear();
    save_cache(app, &store)?;
    Ok(count)
}

pub fn get_cache_stats(app: &tauri::AppHandle) -> (usize, u64) {
    let path = get_cache_file_path(app);
    let store = load_cache(app);
    let count = store.entries.len();
    let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    (count, size_bytes)
}
