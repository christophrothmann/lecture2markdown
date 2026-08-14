#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use tauri::{Emitter, Manager};

fn get_secret_file_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let config_dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&config_dir);
    config_dir.join(".l2m_provider_keys.json")
}

fn read_keys_map(app: &tauri::AppHandle) -> HashMap<String, String> {
    let secret_path = get_secret_file_path(app);
    if secret_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&secret_path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                return map;
            }
        }
    }
    HashMap::new()
}

#[tauri::command]
async fn save_api_key_native(provider: String, key: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut map = read_keys_map(&app);
    map.insert(provider.trim().to_lowercase(), key.trim().to_string());
    
    let secret_path = get_secret_file_path(&app);
    let serialized = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    std::fs::write(&secret_path, serialized)
        .map_err(|e| format!("API-Key konnte nicht sicher gespeichert werden: {}", e))
}

#[tauri::command]
async fn get_api_keys_native(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(read_keys_map(&app))
}

#[tauri::command]
async fn get_api_key_native(provider: Option<String>, app: tauri::AppHandle) -> Result<String, String> {
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

    let target_provider = provider.trim().to_lowercase();
    let script = match target_provider.as_str() {
        "google" => format!(
            "from google import genai; client = genai.Client(api_key='{}'); list(client.models.list())",
            sanitized_key
        ),
        "anthropic" => format!(
            "from anthropic import Anthropic; client = Anthropic(api_key='{}'); client.models.list()",
            sanitized_key
        ),
        "mistral" => format!(
            "from l2m_core.providers.mistral_provider import Mistral; client = Mistral(api_key='{}'); client.models.list()",
            sanitized_key
        ),
        _ => format!(
            "from openai import OpenAI; client = OpenAI(api_key='{}'); client.models.list()",
            sanitized_key
        ),
    };

    let venv_python_candidates = [
        "../../.venv/bin/python",
        "../.venv/bin/python",
        ".venv/bin/python",
    ];

    let venv_python = venv_python_candidates
        .iter()
        .find(|p| Path::new(p).exists())
        .copied()
        .unwrap_or("python3");

    let output = Command::new(venv_python)
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Fehler beim Ausführen der Validierung: {}", e))?;

    if output.status.success() {
        Ok(true)
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        Err(format!("Ungültiger API-Key oder keine Verbindung: {}", err_msg.trim()))
    }
}

#[tauri::command]
async fn convert_lecture_native(
    pdf_path: String,
    _output_path: String,
    provider: Option<String>,
    api_key: String,
    window: tauri::Window,
) -> Result<String, String> {
    let chosen_provider = provider.unwrap_or_else(|| "openai".to_string()).to_lowercase();

    // 1. Resolve deterministic, writeable OS temp directory for output
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let temp_output_buf = std::env::temp_dir().join(format!("l2m_output_{}.md", timestamp));
    let safe_output_path = temp_output_buf.to_string_lossy().to_string();

    // 2. Resolve Single-Source-of-Truth Python script (lecture2md.py)
    let script_candidates = [
        "../../lecture2md.py",
        "../lecture2md.py",
        "lecture2md.py",
    ];

    let script_path = script_candidates
        .iter()
        .find(|p| Path::new(p).exists())
        .copied()
        .unwrap_or("../lecture2md.py");

    // 3. Resolve Python binary (prefer project virtualenv or uv run)
    let venv_python_candidates = [
        "../../.venv/bin/python",
        "../.venv/bin/python",
        ".venv/bin/python",
    ];

    let venv_python = venv_python_candidates
        .iter()
        .find(|p| Path::new(p).exists())
        .copied();

    let env_var_key = match chosen_provider.as_str() {
        "google" => "GEMINI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "mistral" => "MISTRAL_API_KEY",
        _ => "OPENAI_API_KEY",
    };

    let mut child = if let Some(py_bin) = venv_python {
        Command::new(py_bin)
            .arg(script_path)
            .arg("--pdf").arg(&pdf_path)
            .arg("--output").arg(&safe_output_path)
            .arg("--provider").arg(&chosen_provider)
            .arg("--json-stream")
            .env(env_var_key, &api_key)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Fehler beim Starten des Python-Prozesses ({}): {}", py_bin, e))?
    } else if Command::new("uv").arg("--version").output().is_ok() {
        Command::new("uv")
            .arg("run")
            .arg("python")
            .arg(script_path)
            .arg("--pdf").arg(&pdf_path)
            .arg("--output").arg(&safe_output_path)
            .arg("--provider").arg(&chosen_provider)
            .arg("--json-stream")
            .env(env_var_key, &api_key)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Fehler beim Starten von uv python: {}", e))?
    } else {
        let python_bin = if Command::new("python3").arg("--version").output().is_ok() {
            "python3"
        } else {
            "python"
        };
        Command::new(python_bin)
            .arg(script_path)
            .arg("--pdf").arg(&pdf_path)
            .arg("--output").arg(&safe_output_path)
            .arg("--provider").arg(&chosen_provider)
            .arg("--json-stream")
            .env(env_var_key, &api_key)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Fehler beim Starten von {}: {}", python_bin, e))?
    };

    let mut stderr_buf = String::new();

    let stdout_handle = if let Some(stdout) = child.stdout.take() {
        let window = window.clone();
        Some(std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = window.emit("python-event", line);
            }
        }))
    } else {
        None
    };

    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if let Some(h) = stdout_handle {
        let _ = h.join();
    }

    if status.success() {
        let content = std::fs::read_to_string(&safe_output_path)
            .map_err(|e| format!("Ausgabedatei ({}) konnte nicht gelesen werden: {}", safe_output_path, e))?;
        let _ = std::fs::remove_file(&safe_output_path); // Cleanup temp file
        Ok(content)
    } else {
        Err(format!("Python-Skript Ausführungsfehler (stderr): {}", stderr_buf))
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            convert_lecture_native,
            save_api_key_native,
            get_api_keys_native,
            get_api_key_native,
            validate_api_key_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
