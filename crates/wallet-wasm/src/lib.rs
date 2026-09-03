//! JavaScript bindings for `wallet-core`.
//!
//! One wallet model everywhere: the browser and the Tauri webview load this
//! module and supply a persister object (IndexedDB) for public state. Secrets
//! are handed in per session and never returned, except from `generate_key`.
//!
//! The persister object must implement
//! `initialize(): Promise<string | null>` (the stored aggregated changeset JSON)
//! and `persist(json: string): Promise<void>` (replace the stored record).
#![cfg(target_arch = "wasm32")]

use std::rc::Rc;

use js_sys::{Function, Promise, Reflect};
use wallet_core::bdk_wallet::ChangeSet;
use wallet_core::bdk_wallet::chain::Merge;
use wallet_core::persist::{Persister, changeset_from_json, changeset_to_json};
use wallet_core::{AddressType, KeyMaterial, Network, Recipient, WalletConfig, WalletHandle};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(v).map_err(js_err)
}

fn parse_network(s: &str) -> Result<Network, JsError> {
    Network::parse(s).ok_or_else(|| JsError::new(&format!("unknown network '{s}'")))
}

fn parse_address_type(s: &str) -> Result<AddressType, JsError> {
    AddressType::parse(s).ok_or_else(|| JsError::new(&format!("unknown address type '{s}'")))
}

/// Persister backed by a JS object (IndexedDB in practice). Keeps the
/// aggregated changeset so the store holds one record per wallet.
struct JsPersister {
    target: JsValue,
    full: ChangeSet,
}

impl JsPersister {
    fn new(target: JsValue) -> Result<Self, wallet_core::Error> {
        if !target.is_object() {
            return Err(wallet_core::Error::Persist(
                "persister must be an object".into(),
            ));
        }
        Ok(Self {
            target,
            full: ChangeSet::default(),
        })
    }

    async fn call(&self, method: &str, arg: Option<&str>) -> Result<JsValue, wallet_core::Error> {
        let f = Reflect::get(&self.target, &JsValue::from_str(method))
            .ok()
            .and_then(|v| v.dyn_into::<Function>().ok())
            .ok_or_else(|| {
                wallet_core::Error::Persist(format!("persister.{method} is not a function"))
            })?;
        let ret = match arg {
            Some(a) => f.call1(&self.target, &JsValue::from_str(a)),
            None => f.call0(&self.target),
        }
        .map_err(|e| wallet_core::Error::Persist(format!("persister.{method} threw: {e:?}")))?;
        let promise: Promise = ret.dyn_into().unwrap_or_else(|v| Promise::resolve(&v));
        JsFuture::from(promise)
            .await
            .map_err(|e| wallet_core::Error::Persist(format!("persister.{method} rejected: {e:?}")))
    }
}

#[async_trait::async_trait(?Send)]
impl Persister for JsPersister {
    async fn initialize(&mut self) -> wallet_core::Result<ChangeSet> {
        let v = self.call("initialize", None).await?;
        let json = v.as_string();
        self.full = changeset_from_json(json.as_deref())?;
        Ok(self.full.clone())
    }

    async fn persist(&mut self, delta: &ChangeSet) -> wallet_core::Result<()> {
        self.full.merge(delta.clone());
        let json = changeset_to_json(&self.full)?;
        self.call("persist", Some(&json)).await.map(|_| ())
    }
}

/// Install a panic hook that reports to the browser console.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Generate a fresh key: `{ priv_hex, wif, pub_hex, address }`. The only call that returns a secret.
#[wasm_bindgen]
pub fn generate_key(network: &str, address_type: &str) -> Result<JsValue, JsError> {
    let k = wallet_core::generate_key(parse_network(network)?, parse_address_type(address_type)?)
        .map_err(js_err)?;
    to_js(&k)
}

/// Address for a hex/WIF secret.
#[wasm_bindgen]
pub fn address_for_key(secret: &str, network: &str, address_type: &str) -> Result<String, JsError> {
    let key = KeyMaterial::parse(secret);
    wallet_core::address_for_key(
        &key,
        parse_network(network)?,
        parse_address_type(address_type)?,
    )
    .map_err(js_err)
}

/// Non-secret wallet identifier for a secret (used as the persistence/keychain key).
/// Named `walletIdForKey` in JS — `Wallet.id` already owns the `wallet_id` symbol.
#[wasm_bindgen]
pub fn wallet_id_for_key(
    secret: &str,
    network: &str,
    address_type: &str,
) -> Result<String, JsError> {
    let key = KeyMaterial::parse(secret);
    wallet_core::keys::wallet_id(
        &key,
        parse_network(network)?,
        parse_address_type(address_type)?,
    )
    .map_err(js_err)
}

/// Default public Esplora URL for a network.
#[wasm_bindgen]
pub fn default_esplora_url(network: &str) -> Result<String, JsError> {
    Ok(parse_network(network)?.default_esplora_url().to_string())
}

/// Block-explorer URL for a txid on a network.
#[wasm_bindgen]
pub fn explorer_tx_url(network: &str, txid: &str) -> Result<String, JsError> {
    Ok(parse_network(network)?.explorer_tx_url(txid))
}

/// An open wallet. All methods are async and safe to call from JS.
#[wasm_bindgen]
pub struct Wallet {
    inner: Rc<WalletHandle>,
}

#[wasm_bindgen]
impl Wallet {
    /// Open (or create) a wallet.
    /// `config`: `{ network, address_type, backend: { kind: "esplora", url } }`.
    /// `secret`: hex or WIF (consumed; never stored by this module).
    /// `persister`: object with `initialize()` / `persist(json)` returning promises.
    pub async fn open(
        config: JsValue,
        secret: &str,
        persister: JsValue,
    ) -> Result<Wallet, JsError> {
        let config: WalletConfig = serde_wasm_bindgen::from_value(config).map_err(js_err)?;
        let key = KeyMaterial::parse(secret);
        let persister = JsPersister::new(persister).map_err(js_err)?;
        let handle = WalletHandle::open(config, &key, Box::new(persister))
            .await
            .map_err(js_err)?;
        Ok(Wallet {
            inner: Rc::new(handle),
        })
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.inner.id().to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn network(&self) -> String {
        self.inner.network().id().to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn address_type(&self) -> String {
        self.inner.address_type().id().to_string()
    }

    pub async fn address(&self) -> String {
        self.inner.address().await
    }

    pub async fn sync(&self) -> Result<(), JsError> {
        self.inner.sync().await.map_err(js_err)
    }

    /// `{ confirmed, trusted_pending, untrusted_pending, immature }` in sats.
    pub async fn balance(&self) -> Result<JsValue, JsError> {
        to_js(&self.inner.balance().await)
    }

    /// `[{ txid, vout, value, confirmations, address }]`, largest first.
    pub async fn list_utxos(&self) -> Result<JsValue, JsError> {
        to_js(&self.inner.list_utxos().await)
    }

    /// `[{ txid, net_sat, sent_sat, received_sat, fee_sat, confirmations, timestamp }]`,
    /// newest first. `net_sat` is negative for outgoing transactions.
    pub async fn list_transactions(&self) -> Result<JsValue, JsError> {
        to_js(&self.inner.list_transactions().await)
    }

    /// `{ sat_per_vb_by_target: { "1": 12.3, ... } }`.
    pub async fn estimate_fee(&self) -> Result<JsValue, JsError> {
        let fee = self.inner.estimate_fee().await.map_err(js_err)?;
        // BTreeMap<u16, f64> keys become strings in JS objects.
        let obj: std::collections::BTreeMap<String, f64> = fee
            .sat_per_vb_by_target
            .iter()
            .map(|(k, v)| (k.to_string(), *v))
            .collect();
        to_js(&serde_json::json!({ "sat_per_vb_by_target": obj }))
    }

    pub async fn chain_height(&self) -> Result<u32, JsError> {
        self.inner.chain_height().await.map_err(js_err)
    }

    /// `recipients`: `[{ address, amount_sat }]`. Returns
    /// `{ psbt_base64, fee_sat, vsize, total_out_sat, change_sat, input_count }`.
    pub async fn build_transfer(
        &self,
        recipients: JsValue,
        fee_rate_sat_vb: f64,
    ) -> Result<JsValue, JsError> {
        let recipients: Vec<Recipient> =
            serde_wasm_bindgen::from_value(recipients).map_err(js_err)?;
        let built = self
            .inner
            .build_transfer(&recipients, fee_rate_sat_vb)
            .await
            .map_err(js_err)?;
        to_js(&built)
    }

    /// Sign + finalize a PSBT (base64) produced by `build_transfer`.
    pub async fn sign(&self, psbt_base64: &str) -> Result<String, JsError> {
        self.inner.sign(psbt_base64).await.map_err(js_err)
    }

    /// Broadcast a signed PSBT. Returns `{ txid, persist_error }` — a set
    /// `persist_error` means the send succeeded but local state was not saved.
    pub async fn broadcast(&self, signed_psbt_base64: &str) -> Result<JsValue, JsError> {
        to_js(
            &self
                .inner
                .broadcast(signed_psbt_base64)
                .await
                .map_err(js_err)?,
        )
    }
}
