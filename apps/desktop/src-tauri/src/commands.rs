//! The native shell's whole IPC surface: the config store and the OS keystore.
//!
//! The wallet itself runs in the webview against `wallet-wasm`, so nothing here
//! touches chain data, PSBTs or a database. Rules that remain:
//! - keystore calls may block on an OS prompt, so they run in `spawn_blocking`;
//! - secrets are zeroized as soon as they are consumed and are never logged.

use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;
use wallet_core::{KeyMaterial, Keystore};
use zeroize::Zeroizing;

use crate::dto::AppConfig;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const STORE_FILE: &str = "config.json";
const STORE_KEY: &str = "config";

#[tauri::command]
pub async fn get_config(app: AppHandle) -> AppResult<AppConfig> {
    let store = app.store(STORE_FILE)?;
    Ok(store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn set_config(app: AppHandle, config: AppConfig) -> AppResult<()> {
    let store = app.store(STORE_FILE)?;
    let value =
        serde_json::to_value(&config).map_err(|e| AppError::new("config", e.to_string()))?;
    store.set(STORE_KEY, value);
    store.save()?;
    Ok(())
}

/// Saves the unlock key for `wallet_id` in the OS credential store.
#[tauri::command]
pub async fn remember_secret(
    state: State<'_, AppState>,
    wallet_id: String,
    secret: String,
) -> AppResult<()> {
    let secret = Zeroizing::new(secret);
    let key = KeyMaterial::parse(&secret);
    drop(secret);
    let keystore = state.keystore();
    Ok(tauri::async_runtime::spawn_blocking(move || keystore.store(&wallet_id, key)).await??)
}

/// Returns the stored key for `wallet_id`, or `None` when nothing is saved.
/// The webview needs the material itself to open the wallet.
#[tauri::command]
pub async fn load_secret(
    state: State<'_, AppState>,
    wallet_id: String,
) -> AppResult<Option<String>> {
    let keystore = state.keystore();
    let key = tauri::async_runtime::spawn_blocking(move || keystore.load(&wallet_id)).await??;
    // `KeyMaterial` is zeroized on drop, so the string is copied out, not moved.
    Ok(key.map(|k| match &k {
        KeyMaterial::PrivHex(s) | KeyMaterial::Wif(s) => s.clone(),
    }))
}

/// Removes the credential-store entry for `wallet_id`; missing is not an error.
#[tauri::command]
pub async fn forget_secret(state: State<'_, AppState>, wallet_id: String) -> AppResult<()> {
    let keystore = state.keystore();
    Ok(tauri::async_runtime::spawn_blocking(move || keystore.remove(&wallet_id)).await??)
}
