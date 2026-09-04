//! Thin native shell for the wallet.
//!
//! The wallet core runs in the webview as WASM, with public state in
//! IndexedDB. This process owns only what a browser cannot: the config store
//! and the OS credential store. Secret material crosses the IPC boundary just
//! twice — inbound to `remember_secret`, outbound from `load_secret` to the
//! webview that is about to open the wallet — and is never logged.

mod commands;
mod dto;
mod error;
mod state;

/// The one entry point for every platform. `main.rs` calls it on desktop; on iOS
/// and Android the app is built as a library and the platform framework loads it
/// through this attribute, which is why the logic does not live in `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::remember_secret,
            commands::load_secret,
            commands::forget_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
