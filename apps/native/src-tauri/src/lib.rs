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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    // Camera, biometrics and the `bitcoin:` scheme exist only on a phone, and
    // these plugins do not build for desktop at all.
    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_barcode_scanner::init())
        .plugin(tauri_plugin_biometric::init())
        .plugin(tauri_plugin_deep_link::init());

    builder
        .manage(state::AppState::default())
        .setup(|app| {
            // The mobile credential stores are installed at runtime and can fail
            // on a device while compiling perfectly well on CI, so ask now
            // rather than when someone first presses "Remember on this device".
            // Not fatal: everything except remembering a key still works.
            use tauri::Manager;
            app.state::<state::AppState>().keystore_ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::keystore_available,
            commands::remember_secret,
            commands::load_secret,
            commands::forget_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
