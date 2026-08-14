#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use tauri::{Emitter, Manager};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

enum PythonRunner {
    Executable(PathBuf),
    Uv,
    System(String),
}

fn get_secret_file_path(app: &tauri::AppHandle) -> PathBuf {
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

/// Resolves the Python binary and associated virtualenv & project roots.
fn resolve_safe_python_runner() -> (PythonRunner, Option<PathBuf>, Option<PathBuf>) {
    let venv_python_candidates = [
        "../../.venv/bin/python",
        "../.venv/bin/python",
        ".venv/bin/python",
        "../../.venv/Scripts/python.exe",
        "../.venv/Scripts/python.exe",
        ".venv/Scripts/python.exe",
    ];

    for candidate in venv_python_candidates {
        let path = Path::new(candidate);
        if path.exists() {
            if let Ok(canonical_path) = std::fs::canonicalize(path) {
                let mut venv_dir = None;
                let mut proj_dir = None;
                if let Some(bin_dir) = canonical_path.parent() {
                    if let Some(v_root) = bin_dir.parent() {
                        venv_dir = Some(v_root.to_path_buf());
                        if let Some(p_root) = v_root.parent() {
                            proj_dir = Some(p_root.to_path_buf());
                        }
                    }
                }
                return (PythonRunner::Executable(canonical_path), venv_dir, proj_dir);
            }
        }
    }

    if Command::new("uv").arg("--version").output().is_ok() {
        return (PythonRunner::Uv, None, None);
    }

    if Command::new("python3").arg("--version").output().is_ok() {
        return (PythonRunner::System("python3".to_string()), None, None);
    }

    (PythonRunner::System("python".to_string()), None, None)
}

/// Resolves lecture2md.py using canonical path resolution to ensure absolute path integrity.
fn resolve_safe_script_path() -> Result<PathBuf, String> {
    let script_candidates = [
        "../../lecture2md.py",
        "../lecture2md.py",
        "lecture2md.py",
    ];

    for candidate in script_candidates {
        let path = Path::new(candidate);
        if path.exists() {
            if let Ok(canonical_path) = std::fs::canonicalize(path) {
                return Ok(canonical_path);
            }
        }
    }

    Err("Skript lecture2md.py konnte über canonical path nicht verifiziert werden.".to_string())
}

/// Applies a hardened environment whitelist with VIRTUAL_ENV and PYTHONPATH support.
fn apply_hardened_environment(
    cmd: &mut Command,
    venv_dir: Option<&Path>,
    proj_root: Option<&Path>,
    extra_env: Option<(&str, &str)>
) {
    cmd.env_clear();
    
    let safe_keys = [
        "PATH", "HOME", "USER", "LOGNAME", "SHELL",
        "TMPDIR", "TEMP", "TMP",
        "SYSTEMROOT", "COMSPEC", "PATHEXT", "WINDIR", "APPDATA", "LOCALAPPDATA",
        "LANG", "LC_ALL", "LC_CTYPE"
    ];

    for key in safe_keys {
        if let Ok(val) = std::env::var(key) {
            cmd.env(key, val);
        }
    }

    if let Some(venv) = venv_dir {
        cmd.env("VIRTUAL_ENV", venv);
        #[cfg(unix)]
        let bin_name = "bin";
        #[cfg(windows)]
        let bin_name = "Scripts";

        let venv_bin = venv.join(bin_name);
        if let Ok(current_path) = std::env::var("PATH") {
            #[cfg(unix)]
            cmd.env("PATH", format!("{}:{}", venv_bin.to_string_lossy(), current_path));
            #[cfg(windows)]
            cmd.env("PATH", format!("{};{}", venv_bin.to_string_lossy(), current_path));
        } else {
            cmd.env("PATH", venv_bin);
        }
    }

    if let Some(proj) = proj_root {
        cmd.env("PYTHONPATH", proj);
    }

    if let Some((k, v)) = extra_env {
        cmd.env(k, v);
    }
}

#[tauri::command]
async fn save_api_key_native(provider: String, key: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut map = read_keys_map(&app);
    map.insert(provider.trim().to_lowercase(), key.trim().to_string());
    
    let secret_path = get_secret_file_path(&app);
    let serialized = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    std::fs::write(&secret_path, serialized)
        .map_err(|e| format!("API-Key konnte nicht sicher gespeichert werden: {}", e))?;

    // Hardened restrictive file permissions (0600: read/write only by owner) on Unix
    #[cfg(unix)]
    {
        if let Ok(file) = std::fs::File::open(&secret_path) {
            let mut perms = file.metadata().map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&secret_path, perms);
        }
    }

    Ok(())
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

    let (runner, venv_dir, proj_root) = resolve_safe_python_runner();
    let mut cmd = match runner {
        PythonRunner::Executable(safe_bin) => Command::new(safe_bin),
        PythonRunner::Uv => {
            let mut c = Command::new("uv");
            c.arg("run").arg("python");
            c
        }
        PythonRunner::System(sys_bin) => Command::new(sys_bin),
    };

    apply_hardened_environment(&mut cmd, venv_dir.as_deref(), proj_root.as_deref(), None);
    cmd.arg("-c").arg(&script);

    let output = cmd.output().map_err(|e| format!("Fehler beim Ausführen der Validierung: {}", e))?;

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

    // 2. Resolve verified canonical script path
    let script_path = resolve_safe_script_path()?;

    // 3. Resolve verified canonical Python runner with venv context
    let (python_runner, venv_dir, proj_root) = resolve_safe_python_runner();

    let env_var_key = match chosen_provider.as_str() {
        "google" => "GEMINI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "mistral" => "MISTRAL_API_KEY",
        _ => "OPENAI_API_KEY",
    };

    let mut cmd = match python_runner {
        PythonRunner::Executable(safe_bin) => {
            let mut c = Command::new(safe_bin);
            c.arg(&script_path);
            c
        }
        PythonRunner::Uv => {
            let mut c = Command::new("uv");
            c.arg("run").arg("python").arg(&script_path);
            c
        }
        PythonRunner::System(sys_bin) => {
            let mut c = Command::new(sys_bin);
            c.arg(&script_path);
            c
        }
    };

    apply_hardened_environment(
        &mut cmd,
        venv_dir.as_deref(),
        proj_root.as_deref(),
        Some((env_var_key, &api_key))
    );

    cmd.arg("--pdf").arg(&pdf_path)
        .arg("--output").arg(&safe_output_path)
        .arg("--provider").arg(&chosen_provider)
        .arg("--json-stream")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Fehler beim Starten des Python-Prozesses: {}", e))?;
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
