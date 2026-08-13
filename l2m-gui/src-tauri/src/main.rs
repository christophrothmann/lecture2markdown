#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use tauri::Emitter;

#[tauri::command]
async fn convert_lecture_native(
    pdf_path: String,
    output_path: String,
    api_key: String,
    window: tauri::Window,
) -> Result<String, String> {
    // 1. Resolve exact path to lecture2md_gui.py
    let script_candidates = [
        "../py_sidecar/lecture2md_gui.py",
        "py_sidecar/lecture2md_gui.py",
        "src-tauri/py_sidecar/lecture2md_gui.py",
    ];

    let script_path = script_candidates
        .iter()
        .find(|p| Path::new(p).exists())
        .copied()
        .unwrap_or("../py_sidecar/lecture2md_gui.py");

    // 2. Resolve Python binary (prefer project virtualenv or uv run)
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
            .arg("--output").arg(&output_path)
            .arg("--api-key").arg(&api_key)
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
            .arg("--output").arg(&output_path)
            .arg("--api-key").arg(&api_key)
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
            .arg("--output").arg(&output_path)
            .arg("--api-key").arg(&api_key)
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
        std::fs::read_to_string(&output_path)
            .map_err(|e| format!("Ausgabedatei konnte nicht gelesen werden: {}", e))
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
        .invoke_handler(tauri::generate_handler![convert_lecture_native])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
