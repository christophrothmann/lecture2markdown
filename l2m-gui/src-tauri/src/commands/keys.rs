use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use crate::providers;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

pub fn get_secret_file_path(app: &tauri::AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = fs::create_dir_all(&config_dir);
    config_dir.join(".l2m_provider_keys.json")
}

pub fn read_keys_map(app: &tauri::AppHandle) -> HashMap<String, String> {
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

#[tauri::command]
pub async fn save_api_key_native(
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
pub async fn get_api_keys_native(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(read_keys_map(&app))
}

#[tauri::command]
pub async fn get_api_key_native(
    provider: Option<String>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let target = provider.unwrap_or_else(|| "openai".to_string()).to_lowercase();
    let map = read_keys_map(&app);
    Ok(map.get(&target).cloned().unwrap_or_default())
}

#[tauri::command]
pub async fn validate_api_key_native(provider: String, key: String) -> Result<bool, String> {
    let sanitized_key = key.trim();
    if sanitized_key.is_empty() {
        return Err("Bitte gib einen API-Key ein.".to_string());
    }

    let prov = providers::get_provider(&provider, sanitized_key);
    prov.validate_key().await
}
