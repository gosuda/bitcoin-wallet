//! The native shell's whole IPC surface: the config store and the OS keystore.
//!
//! The wallet itself runs in the webview against `wallet-wasm`, so nothing here
//! touches chain data, PSBTs or a database. Rules that remain:
//! - keystore calls may block on an OS prompt, so they run in `spawn_blocking`;
//! - secrets are zeroized as soon as they are consumed and are never logged.

use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
use wallet_core::{BackendConfig, KeyMaterial, Keystore};
use zeroize::Zeroizing;

use crate::dto::{AppConfig, StoredSecret};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const STORE_FILE: &str = "config.json";
const STORE_KEY: &str = "config";

/// The persisted config, or [`AppConfig::default`] when nothing has been
/// saved yet. Shared by the `get_config` command and startup, which needs
/// the same read before any command has been called this run.
pub(crate) fn stored_config(app: &AppHandle) -> AppResult<AppConfig> {
    let store = app.store(STORE_FILE)?;
    Ok(store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn get_config(app: AppHandle) -> AppResult<AppConfig> {
    stored_config(&app)
}

#[tauri::command]
pub async fn set_config(app: AppHandle, config: AppConfig) -> AppResult<()> {
    let store = app.store(STORE_FILE)?;
    let value =
        serde_json::to_value(&config).map_err(|e| AppError::new("config", e.to_string()))?;
    store.set(STORE_KEY, value);
    store.save()?;
    grant_backend_scope(&app, &config.backend);
    Ok(())
}

/// `scheme://host[:port]/*`, the origin-only glob the http plugin's scope
/// wants — or `None` for anything that is not plain http(s), which the
/// plugin would never dispatch a request for anyway.
fn backend_origin_pattern(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    matches!(parsed.scheme(), "http" | "https")
        .then(|| format!("{}/*", parsed.origin().ascii_serialization()))
}

/// Grants the webview's HTTP proxy exactly the origin the wallet is
/// configured to talk to. `capabilities/*.json` grant `http:default` no
/// scope at all, so without this call every chain request the webview makes
/// is refused — this is the only thing that ever opens it up, and only to
/// the one origin the user actually chose, in place of the `https://*:*` /
/// `http://*:*` wildcard that used to sit in those files. Called once at
/// startup for whatever was last saved (a remembered wallet syncs
/// immediately on launch, without `set_config` ever running again this
/// process) and again every time `set_config` saves a new one.
///
/// Additive only: Tauri's dynamic ACL has no matching "revoke", so an origin
/// granted this way stays reachable for the rest of the process even after
/// the backend is pointed elsewhere. Still a large narrowing — from any
/// host on the internet to only origins this app was, at some point in this
/// run, actually configured to talk to.
pub(crate) fn grant_backend_scope(app: &AppHandle, backend: &BackendConfig) {
    let BackendConfig::Esplora { url } = backend;
    let Some(pattern) = backend_origin_pattern(url) else {
        return;
    };
    let capability = CapabilityBuilder::new("dynamic-backend-scope")
        .window("main")
        .permission_scoped(
            "http:default",
            vec![serde_json::json!({ "url": pattern })],
            Vec::<serde_json::Value>::new(),
        );
    if let Err(e) = app.add_capability(capability) {
        eprintln!("warning: could not grant HTTP scope for the configured backend: {e}");
    }
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
    Ok(state.keystore_ok().await)
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
