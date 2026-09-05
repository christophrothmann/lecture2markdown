use std::collections::HashMap;
use std::path::PathBuf;

use crate::anki_apkg;
use crate::pdf;
use super::pdf::find_python_binary;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use super::fs::open_path_with_default_app;

#[tauri::command]
pub async fn export_anki_apkg_native(
    deck_name: String,
    cards: Vec<anki_apkg::ApkgExportCard>,
    slide_images: Option<HashMap<String, String>>,
    pdf_path: Option<String>,
    output_path: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let clean_deck = if deck_name.trim().is_empty() {
            "Lecture2Markdown".to_string()
        } else {
            deck_name.trim().to_string()
        };

        let final_path = match output_path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => PathBuf::from(p),
            None => {
                let temp_dir = std::env::temp_dir().join("lecture2markdown");
                let _ = std::fs::create_dir_all(&temp_dir);
                let safe_filename = format!(
                    "{}.apkg",
                    clean_deck.replace(['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>', ' '], "_")
                );
                temp_dir.join(safe_filename)
            }
        };

        // Process slide images: decode base64
        let mut binary_slide_images: HashMap<String, Vec<u8>> = HashMap::new();
        if let Some(imgs) = slide_images {
            for (name, b64) in imgs {
                let clean_b64 = b64
                    .trim()
                    .strip_prefix("data:image/webp;base64,")
                    .or_else(|| b64.trim().strip_prefix("data:image/png;base64,"))
                    .or_else(|| b64.trim().strip_prefix("data:image/jpeg;base64,"))
                    .unwrap_or(b64.trim());
                use base64::Engine;
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean_b64) {
                    binary_slide_images.insert(name, bytes);
                }
            }
        }

        // If pdf_path is provided, automatically render any missing slide images for active cards
        if let Some(pdf_file) = pdf_path {
            let pdf_p = PathBuf::from(&pdf_file);
            if pdf_p.exists() {
                let py_bin = find_python_binary();
                for card in &cards {
                    if !card.enabled {
                        continue;
                    }
                    let img_name = format!("slide_{}.webp", card.slide_number);
                    if !binary_slide_images.contains_key(&img_name) && card.slide_number > 0 {
                        if let Ok(rendered) =
                            pdf::render_pdf_slide_to_webp(&pdf_p, card.slide_number - 1, py_bin.as_deref())
                        {
                            use base64::Engine;
                            if let Ok(bytes) =
                                base64::engine::general_purpose::STANDARD.decode(&rendered.webp_base64)
                            {
                                binary_slide_images.insert(img_name, bytes);
                            }
                        }
                    }
                }
            }
        }

        anki_apkg::generate_apkg(&clean_deck, &cards, &binary_slide_images, &final_path)?;

        let abs_path = final_path.to_string_lossy().to_string();

        let should_launch = match output_path.as_deref().map(str::trim) {
            Some(p) => p.is_empty(),
            None => true,
        };

        if should_launch {
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
                let prog_files =
                    std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
                let prog_files_x86 =
                    std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());
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
        }

        Ok(abs_path)
    })
    .await
    .map_err(|e| format!("Task-Fehler: {}", e))?
}
