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

#[cfg(target_os = "macos")]
extern "C" {
    fn copy_file_and_text_to_pasteboard(
        path: *const std::os::raw::c_char,
        content: *const std::os::raw::c_char,
    ) -> std::os::raw::c_int;
}

#[tauri::command]
pub fn copy_file_to_clipboard_native(file_name: String, content: String) -> Result<String, String> {
    let raw_name = file_name.trim();
    let clean_stem = raw_name.trim_end_matches(".md").trim_end_matches(".pdf").trim();
    let clean_name = if clean_stem.is_empty() {
        "Vorlesung.md".to_string()
    } else {
        format!("{}.md", clean_stem)
    };

    let temp_dir = std::env::temp_dir().join("lecture2markdown");
    let _ = std::fs::create_dir_all(&temp_dir);
    let target_file = temp_dir.join(&clean_name);
    std::fs::write(&target_file, &content).map_err(|e| format!("Fehler beim Schreiben: {}", e))?;

    let abs_path = target_file.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        let c_path = CString::new(abs_path.clone()).map_err(|e| e.to_string())?;
        let c_content = CString::new(content.clone()).map_err(|e| e.to_string())?;
        let res = unsafe {
            copy_file_and_text_to_pasteboard(c_path.as_ptr(), c_content.as_ptr())
        };
        if res != 0 {
            return Err(format!("Fehler beim Kopieren in die macOS-Zwischenablage: Code {}", res));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let escaped_path = abs_path.replace('\'', "''");
        let ps_cmd = format!(
            r#"Add-Type -AssemblyName System.Windows.Forms; $p = '{}'; $d = New-Object System.Windows.Forms.DataObject; $d.SetFileDropList(@($p)); $d.SetText([System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)); [System.Windows.Forms.Clipboard]::SetDataObject($d, $true)"#,
            escaped_path
        );
        let res = crate::pdf::create_hidden_command("powershell")
            .arg("-NoProfile")
            .arg("-STA")
            .arg("-Command")
            .arg(&ps_cmd)
            .output();

        // Fallback to Set-Clipboard with LiteralPath if System.Windows.Forms failed
        if res.is_err() || !res.as_ref().unwrap().status.success() {
            let fallback_cmd = format!(r#"Set-Clipboard -LiteralPath '{}'"#, escaped_path);
            let _ = crate::pdf::create_hidden_command("powershell")
                .arg("-NoProfile")
                .arg("-Command")
                .arg(&fallback_cmd)
                .output();
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_copy_file_to_clipboard_native() {
        let res = copy_file_to_clipboard_native("TestLecture.pdf".to_string(), "# Hello".to_string());
        assert!(res.is_ok());
        let path = res.unwrap();
        assert!(path.ends_with("TestLecture.md"));
        assert!(std::path::Path::new(&path).exists());
    }
}
