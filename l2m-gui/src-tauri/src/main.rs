#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use tauri::{Emitter, Manager};

fn get_secret_file_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let config_dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&config_dir);
    config_dir.join(".openai_key_store")
}

#[tauri::command]
async fn save_api_key_native(key: String, app: tauri::AppHandle) -> Result<(), String> {
    let secret_path = get_secret_file_path(&app);
    std::fs::write(&secret_path, key.trim())
        .map_err(|e| format!("API-Key konnte nicht sicher gespeichert werden: {}", e))
}

#[tauri::command]
async fn get_api_key_native(app: tauri::AppHandle) -> Result<String, String> {
    let secret_path = get_secret_file_path(&app);
    if secret_path.exists() {
        std::fs::read_to_string(&secret_path)
            .map(|s| s.trim().to_string())
            .map_err(|e| format!("API-Key konnte nicht ausgelesen werden: {}", e))
    } else {
        Ok("".to_string())
    }
}

#[tauri::command]
async fn validate_api_key_native(key: String) -> Result<bool, String> {
    let sanitized_key = key.trim();
    if sanitized_key.is_empty() {
        return Err("Bitte gib einen API-Key ein.".to_string());
    }

    let script = format!(
        "import sys; from openai import OpenAI; client = OpenAI(api_key='{}'); client.models.list()",
        sanitized_key
    );

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
        Err("Ungültiger API-Key oder keine Verbindung zu OpenAI.".to_string())
    }
}

#[tauri::command]
async fn convert_lecture_native(
    pdf_path: String,
    _output_path: String,
    api_key: String,
    window: tauri::Window,
) -> Result<String, String> {
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

    let mut child = if let Some(py_bin) = venv_python {
        Command::new(py_bin)
            .arg(script_path)
            .arg("--pdf").arg(&pdf_path)
            .arg("--output").arg(&safe_output_path)
            .arg("--json-stream")
            .env("OPENAI_API_KEY", &api_key)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Fehler beim Starten des venv Python-Prozesses ({}): {}", py_bin, e))?
    } else if Command::new("uv").arg("--version").output().is_ok() {
        Command::new("uv")
            .arg("run")
            .arg("python")
            .arg(script_path)
            .arg("--pdf").arg(&pdf_path)
            .arg("--output").arg(&safe_output_path)
            .arg("--json-stream")
            .env("OPENAI_API_KEY", &api_key)
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
            .arg("--json-stream")
            .env("OPENAI_API_KEY", &api_key)
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
            get_api_key_native,
            validate_api_key_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
