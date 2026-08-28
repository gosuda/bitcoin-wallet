//! Tauri shell around `wallet_core`. Every command maps 1:1 onto the core API;
//! secret material only ever crosses the IPC boundary inbound (`open_wallet`)
//! or as the one-time output of `generate_key`. Remembered keys live in the OS
//! keystore and are loaded by `unlock_wallet` without ever reaching the UI.

mod commands;
mod dto;
mod error;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::generate_key,
            commands::open_wallet,
            commands::close_wallet,
            commands::get_remembered,
            commands::unlock_wallet,
            commands::forget_wallet,
            commands::sync,
            commands::get_balance,
            commands::list_utxos,
            commands::estimate_fee,
            commands::build_transfer,
            commands::sign_and_broadcast,
            commands::discard_tx,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
