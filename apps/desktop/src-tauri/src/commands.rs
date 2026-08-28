//! Tauri commands, one per core operation. Rules:
//! - blocking core calls run in `spawn_blocking`;
//! - no lock is held across an `.await`;
//! - secrets are zeroized as soon as they are consumed and never logged.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
use wallet_core::{
    AddressType, Balance, FeeEstimate, GeneratedKey, KeyMaterial, Keystore, NativeKeystore,
    Network, Recipient, Utxo, WalletConfig, WalletHandle,
};
use zeroize::Zeroizing;

use crate::dto::{AppConfig, BroadcastResult, RememberedWallet, TxPreview, WalletInfo};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, PendingTx};

const STORE_FILE: &str = "config.json";
const STORE_KEY: &str = "config";
const REMEMBERED_KEY: &str = "remembered_wallet";
const KEYSTORE_SERVICE: &str = "dev.gosuda.bitcoinwallet";

fn load_config(app: &AppHandle) -> AppResult<AppConfig> {
    let store = app.store(STORE_FILE)?;
    Ok(store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

fn wallet_db_path(app: &AppHandle, network: Network, wallet_id: &str) -> AppResult<PathBuf> {
    let base = app.path().app_data_dir()?;
    Ok(base
        .join("wallets")
        .join(network.id())
        .join(format!("{wallet_id}.sqlite")))
}

fn load_remembered(app: &AppHandle) -> AppResult<Option<RememberedWallet>> {
    let store = app.store(STORE_FILE)?;
    Ok(store
        .get(REMEMBERED_KEY)
        .and_then(|v| serde_json::from_value(v).ok()))
}

fn save_remembered(app: &AppHandle, remembered: Option<&RememberedWallet>) -> AppResult<()> {
    let store = app.store(STORE_FILE)?;
    match remembered {
        Some(r) => {
            let value =
                serde_json::to_value(r).map_err(|e| AppError::new("config", e.to_string()))?;
            store.set(REMEMBERED_KEY, value);
        }
        None => {
            store.delete(REMEMBERED_KEY);
        }
    }
    store.save()?;
    Ok(())
}

/// Keystore calls may block on an OS prompt (Keychain), so they never run on
/// the async runtime directly.
async fn with_keystore<T: Send + 'static>(
    f: impl FnOnce(&NativeKeystore) -> wallet_core::Result<T> + Send + 'static,
) -> AppResult<T> {
    Ok(
        tauri::async_runtime::spawn_blocking(move || f(&NativeKeystore::new(KEYSTORE_SERVICE)))
            .await??,
    )
}

async fn open_wallet_or_err(state: &AppState) -> AppResult<Arc<WalletHandle>> {
    state.wallet().await.ok_or_else(AppError::no_wallet)
}

/// Opens the wallet for `key` at its canonical DB path and installs it as the
/// current wallet. `key` is consumed; nothing secret is returned.
async fn open_and_install(
    app: &AppHandle,
    state: &AppState,
    key: KeyMaterial,
    network: Network,
    address_type: AddressType,
) -> AppResult<WalletInfo> {
    let cfg = load_config(app)?;
    let wallet_id = wallet_core::keys::wallet_id(&key, network, address_type)?;
    let db_path = wallet_db_path(app, network, &wallet_id)?;
    let wallet_cfg = WalletConfig {
        network,
        address_type,
        backend: cfg.backend,
        db_path: Some(db_path),
    };

    let handle = tauri::async_runtime::spawn_blocking(move || WalletHandle::open(wallet_cfg, &key))
        .await??;
    let info = WalletInfo {
        address: handle.address()?,
        network: handle.network(),
        address_type: handle.address_type(),
        wallet_id: handle.id().to_owned(),
    };

    state.clear_pending();
    *state.wallet.write().await = Some(Arc::new(handle));
    Ok(info)
}

#[tauri::command]
pub async fn get_config(app: AppHandle) -> AppResult<AppConfig> {
    load_config(&app)
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

/// The only command that returns secret material, and only freshly generated.
#[tauri::command]
pub async fn generate_key(network: Network, address_type: AddressType) -> AppResult<GeneratedKey> {
    Ok(wallet_core::generate_key(network, address_type)?)
}

#[tauri::command]
pub async fn open_wallet(
    app: AppHandle,
    state: State<'_, AppState>,
    secret: String,
    address_type: AddressType,
    remember: bool,
) -> AppResult<WalletInfo> {
    let secret = Zeroizing::new(secret);
    let key = KeyMaterial::parse(&secret);
    drop(secret);

    let network = load_config(&app)?.network;
    // Only cloned when the user asked to remember; the clone is consumed by the keystore.
    let to_remember = remember.then(|| key.clone());
    let info = open_and_install(&app, &state, key, network, address_type).await?;

    if let Some(key) = to_remember {
        let wallet_id = info.wallet_id.clone();
        with_keystore(move |ks| ks.store(&wallet_id, key)).await?;
        let record = RememberedWallet {
            wallet_id: info.wallet_id.clone(),
            address: info.address.clone(),
            network: info.network,
            address_type: info.address_type,
        };
        save_remembered(&app, Some(&record))?;
    }
    Ok(info)
}

#[tauri::command]
pub async fn get_remembered(app: AppHandle) -> AppResult<Option<RememberedWallet>> {
    load_remembered(&app)
}

/// Opens the remembered wallet with the key loaded from the OS keystore.
#[tauri::command]
pub async fn unlock_wallet(app: AppHandle, state: State<'_, AppState>) -> AppResult<WalletInfo> {
    let not_remembered = || AppError::new("not_remembered", "no wallet is saved on this device");
    let remembered = load_remembered(&app)?.ok_or_else(not_remembered)?;
    let wallet_id = remembered.wallet_id.clone();
    let key = with_keystore(move |ks| ks.load(&wallet_id))
        .await?
        .ok_or_else(not_remembered)?;
    open_and_install(
        &app,
        &state,
        key,
        remembered.network,
        remembered.address_type,
    )
    .await
}

/// Removes the keystore entry and the remembered record, closing the wallet if open.
#[tauri::command]
pub async fn forget_wallet(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    if let Some(remembered) = load_remembered(&app)? {
        let wallet_id = remembered.wallet_id;
        with_keystore(move |ks| ks.remove(&wallet_id)).await?;
    }
    save_remembered(&app, None)?;
    state.clear_pending();
    let previous = state.wallet.write().await.take();
    drop(previous);
    Ok(())
}

#[tauri::command]
pub async fn close_wallet(state: State<'_, AppState>) -> AppResult<()> {
    state.clear_pending();
    let previous = state.wallet.write().await.take();
    drop(previous);
    Ok(())
}

#[tauri::command]
pub async fn sync(state: State<'_, AppState>) -> AppResult<Balance> {
    let wallet = open_wallet_or_err(&state).await?;
    wallet.sync().await?;
    Ok(wallet.balance()?)
}

#[tauri::command]
pub async fn get_balance(state: State<'_, AppState>) -> AppResult<Balance> {
    let wallet = open_wallet_or_err(&state).await?;
    Ok(wallet.balance()?)
}

#[tauri::command]
pub async fn list_utxos(state: State<'_, AppState>) -> AppResult<Vec<Utxo>> {
    let wallet = open_wallet_or_err(&state).await?;
    Ok(wallet.list_utxos()?)
}

#[tauri::command]
pub async fn estimate_fee(state: State<'_, AppState>) -> AppResult<FeeEstimate> {
    let wallet = open_wallet_or_err(&state).await?;
    Ok(wallet.estimate_fee().await?)
}

#[tauri::command]
pub async fn build_transfer(
    state: State<'_, AppState>,
    recipients: Vec<Recipient>,
    fee_rate_sat_vb: f64,
) -> AppResult<TxPreview> {
    if !fee_rate_sat_vb.is_finite() || fee_rate_sat_vb <= 0.0 {
        return Err(AppError::new(
            "build_tx",
            "fee rate must be a positive number",
        ));
    }
    let wallet = open_wallet_or_err(&state).await?;
    let built = tauri::async_runtime::spawn_blocking(move || {
        wallet.build_transfer(&recipients, fee_rate_sat_vb)
    })
    .await??;

    let psbt_id = state.next_psbt_id();
    state.put_pending(
        psbt_id.clone(),
        PendingTx {
            psbt_base64: built.psbt_base64,
        },
    );
    Ok(TxPreview {
        psbt_id,
        fee_sat: built.fee_sat,
        vsize: built.vsize,
        total_out_sat: built.total_out_sat,
        change_sat: built.change_sat,
        input_count: built.input_count,
    })
}

#[tauri::command]
pub async fn sign_and_broadcast(
    state: State<'_, AppState>,
    psbt_id: String,
) -> AppResult<BroadcastResult> {
    let wallet = open_wallet_or_err(&state).await?;
    let pending = state.take_pending(&psbt_id).ok_or_else(|| {
        AppError::new(
            "unknown_psbt",
            "transaction preview expired; build it again",
        )
    })?;

    let signer = Arc::clone(&wallet);
    let signed =
        tauri::async_runtime::spawn_blocking(move || signer.sign(&pending.psbt_base64)).await??;
    // Network acceptance and local persistence are reported separately by the
    // core: a persist failure must not be shown as a failed send.
    let out = wallet.broadcast(&signed).await?;
    let explorer_url = wallet.network().explorer_tx_url(&out.txid);
    Ok(BroadcastResult {
        txid: out.txid,
        explorer_url,
        persist_error: out.persist_error,
    })
}

#[tauri::command]
pub async fn discard_tx(state: State<'_, AppState>, psbt_id: String) -> AppResult<()> {
    state.take_pending(&psbt_id);
    Ok(())
}
