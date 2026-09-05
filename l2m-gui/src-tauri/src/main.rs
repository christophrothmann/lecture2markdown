#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anki_apkg;
mod cache;
mod commands;
mod pdf;
mod providers;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct AppState {
    pub cancel_requested: Arc<AtomicBool>,
}

fn main() {
    let app_state = AppState {
        cancel_requested: Arc::new(AtomicBool::new(false)),
    };

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut("CommandOrControl+Shift+L", move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.emit("open-quick-drop", ());
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_pdf_page_count_native,
            commands::get_slide_image_native,
            commands::read_file_binary_native,
            commands::read_text_file_native,
            commands::convert_lecture_native,
            commands::transcribe_slides_native,
            commands::transcribe_single_slide_native,
            commands::cancel_conversion_native,
            commands::save_text_file_native,
            commands::save_file_native,
            commands::open_file_in_app_native,
            commands::open_anki_import_native,
            commands::export_anki_apkg_native,
            commands::copy_file_to_clipboard_native,
            commands::save_api_key_native,
            commands::get_api_keys_native,
            commands::get_api_key_native,
            commands::validate_api_key_native,
            commands::clear_slide_cache_native,
            commands::get_slide_cache_stats_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
