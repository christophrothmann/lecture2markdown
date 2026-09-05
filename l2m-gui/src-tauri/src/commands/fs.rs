use std::path::Path;

#[tauri::command]
pub async fn read_file_binary_native(file_path: String) -> Result<tauri::ipc::Response, String> {
    tokio::fs::read(&file_path)
        .await
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Fehler beim Lesen der Datei '{}': {}", file_path, e))
}

#[tauri::command]
pub fn read_text_file_native(file_path: String) -> Result<String, String> {
    std::fs::read_to_string(&file_path).map_err(|e| format!("Fehler beim Lesen der Datei '{}': {}", file_path, e))
}

#[tauri::command]
pub fn save_text_file_native(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&file_path, &content).map_err(|e| format!("Fehler beim Speichern der Datei: {}", e))
}

#[tauri::command]
pub fn save_file_native(file_path: String, content: String) -> Result<(), String> {
    save_text_file_native(file_path, content)
}

pub fn open_path_with_default_app(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Fehler beim Öffnen: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
            .map_err(|e| format!("Fehler beim Öffnen: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Fehler beim Öffnen: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
pub fn open_file_in_app_native(file_path: String) -> Result<(), String> {
    open_path_with_default_app(&file_path)
}

#[tauri::command]
pub fn open_anki_import_native(deck_name: String, tsv_content: String) -> Result<String, String> {
    let clean_name = format!("{}_anki.txt", deck_name.replace(['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>', ' '], "_"));
    let temp_dir = std::env::temp_dir().join("lecture2markdown");
    let _ = std::fs::create_dir_all(&temp_dir);
    let target_file = temp_dir.join(&clean_name);
    std::fs::write(&target_file, &tsv_content).map_err(|e| format!("Fehler beim Schreiben: {}", e))?;
    let abs_path = target_file.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-a")
            .arg("Anki")
            .arg(&abs_path)
            .spawn()
            .or_else(|_| {
                std::process::Command::new("open")
                    .arg(&abs_path)
                    .spawn()
            });
    }

    #[cfg(target_os = "windows")]
    {
        let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let prog_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let prog_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());
        let anki_paths = [
            format!("{}\\Programs\\Anki\\anki.exe", local_app),
            format!("{}\\Anki\\anki.exe", prog_files),
            format!("{}\\Anki\\anki.exe", prog_files_x86),
        ];
        let mut launched = false;
        for p in &anki_paths {
            if std::path::Path::new(p).exists() {
                if std::process::Command::new(p).arg(&abs_path).spawn().is_ok() {
                    launched = true;
                    break;
                }
            }
        }
        if !launched {
            let _ = open_path_with_default_app(&abs_path);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let _ = open_path_with_default_app(&abs_path);
    }

    Ok(abs_path)
}

#[tauri::command]
pub fn copy_file_to_clipboard_native(file_name: String, content: String) -> Result<String, String> {
    let clean_name = if file_name.ends_with(".md") {
        file_name
    } else {
        format!("{}.md", file_name)
    };

    let temp_dir = std::env::temp_dir().join("lecture2markdown");
    let _ = std::fs::create_dir_all(&temp_dir);
    let target_file = temp_dir.join(&clean_name);
    std::fs::write(&target_file, &content).map_err(|e| format!("Fehler beim Schreiben: {}", e))?;

    let abs_path = target_file.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let script = format!(r#"set the clipboard to (POSIX file "{}")"#, abs_path);
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output();
    }

    #[cfg(target_os = "windows")]
    {
        let ps_cmd = format!(r#"Set-Clipboard -Path '{}'"#, abs_path);
        let _ = crate::pdf::create_hidden_command("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&ps_cmd)
            .output();
    }

    #[cfg(target_os = "linux")]
    {
        let uri = format!("file://{}", abs_path);
        let _ = std::process::Command::new("xclip")
            .args(&["-selection", "clipboard", "-t", "text/uri-list"])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(uri.as_bytes());
                }
                child.wait()
            });
    }

    Ok(abs_path)
}
