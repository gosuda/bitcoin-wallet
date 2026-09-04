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

use crate::dto::{AppConfig, StoredSecret};
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

/// Whether the OS credential store can actually be used in this process.
///
/// This is not a formality. On iOS the store is the data-protection keychain,
/// which needs the app's `application-identifier` entitlement — an unsigned
/// build has empty entitlements and every keychain call fails with `-34018`.
/// The frontend asks once at startup so it can decline to offer "Remember on
/// this device" rather than accept the choice and silently lose the key.
#[tauri::command]
pub async fn keystore_available(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.keystore_ok())
}

/// Saves the unlock key for `wallet_id` in the OS credential store.
///
/// `passphrase` is the optional BIP39 passphrase and is stored *with* the
/// words: it is part of this wallet's identity — the same words under another
/// passphrase are another wallet, with another `wallet_id` — and the credential
/// store is already the security boundary for the words themselves. It applies
/// only to a mnemonic; with a hex or WIF secret it is an error, not a no-op.
#[tauri::command]
pub async fn remember_secret(
    state: State<'_, AppState>,
    wallet_id: String,
    secret: String,
    passphrase: Option<String>,
) -> AppResult<()> {
    let secret = Zeroizing::new(secret);
    let passphrase = passphrase.map(Zeroizing::new);
    let key = KeyMaterial::parse_with_passphrase(&secret, passphrase.as_ref().map(|p| p.as_str()))?;
    drop(secret);
    drop(passphrase);
    let keystore = state.keystore();
    Ok(tauri::async_runtime::spawn_blocking(move || keystore.store(&wallet_id, key)).await??)
}

/// Returns the stored secret for `wallet_id`, or `None` when nothing is saved.
/// The webview needs the material itself — words and passphrase both — to open
/// the wallet.
#[tauri::command]
pub async fn load_secret(
    state: State<'_, AppState>,
    wallet_id: String,
) -> AppResult<Option<StoredSecret>> {
    let keystore = state.keystore();
    let key = tauri::async_runtime::spawn_blocking(move || keystore.load(&wallet_id)).await??;
    // `KeyMaterial` is zeroized on drop, so the strings are copied out, not moved.
    Ok(key.map(|k| StoredSecret {
        secret: k.secret(),
        passphrase: k.passphrase().map(str::to_owned),
    }))
}

/// Removes the credential-store entry for `wallet_id`; missing is not an error.
#[tauri::command]
pub async fn forget_secret(state: State<'_, AppState>, wallet_id: String) -> AppResult<()> {
    let keystore = state.keystore();
    Ok(tauri::async_runtime::spawn_blocking(move || keystore.remove(&wallet_id)).await??)
}
