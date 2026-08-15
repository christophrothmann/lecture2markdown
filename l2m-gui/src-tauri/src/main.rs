#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use tauri::{Emitter, Manager};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

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

/// Dynamically locates the project root, virtualenv Python binary, and script path.
fn find_project_environment() -> (Option<PathBuf>, Option<PathBuf>, Option<PathBuf>) {
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
            let script_candidate = dir.join("lecture2md.py");

            if venv_candidate.exists() || script_candidate.exists() {
                #[cfg(unix)]
                let py_bin = venv_candidate.join("bin").join("python3");
                #[cfg(unix)]
                let py_bin_alt = venv_candidate.join("bin").join("python");
                #[cfg(windows)]
                let py_bin = venv_candidate.join("Scripts").join("python.exe");
                #[cfg(windows)]
                let py_bin_alt = venv_candidate.join("Scripts").join("python.exe");

                let resolved_py = if py_bin.exists() {
                    Some(py_bin)
                } else if py_bin_alt.exists() {
                    Some(py_bin_alt)
                } else {
                    None
                };

                let resolved_script = if script_candidate.exists() {
                    Some(script_candidate)
                } else {
                    None
                };

                let resolved_proj = Some(dir.to_path_buf());

                return (resolved_py, resolved_script, resolved_proj);
            }
            curr = dir.parent();
        }
    }

    (None, None, None)
}

/// Configures environment variables and working directory safely for child processes.
fn setup_process_command(
    py_bin: Option<&Path>,
    proj_root: Option<&Path>,
    extra_env: Option<(&str, &str)>
) -> Command {
    let mut cmd = if let Some(bin) = py_bin {
        Command::new(bin)
    } else if Command::new("uv").arg("--version").output().is_ok() {
        let mut c = Command::new("uv");
        c.arg("run").arg("python");
        c
    } else if Command::new("python3").arg("--version").output().is_ok() {
        Command::new("python3")
    } else {
        Command::new("python")
    };

    if let Some(root) = proj_root {
        cmd.current_dir(root);
        cmd.env("PYTHONPATH", root);
        let venv_dir = root.join(".venv");
        if venv_dir.exists() {
            cmd.env("VIRTUAL_ENV", &venv_dir);
            #[cfg(unix)]
            let venv_bin = venv_dir.join("bin");
            #[cfg(windows)]
            let venv_bin = venv_dir.join("Scripts");

            if let Ok(current_path) = std::env::var("PATH") {
                #[cfg(unix)]
                cmd.env("PATH", format!("{}:{}", venv_bin.to_string_lossy(), current_path));
                #[cfg(windows)]
                cmd.env("PATH", format!("{};{}", venv_bin.to_string_lossy(), current_path));
            } else {
                cmd.env("PATH", venv_bin);
            }
        }
    }

    // Safe environment keys whitelist
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

    if let Some((k, v)) = extra_env {
        cmd.env(k, v);
    }

    cmd
}

#[tauri::command]
async fn save_api_key_native(provider: String, key: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut map = read_keys_map(&app);
    map.insert(provider.trim().to_lowercase(), key.trim().to_string());
    
    let secret_path = get_secret_file_path(&app);
    let serialized = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    std::fs::write(&secret_path, serialized)
        .map_err(|e| format!("API-Key konnte nicht sicher gespeichert werden: {}", e))?;

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
            "import sys\nfrom google import genai\ntry:\n    client = genai.Client(api_key='{}')\n    list(client.models.list())\n    print('OK')\nexcept Exception as e:\n    sys.exit(str(e))",
            sanitized_key
        ),
        "anthropic" => format!(
            "import sys\nfrom anthropic import Anthropic\ntry:\n    client = Anthropic(api_key='{}', max_retries=0, timeout=5.0)\n    client.models.list()\n    print('OK')\nexcept Exception as e:\n    sys.exit(str(e))",
            sanitized_key
        ),
        "mistral" => format!(
            "import sys\nfrom l2m_core.providers.mistral_provider import Mistral\ntry:\n    client = Mistral(api_key='{}')\n    client.models.list()\n    print('OK')\nexcept Exception as e:\n    sys.exit(str(e))",
            sanitized_key
        ),
        _ => format!(
            "import sys\nfrom openai import OpenAI\ntry:\n    client = OpenAI(api_key='{}', max_retries=0, timeout=5.0)\n    client.models.list()\n    print('OK')\nexcept Exception as e:\n    sys.exit(str(e))",
            sanitized_key
        ),
    };

    let (py_bin, _script_path, proj_root) = find_project_environment();
    let mut cmd = setup_process_command(py_bin.as_deref(), proj_root.as_deref(), None);
    cmd.arg("-c").arg(&script);

    let output = cmd.output().map_err(|e| format!("Fehler beim Ausführen der Validierung: {}", e))?;

    if output.status.success() {
        Ok(true)
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        let cleaned_err = if err_msg.trim().is_empty() {
            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            err_msg.to_string()
        };
        Err(format!("Validierungsfehler: {}", cleaned_err.trim()))
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

    // 2. Resolve environment & script
    let (py_bin, script_path, proj_root) = find_project_environment();
    let target_script = script_path.unwrap_or_else(|| PathBuf::from("lecture2md.py"));

    let env_var_key = match chosen_provider.as_str() {
        "google" => "GEMINI_API_KEY",
        "anthropic" => "ANTHROPIC_API_KEY",
        "mistral" => "MISTRAL_API_KEY",
        _ => "OPENAI_API_KEY",
    };

    let mut cmd = setup_process_command(
        py_bin.as_deref(),
        proj_root.as_deref(),
        Some((env_var_key, &api_key))
    );

    cmd.arg(&target_script)
        .arg("--pdf").arg(&pdf_path)
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
