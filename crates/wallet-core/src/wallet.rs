//! Wallet handle: BDK wallet + portable persistence + chain backend.
//!
//! Two shapes, one handle. Single-key material opens a one-keychain wallet
//! whose change comes back to the same address; a BIP39 mnemonic opens a BIP32
//! account with a separate internal keychain, so change never reuses a receive
//! address. [`WalletHandle::is_hd`] says which one you have.

use std::str::FromStr;

use async_lock::Mutex;
use bdk_wallet::bitcoin::{Address, Amount, FeeRate, Psbt, Transaction};
use bdk_wallet::chain::{ChainPosition, Merge};
use bdk_wallet::coin_selection::InsufficientFunds;
use bdk_wallet::error::CreateTxError;
use bdk_wallet::keys::DescriptorPublicKey;
use bdk_wallet::miniscript::ForEachKey;
use bdk_wallet::{AddressInfo, KeychainKind, SignOptions, Wallet};
use serde::{Deserialize, Serialize};
use web_time::{SystemTime, UNIX_EPOCH};

use crate::backend::{BackendConfig, ChainBackend, FeeEstimate};
use crate::keys::{AddressType, Descriptors, KeyMaterial, descriptors_for, wallet_id};
use crate::network::Network;
use crate::persist::Persister;
use crate::{Error, Result};

/// Confirmation target used when the caller does not choose a fee rate (Go parity: 6 blocks).
pub const DEFAULT_FEE_TARGET: u16 = 6;
/// Floor applied to any fee rate (Go parity: 1 sat/vB).
pub const MIN_FEE_RATE_SAT_VB: f64 = 1.0;
/// Unused scripts a full scan walks past before deciding a keychain is done.
pub const DEFAULT_STOP_GAP: u32 = 20;
/// Ceiling for a caller-chosen gap: past this a scan is minutes of round trips.
pub const MAX_STOP_GAP: u32 = 1000;

/// Everything needed to open a wallet. Where state is stored is the
/// platform's choice — see [`Persister`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConfig {
    pub network: Network,
    pub address_type: AddressType,
    pub backend: BackendConfig,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Balance {
    pub confirmed: u64,
    pub trusted_pending: u64,
    pub untrusted_pending: u64,
    pub immature: u64,
}

impl Balance {
    /// Confirmed plus change we are waiting on (BDK "trusted spendable").
    pub fn spendable(&self) -> u64 {
        self.confirmed + self.trusted_pending
    }

    pub fn total(&self) -> u64 {
        self.confirmed + self.trusted_pending + self.untrusted_pending + self.immature
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Utxo {
    pub txid: String,
    pub vout: u32,
    pub value: u64,
    /// `None` while unconfirmed.
    pub confirmations: Option<u32>,
    pub address: String,
}

/// One wallet-relevant transaction, as shown in history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxSummary {
    pub txid: String,
    /// Net effect on this wallet in sats: positive when received, negative when
    /// sent (the fee is part of the negative amount).
    pub net_sat: i64,
    /// Total value of inputs this wallet owns.
    pub sent_sat: u64,
    /// Total value of outputs this wallet owns (change included).
    pub received_sat: u64,
    /// `None` when the wallet does not know every input, so BDK cannot compute it.
    pub fee_sat: Option<u64>,
    /// `None` while unconfirmed.
    pub confirmations: Option<u32>,
    /// Block time when confirmed, else when the transaction was last seen in the
    /// mempool; seconds since the epoch, `None` if never seen.
    pub timestamp: Option<u64>,
}

impl TxSummary {
    /// Whether this transaction moved value out of the wallet.
    pub fn is_outgoing(&self) -> bool {
        self.net_sat < 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recipient {
    pub address: String,
    pub amount_sat: u64,
}

/// An unsigned transaction ready for review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuiltTx {
    pub psbt_base64: String,
    pub fee_sat: u64,
    /// Virtual size of the unsigned template; the signed size is slightly larger.
    pub vsize: u64,
    pub total_out_sat: u64,
    pub change_sat: u64,
    pub input_count: u32,
}

/// Outcome of a broadcast. `txid` is always the accepted transaction; the
/// backend has it even when the local wallet state could not be persisted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Broadcast {
    pub txid: String,
    /// `Some(reason)` when the backend accepted the transaction but the local
    /// wallet state failed to persist. The wallet still tracks it in memory;
    /// the next successful sync/persist reconciles it. Callers must not treat
    /// this as a failed send.
    pub persist_error: Option<String>,
}

/// The public half of a wallet: enough to watch it, not to spend from it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicDescriptors {
    pub external: String,
    /// Change keychain; `None` for a single key, which has only one.
    pub internal: Option<String>,
    /// Account-level extended public key of an HD wallet, `None` for a single key.
    pub account_xpub: Option<String>,
    /// Master key fingerprint the descriptors carry as origin, when they do.
    pub fingerprint: Option<String>,
}

/// One input of a wallet transaction as far as the wallet can see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxInput {
    pub txid: String,
    pub vout: u32,
    /// `None` when the spent output is not one the wallet has seen.
    pub value_sat: Option<u64>,
    pub ours: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TxOutput {
    /// `None` for a script with no address form.
    pub address: Option<String>,
    pub value_sat: u64,
    pub ours: bool,
}

/// Everything the wallet knows about one transaction in its history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TxDetail {
    pub txid: String,
    pub net_sat: i64,
    pub sent_sat: u64,
    pub received_sat: u64,
    /// `None` when an input is not ours, so the fee cannot be known.
    pub fee_sat: Option<u64>,
    pub fee_rate_sat_vb: Option<f64>,
    /// `None` while unconfirmed.
    pub confirmations: Option<u32>,
    pub block_height: Option<u32>,
    pub timestamp: Option<u64>,
    pub vsize: u64,
    pub inputs: Vec<TxInput>,
    pub outputs: Vec<TxOutput>,
}

/// Map a builder failure onto the error domain, keeping the one case a UI
/// can act on — not enough money — structured instead of stringified.
fn build_error(e: CreateTxError) -> Error {
    match e {
        CreateTxError::CoinSelection(InsufficientFunds { needed, available }) => {
            Error::InsufficientFunds {
                needed_sat: needed.to_sat(),
                available_sat: available.to_sat(),
            }
        }
        other => Error::BuildTx(other.to_string()),
    }
}

struct Inner {
    wallet: Wallet,
    persister: Box<dyn Persister>,
    #[cfg(test)]
    fail_next_persist: bool,
}

/// Wallet handle. BDK calls run under a short-lived async mutex; network I/O
/// happens outside the lock. All methods are `async` so the same API serves
/// native runtimes and the browser.
pub struct WalletHandle {
    inner: Mutex<Inner>,
    backend: Box<dyn ChainBackend>,
    network: Network,
    address_type: AddressType,
    id: String,
    is_hd: bool,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Convert a fractional sat/vB rate into BDK's sat/kwu representation (rounding up).
pub fn fee_rate_from_sat_vb(sat_per_vb: f64) -> FeeRate {
    let clamped = sat_per_vb.max(MIN_FEE_RATE_SAT_VB);
    FeeRate::from_sat_per_kwu((clamped * 250.0).ceil() as u64)
}

impl WalletHandle {
    /// Open (or create) the wallet for `key`, connecting the configured backend.
    pub async fn open(
        config: WalletConfig,
        key: &KeyMaterial,
        persister: Box<dyn Persister>,
    ) -> Result<Self> {
        let backend = crate::backend::connect(&config.backend)?;
        Self::open_with(config, key, backend, persister).await
    }

    /// Open with explicit backend and persister (tests, custom providers).
    pub async fn open_with(
        config: WalletConfig,
        key: &KeyMaterial,
        backend: Box<dyn ChainBackend>,
        mut persister: Box<dyn Persister>,
    ) -> Result<Self> {
        let net = bdk_wallet::bitcoin::Network::from(config.network);
        let descriptors = descriptors_for(key, config.network, config.address_type)?;
        let id = wallet_id(key, config.network, config.address_type)?;
        let is_hd = matches!(descriptors, Descriptors::Hd { .. });

        let stored = persister.initialize().await?;
        let fresh = stored.is_empty();
        let wallet = match descriptors {
            Descriptors::Single(descriptor) if fresh => Wallet::create_single(descriptor)
                .network(net)
                .create_wallet_no_persist()
                .map_err(|e| Error::Descriptor(e.to_string()))?,
            Descriptors::Single(descriptor) => Wallet::load()
                .descriptor(KeychainKind::External, Some(descriptor))
                .extract_keys()
                .check_network(net)
                .load_wallet_no_persist(stored)
                .map_err(|e| Error::Persist(e.to_string()))?
                .ok_or_else(|| Error::Persist("stored wallet state is empty".into()))?,
            Descriptors::Hd { external, internal } if fresh => Wallet::create(external, internal)
                .network(net)
                .create_wallet_no_persist()
                .map_err(|e| Error::Descriptor(e.to_string()))?,
            Descriptors::Hd { external, internal } => Wallet::load()
                .descriptor(KeychainKind::External, Some(external))
                .descriptor(KeychainKind::Internal, Some(internal))
                .extract_keys()
                .check_network(net)
                .load_wallet_no_persist(stored)
                .map_err(|e| Error::Persist(e.to_string()))?
                .ok_or_else(|| Error::Persist("stored wallet state is empty".into()))?,
        };

        let mut inner = Inner {
            wallet,
            persister,
            #[cfg(test)]
            fail_next_persist: false,
        };
        Self::persist(&mut inner).await?;

        Ok(Self {
            inner: Mutex::new(inner),
            backend,
            network: config.network,
            address_type: config.address_type,
            id,
            is_hd,
        })
    }

    async fn persist(inner: &mut Inner) -> Result<()> {
        #[cfg(test)]
        if std::mem::take(&mut inner.fail_next_persist) {
            return Err(Error::Persist("injected persistence failure".into()));
        }
        let Inner {
            wallet, persister, ..
        } = inner;
        if let Some(stage) = wallet.staged_mut() {
            persister.persist(&*stage).await?;
            let _ = stage.take();
        }
        Ok(())
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn network(&self) -> Network {
        self.network
    }

    pub fn address_type(&self) -> AddressType {
        self.address_type
    }

    /// Whether this wallet is a BIP32 account (receive and change keychains)
    /// rather than a single key.
    pub fn is_hd(&self) -> bool {
        self.is_hd
    }

    /// The public descriptors, plus the account xpub and fingerprint for an
    /// HD wallet — what another wallet asks for to follow this one.
    pub async fn public_descriptors(&self) -> PublicDescriptors {
        let inner = self.inner.lock().await;
        let external = inner.wallet.public_descriptor(KeychainKind::External);
        let mut account_xpub = None;
        let mut fingerprint = None;
        external.for_each_key(|k| {
            if account_xpub.is_none()
                && let DescriptorPublicKey::XPub(x) = k
            {
                account_xpub = Some(x.xkey.to_string());
                fingerprint = Some(match &x.origin {
                    Some((master, _)) => master.to_string(),
                    None => x.xkey.fingerprint().to_string(),
                });
            }
            true
        });
        PublicDescriptors {
            external: external.to_string(),
            internal: self.is_hd.then(|| {
                inner
                    .wallet
                    .public_descriptor(KeychainKind::Internal)
                    .to_string()
            }),
            account_xpub,
            fingerprint,
        }
    }

    /// The address to receive at.
    ///
    /// Single-key: the wallet's one and only address. HD: the next external
    /// address that has not been used yet, revealing one if every revealed
    /// address is spent to. Calling this repeatedly returns the same address
    /// until it is used.
    ///
    /// Revealing an address stages a change, which is persisted on a
    /// best-effort basis here: this returns an address, not a `Result`, and a
    /// failed write is reconciled by the next successful persist (the revealed
    /// index is re-derived deterministically). Use [`Self::new_address`] when
    /// the caller needs to know that the reveal was stored.
    pub async fn address(&self) -> String {
        let mut inner = self.inner.lock().await;
        let info = if self.is_hd {
            inner.wallet.next_unused_address(KeychainKind::External)
        } else {
            inner.wallet.peek_address(KeychainKind::External, 0)
        };
        let address = self.encode(&info);
        if self.is_hd {
            let _ = Self::persist(&mut inner).await;
        }
        address
    }

    /// Reveal a fresh receiving address.
    ///
    /// HD: the next external address after everything revealed so far, even if
    /// the current one is still unused — this is the "give me another address"
    /// button. The revealed index is persisted before returning.
    ///
    /// Single-key: there is only one address, so this returns the same value as
    /// [`Self::address`].
    pub async fn new_address(&self) -> Result<String> {
        let mut inner = self.inner.lock().await;
        let info = if self.is_hd {
            inner.wallet.reveal_next_address(KeychainKind::External)
        } else {
            inner.wallet.peek_address(KeychainKind::External, 0)
        };
        let address = self.encode(&info);
        Self::persist(&mut inner).await?;
        Ok(address)
    }

    /// P2PK has no address encoding, so the bare public key is reported instead.
    fn encode(&self, info: &AddressInfo) -> String {
        match self.address_type {
            AddressType::P2pk => {
                crate::keys::pubkey_from_p2pk_script(&info.address.script_pubkey())
                    .unwrap_or_else(|| info.address.to_string())
            }
            _ => info.address.to_string(),
        }
    }

    /// Pull chain state from the backend and persist it.
    ///
    /// The first pass is a full scan, which walks every keychain the wallet has
    /// — for an HD wallet that is receive *and* change, so change outputs are
    /// discovered too. Later passes only re-check revealed scripts.
    pub async fn sync(&self) -> Result<()> {
        enum Req {
            Full(bdk_wallet::chain::spk_client::FullScanRequest<KeychainKind>),
            Partial(bdk_wallet::chain::spk_client::SyncRequest<(KeychainKind, u32)>),
        }
        let req = {
            let inner = self.inner.lock().await;
            let has_history = inner.wallet.transactions().next().is_some();
            // The `_at` variants take the start time from us: BDK's plain
            // builders read `std::time`, which aborts on wasm32.
            let start = now_secs();
            if has_history {
                Req::Partial(inner.wallet.start_sync_with_revealed_spks_at(start).build())
            } else {
                Req::Full(inner.wallet.start_full_scan_at(start).build())
            }
        };
        let update: bdk_wallet::Update = match req {
            Req::Full(r) => self
                .backend
                .full_scan(r, DEFAULT_STOP_GAP as usize)
                .await?
                .into(),
            Req::Partial(r) => self.backend.sync(r).await?.into(),
        };
        self.apply(update).await
    }

    /// Walk every keychain from the start again, looking `stop_gap` unused
    /// scripts past the last used one.
    ///
    /// [`Self::sync`] full-scans only a wallet with no history yet; after that
    /// it re-checks revealed scripts and nothing more. A wallet restored from
    /// a phrase that had spread its funds further than the default gap would
    /// therefore show too little, and keep showing it — this is the way out.
    /// Nothing is discarded: the result merges into what is already known.
    pub async fn rescan(&self, stop_gap: u32) -> Result<()> {
        if stop_gap == 0 || stop_gap > MAX_STOP_GAP {
            return Err(Error::Unsupported(format!(
                "stop gap must be between 1 and {MAX_STOP_GAP}"
            )));
        }
        let req = {
            let inner = self.inner.lock().await;
            inner.wallet.start_full_scan_at(now_secs()).build()
        };
        let update: bdk_wallet::Update =
            self.backend.full_scan(req, stop_gap as usize).await?.into();
        self.apply(update).await
    }

    async fn apply(&self, update: bdk_wallet::Update) -> Result<()> {
        let mut inner = self.inner.lock().await;
        inner
            .wallet
            .apply_update(update)
            .map_err(|e| Error::Backend(e.to_string()))?;
        Self::persist(&mut inner).await
    }

    pub async fn balance(&self) -> Balance {
        let b = self.inner.lock().await.wallet.balance();
        Balance {
            confirmed: b.confirmed.to_sat(),
            trusted_pending: b.trusted_pending.to_sat(),
            untrusted_pending: b.untrusted_pending.to_sat(),
            immature: b.immature.to_sat(),
        }
    }

    pub async fn list_utxos(&self) -> Vec<Utxo> {
        let inner = self.inner.lock().await;
        let tip = inner.wallet.latest_checkpoint().height();
        let net = bdk_wallet::bitcoin::Network::from(self.network);
        let mut utxos: Vec<Utxo> = inner
            .wallet
            .list_unspent()
            .map(|o| Utxo {
                txid: o.outpoint.txid.to_string(),
                vout: o.outpoint.vout,
                value: o.txout.value.to_sat(),
                confirmations: match o.chain_position {
                    ChainPosition::Confirmed { anchor, .. } => {
                        Some(tip.saturating_sub(anchor.block_id.height).saturating_add(1))
                    }
                    ChainPosition::Unconfirmed { .. } => None,
                },
                address: Address::from_script(&o.txout.script_pubkey, net)
                    .map(|a| a.to_string())
                    .unwrap_or_else(|_| o.txout.script_pubkey.to_hex_string()),
            })
            .collect();
        utxos.sort_by(|a, b| b.value.cmp(&a.value).then_with(|| a.txid.cmp(&b.txid)));
        utxos
    }

    /// Wallet history, newest first: unconfirmed transactions, then confirmed
    /// ones by descending block height.
    pub async fn list_transactions(&self) -> Vec<TxSummary> {
        let inner = self.inner.lock().await;
        let tip = inner.wallet.latest_checkpoint().height();

        // Sort key: unconfirmed outrank confirmed, then higher block first.
        let mut rows: Vec<(u8, u32, u64, TxSummary)> = inner
            .wallet
            .transactions()
            .map(|tx| {
                let (sent, received) = inner.wallet.sent_and_received(&tx.tx_node.tx);
                let (sent_sat, received_sat) = (sent.to_sat(), received.to_sat());
                let (tier, height, timestamp) = match tx.chain_position {
                    ChainPosition::Confirmed { anchor, .. } => {
                        (0, anchor.block_id.height, Some(anchor.confirmation_time))
                    }
                    ChainPosition::Unconfirmed {
                        last_seen,
                        first_seen,
                    } => (1, u32::MAX, last_seen.or(first_seen)),
                };
                let summary = TxSummary {
                    txid: tx.tx_node.txid.to_string(),
                    net_sat: received_sat as i64 - sent_sat as i64,
                    sent_sat,
                    received_sat,
                    fee_sat: inner
                        .wallet
                        .calculate_fee(&tx.tx_node.tx)
                        .ok()
                        .map(|f| f.to_sat()),
                    confirmations: match tx.chain_position {
                        ChainPosition::Confirmed { .. } => {
                            Some(tip.saturating_sub(height).saturating_add(1))
                        }
                        ChainPosition::Unconfirmed { .. } => None,
                    },
                    timestamp,
                };
                (tier, height, timestamp.unwrap_or(0), summary)
            })
            .collect();

        rows.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| b.1.cmp(&a.1))
                .then_with(|| b.2.cmp(&a.2))
                .then_with(|| a.3.txid.cmp(&b.3.txid))
        });
        rows.into_iter().map(|(_, _, _, s)| s).collect()
    }

    /// Everything the wallet knows about one of its transactions, or `None`
    /// when the txid is not in its history.
    pub async fn transaction(&self, txid: &str) -> Result<Option<TxDetail>> {
        let txid = bdk_wallet::bitcoin::Txid::from_str(txid)
            .map_err(|e| Error::BuildTx(format!("{txid}: {e}")))?;
        let inner = self.inner.lock().await;
        let Some(d) = inner.wallet.tx_details(txid) else {
            return Ok(None);
        };
        let tip = inner.wallet.latest_checkpoint().height();
        let net = bdk_wallet::bitcoin::Network::from(self.network);
        let graph = inner.wallet.tx_graph();
        let (confirmations, block_height, timestamp) = match d.chain_position {
            ChainPosition::Confirmed { anchor, .. } => (
                Some(tip.saturating_sub(anchor.block_id.height).saturating_add(1)),
                Some(anchor.block_id.height),
                Some(anchor.confirmation_time),
            ),
            ChainPosition::Unconfirmed {
                last_seen,
                first_seen,
            } => (None, None, last_seen.or(first_seen)),
        };
        let inputs =
            d.tx.input
                .iter()
                .map(|i| {
                    let prev = graph.get_txout(i.previous_output);
                    TxInput {
                        txid: i.previous_output.txid.to_string(),
                        vout: i.previous_output.vout,
                        value_sat: prev.map(|o| o.value.to_sat()),
                        ours: prev.is_some_and(|o| inner.wallet.is_mine(o.script_pubkey.clone())),
                    }
                })
                .collect();
        let outputs =
            d.tx.output
                .iter()
                .map(|o| TxOutput {
                    address: Address::from_script(&o.script_pubkey, net)
                        .ok()
                        .map(|a| a.to_string()),
                    value_sat: o.value.to_sat(),
                    ours: inner.wallet.is_mine(o.script_pubkey.clone()),
                })
                .collect();
        Ok(Some(TxDetail {
            txid: txid.to_string(),
            net_sat: d.balance_delta.to_sat(),
            sent_sat: d.sent.to_sat(),
            received_sat: d.received.to_sat(),
            fee_sat: d.fee.map(|f| f.to_sat()),
            // sat/kwu is BDK's unit; 4 weight units to the virtual byte.
            fee_rate_sat_vb: d.fee_rate.map(|r| r.to_sat_per_kwu() as f64 * 4.0 / 1000.0),
            confirmations,
            block_height,
            timestamp,
            vsize: d.tx.vsize() as u64,
            inputs,
            outputs,
        }))
    }

    pub async fn estimate_fee(&self) -> Result<FeeEstimate> {
        self.backend.fee_estimates().await
    }

    pub async fn chain_height(&self) -> Result<u32> {
        self.backend.height().await
    }

    /// Build an unsigned transfer. Change goes to the internal keychain for an
    /// HD wallet, and back to the single address otherwise.
    pub async fn build_transfer(
        &self,
        recipients: &[Recipient],
        fee_rate_sat_vb: f64,
    ) -> Result<BuiltTx> {
        if recipients.is_empty() {
            return Err(Error::BuildTx("no recipients".into()));
        }
        let mut outputs = Vec::with_capacity(recipients.len());
        for r in recipients {
            let addr = self.recipient_address(&r.address)?;
            if r.amount_sat == 0 {
                return Err(Error::BuildTx(format!("zero amount for {}", r.address)));
            }
            outputs.push((addr.script_pubkey(), Amount::from_sat(r.amount_sat)));
        }

        let mut inner = self.inner.lock().await;
        let psbt = {
            let mut builder = inner.wallet.build_tx();
            builder
                .set_recipients(outputs)
                .fee_rate(fee_rate_from_sat_vb(fee_rate_sat_vb));
            builder.finish().map_err(build_error)?
        };
        Self::persist(&mut inner).await?;

        let total_out_sat = recipients.iter().map(|r| r.amount_sat).sum();
        Self::summarize(&inner, psbt, Some(total_out_sat))
    }

    /// Build a transfer that empties the wallet into one address.
    ///
    /// This is what "Max" means: coin selection takes every spendable output,
    /// the fee comes off the top and there is no change, so the amount read
    /// back from [`BuiltTx::total_out_sat`] is exactly what arrives. Guessing
    /// that number from an assumed size and subtracting is off by a few sats
    /// either way — it then fails to build, or leaves dust behind.
    pub async fn build_drain(&self, address: &str, fee_rate_sat_vb: f64) -> Result<BuiltTx> {
        let addr = self.recipient_address(address)?;
        let mut inner = self.inner.lock().await;
        let psbt = {
            let mut builder = inner.wallet.build_tx();
            builder
                .drain_wallet()
                .drain_to(addr.script_pubkey())
                .fee_rate(fee_rate_from_sat_vb(fee_rate_sat_vb));
            builder.finish().map_err(build_error)?
        };
        Self::persist(&mut inner).await?;
        Self::summarize(&inner, psbt, None)
    }

    /// Parse an address and insist it belongs to this wallet's network.
    fn recipient_address(&self, address: &str) -> Result<Address> {
        let net = bdk_wallet::bitcoin::Network::from(self.network);
        Address::from_str(address)
            .map_err(|e| Error::InvalidAddress(format!("{address}: {e}")))?
            .require_network(net)
            .map_err(|e| Error::InvalidAddress(format!("{address}: {e}")))
    }

    /// Rebuild an unconfirmed transaction of ours at a higher fee rate.
    ///
    /// Transactions built by [`Self::build_transfer`] signal replaceability, so
    /// a stuck payment can be re-sent with a bigger fee: the result is a new
    /// PSBT that spends the same inputs and must be signed and broadcast like
    /// any other. The backend rejects a bump that does not raise the fee enough
    /// to replace the original.
    pub async fn build_fee_bump(&self, txid: &str, fee_rate_sat_vb: f64) -> Result<BuiltTx> {
        let txid = bdk_wallet::bitcoin::Txid::from_str(txid)
            .map_err(|e| Error::BuildTx(format!("{txid}: {e}")))?;
        let mut inner = self.inner.lock().await;
        let psbt = {
            let mut builder = inner
                .wallet
                .build_fee_bump(txid)
                .map_err(|e| Error::BuildTx(e.to_string()))?;
            builder.fee_rate(fee_rate_from_sat_vb(fee_rate_sat_vb));
            builder.finish().map_err(build_error)?
        };
        Self::persist(&mut inner).await?;
        Self::summarize(&inner, psbt, None)
    }

    /// Describe a built PSBT. `total_out` is the amount intended for others;
    /// when it is not known up front (a fee bump) it is taken to be everything
    /// paid to scripts the wallet does not own.
    fn summarize(inner: &Inner, psbt: Psbt, total_out: Option<u64>) -> Result<BuiltTx> {
        let fee_sat = psbt.fee().map_err(|e| Error::Psbt(e.to_string()))?.to_sat();
        let tx = &psbt.unsigned_tx;
        let change_sat = tx
            .output
            .iter()
            .filter(|o| inner.wallet.is_mine(o.script_pubkey.clone()))
            .map(|o| o.value.to_sat())
            .sum();
        let total_out_sat = total_out.unwrap_or_else(|| {
            tx.output
                .iter()
                .filter(|o| !inner.wallet.is_mine(o.script_pubkey.clone()))
                .map(|o| o.value.to_sat())
                .sum()
        });
        Ok(BuiltTx {
            psbt_base64: psbt.to_string(),
            fee_sat,
            vsize: tx.vsize() as u64,
            total_out_sat,
            change_sat,
            input_count: tx.input.len() as u32,
        })
    }

    /// Sign and finalize a PSBT produced by [`Self::build_transfer`].
    pub async fn sign(&self, psbt_base64: &str) -> Result<String> {
        let mut psbt = Psbt::from_str(psbt_base64).map_err(|e| Error::Psbt(e.to_string()))?;
        let inner = self.inner.lock().await;
        let finalized = inner
            .wallet
            .sign(&mut psbt, SignOptions::default())
            .map_err(|e| Error::Sign(e.to_string()))?;
        if !finalized {
            return Err(Error::Sign(
                "psbt could not be finalized with the wallet key".into(),
            ));
        }
        Ok(psbt.to_string())
    }

    /// Extract the transaction from a finalized PSBT.
    pub fn extract_tx(psbt_base64: &str) -> Result<Transaction> {
        let psbt = Psbt::from_str(psbt_base64).map_err(|e| Error::Psbt(e.to_string()))?;
        psbt.extract_tx().map_err(|e| Error::Psbt(e.to_string()))
    }

    /// Broadcast a finalized PSBT and record it as unconfirmed locally.
    ///
    /// Network acceptance and local persistence are reported separately: once
    /// the backend has accepted the transaction this returns `Ok` with the
    /// txid, and a persistence failure is carried in [`Broadcast::persist_error`]
    /// rather than turning a successful send into an error.
    pub async fn broadcast(&self, signed_psbt_base64: &str) -> Result<Broadcast> {
        let tx = Self::extract_tx(signed_psbt_base64)?;
        let txid = self.backend.broadcast(&tx).await?.to_string();
        let mut inner = self.inner.lock().await;
        inner.wallet.apply_unconfirmed_txs([(tx, now_secs())]);
        let persist_error = Self::persist(&mut inner).await.err().map(|e| e.to_string());
        Ok(Broadcast {
            txid,
            persist_error,
        })
    }

    /// One-shot transfer with Go `BroadcastTx` semantics:
    /// fee = max(1 sat/vB, backend estimate for 6 blocks) unless overridden.
    pub async fn send(
        &self,
        recipients: &[Recipient],
        fee_rate_sat_vb: Option<f64>,
    ) -> Result<Broadcast> {
        let rate = match fee_rate_sat_vb {
            Some(r) => r,
            None => self
                .estimate_fee()
                .await?
                .for_target(DEFAULT_FEE_TARGET)
                .unwrap_or(MIN_FEE_RATE_SAT_VB),
        };
        let built = self.build_transfer(recipients, rate).await?;
        let signed = self.sign(&built.psbt_base64).await?;
        self.broadcast(&signed).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use bdk_wallet::bitcoin::{
        OutPoint, ScriptBuf, Sequence, TxIn, TxOut, Witness, absolute, transaction,
    };

    use super::*;
    use crate::backend::mock::MockBackend;
    use crate::persist::MemoryPersister;

    const SK_HEX: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const MNEMONIC: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn cfg(address_type: AddressType) -> WalletConfig {
        WalletConfig {
            network: Network::Regtest,
            address_type,
            backend: BackendConfig::Esplora {
                url: "unused".into(),
            },
        }
    }

    struct ArcBackend(Arc<MockBackend>);
    #[async_trait::async_trait]
    impl ChainBackend for ArcBackend {
        async fn full_scan(
            &self,
            r: bdk_wallet::chain::spk_client::FullScanRequest<KeychainKind>,
            stop_gap: usize,
        ) -> Result<bdk_wallet::chain::spk_client::FullScanResponse<KeychainKind>> {
            self.0.full_scan(r, stop_gap).await
        }
        async fn sync(
            &self,
            r: bdk_wallet::chain::spk_client::SyncRequest<(KeychainKind, u32)>,
        ) -> Result<bdk_wallet::chain::spk_client::SyncResponse> {
            self.0.sync(r).await
        }
        async fn broadcast(&self, tx: &Transaction) -> Result<bdk_wallet::bitcoin::Txid> {
            self.0.broadcast(tx).await
        }
        async fn fee_estimates(&self) -> Result<FeeEstimate> {
            self.0.fee_estimates().await
        }
        async fn height(&self) -> Result<u32> {
            self.0.height().await
        }
    }

    async fn open_key(
        address_type: AddressType,
        key: KeyMaterial,
    ) -> (WalletHandle, Arc<MockBackend>) {
        let mock = Arc::new(MockBackend::with_fee(6, 2.0));
        let handle = WalletHandle::open_with(
            cfg(address_type),
            &key,
            Box::new(ArcBackend(mock.clone())),
            Box::new(MemoryPersister::new()),
        )
        .await
        .unwrap();
        (handle, mock)
    }

    async fn open(address_type: AddressType) -> (WalletHandle, Arc<MockBackend>) {
        open_key(address_type, KeyMaterial::PrivHex(SK_HEX.into())).await
    }

    async fn open_hd(address_type: AddressType) -> (WalletHandle, Arc<MockBackend>) {
        open_key(
            address_type,
            KeyMaterial::Mnemonic {
                words: MNEMONIC.into(),
                passphrase: None,
            },
        )
        .await
    }

    fn funding_tx(spk: ScriptBuf, sats: u64) -> Transaction {
        Transaction {
            version: transaction::Version::TWO,
            lock_time: absolute::LockTime::ZERO,
            input: vec![TxIn {
                previous_output: OutPoint {
                    txid: bdk_wallet::bitcoin::Txid::from_str(&"11".repeat(32)).unwrap(),
                    vout: 0,
                },
                script_sig: ScriptBuf::new(),
                sequence: Sequence::MAX,
                witness: Witness::new(),
            }],
            output: vec![TxOut {
                value: Amount::from_sat(sats),
                script_pubkey: spk,
            }],
        }
    }

    async fn fund(handle: &WalletHandle, sats: u64) {
        let mut inner = handle.inner.lock().await;
        let spk = inner
            .wallet
            .peek_address(KeychainKind::External, 0)
            .address
            .script_pubkey();
        inner
            .wallet
            .apply_unconfirmed_txs([(funding_tx(spk, sats), 1)]);
        WalletHandle::persist(&mut inner).await.unwrap();
    }

    fn dest(t: AddressType) -> String {
        crate::keys::generate_key(Network::Regtest, t)
            .unwrap()
            .address
            .clone()
    }

    #[tokio::test]
    async fn build_sign_broadcast_each_type() {
        for t in [
            AddressType::P2pkh,
            AddressType::P2wpkh,
            AddressType::NestedP2wpkh,
            AddressType::P2tr,
        ] {
            let (handle, mock) = open(t).await;
            assert_eq!(handle.balance().await.total(), 0);
            fund(&handle, 100_000).await;
            assert_eq!(handle.balance().await.total(), 100_000);
            assert_eq!(handle.list_utxos().await.len(), 1);
            assert_eq!(handle.list_utxos().await[0].address, handle.address().await);

            let built = handle
                .build_transfer(
                    &[Recipient {
                        address: dest(AddressType::P2wpkh),
                        amount_sat: 40_000,
                    }],
                    2.0,
                )
                .await
                .unwrap_or_else(|e| panic!("{t:?}: {e}"));
            assert_eq!(built.total_out_sat, 40_000);
            assert!(
                built.fee_sat > 0 && built.fee_sat < 2_000,
                "{t:?} fee {}",
                built.fee_sat
            );
            assert_eq!(built.change_sat, 100_000 - 40_000 - built.fee_sat);

            let signed = handle
                .sign(&built.psbt_base64)
                .await
                .unwrap_or_else(|e| panic!("{t:?}: {e}"));
            let out = handle.broadcast(&signed).await.unwrap();
            assert_eq!(out.persist_error, None);
            assert_eq!(mock.broadcasts.lock().unwrap().len(), 1);
            assert_eq!(
                mock.broadcasts.lock().unwrap()[0]
                    .compute_txid()
                    .to_string(),
                out.txid
            );
            assert_eq!(handle.balance().await.total(), built.change_sat);
        }
    }

    /// History shows both sides of a spend: the incoming funding and the
    /// outgoing transfer, whose net includes the fee.
    #[tokio::test]
    async fn list_transactions_reports_direction_and_fee() {
        let (handle, _) = open(AddressType::P2wpkh).await;
        assert!(handle.list_transactions().await.is_empty());
        fund(&handle, 100_000).await;

        let history = handle.list_transactions().await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].net_sat, 100_000);
        assert_eq!(history[0].received_sat, 100_000);
        assert_eq!(history[0].sent_sat, 0);
        assert!(!history[0].is_outgoing());
        assert_eq!(history[0].confirmations, None, "funding tx is unconfirmed");

        let built = handle
            .build_transfer(
                &[Recipient {
                    address: dest(AddressType::P2tr),
                    amount_sat: 40_000,
                }],
                2.0,
            )
            .await
            .unwrap();
        let signed = handle.sign(&built.psbt_base64).await.unwrap();
        let out = handle.broadcast(&signed).await.unwrap();

        let history = handle.list_transactions().await;
        assert_eq!(history.len(), 2);
        let spend = history
            .iter()
            .find(|t| t.txid == out.txid)
            .expect("spend in history");
        assert!(spend.is_outgoing());
        // Leaving the wallet: the recipient's 40k plus the fee.
        assert_eq!(spend.net_sat, -((40_000 + built.fee_sat) as i64));
        assert_eq!(spend.sent_sat, 100_000, "the whole funded utxo is an input");
        assert_eq!(spend.received_sat, built.change_sat);
        assert_eq!(spend.fee_sat, Some(built.fee_sat));
    }

    #[tokio::test]
    async fn send_uses_estimate_and_floor() {
        let (handle, mock) = open(AddressType::P2wpkh).await;
        fund(&handle, 50_000).await;
        handle
            .send(
                &[Recipient {
                    address: dest(AddressType::P2tr),
                    amount_sat: 10_000,
                }],
                None,
            )
            .await
            .unwrap();
        assert_eq!(mock.broadcasts.lock().unwrap().len(), 1);
    }

    /// Backend accepted the tx but local persistence failed: the caller must
    /// still get the txid and be able to tell this apart from a failed send.
    #[tokio::test]
    async fn broadcast_reports_persist_failure_separately() {
        let (handle, mock) = open(AddressType::P2wpkh).await;
        fund(&handle, 50_000).await;
        let built = handle
            .build_transfer(
                &[Recipient {
                    address: dest(AddressType::P2wpkh),
                    amount_sat: 10_000,
                }],
                1.0,
            )
            .await
            .unwrap();
        let signed = handle.sign(&built.psbt_base64).await.unwrap();
        handle.inner.lock().await.fail_next_persist = true;

        let out = handle
            .broadcast(&signed)
            .await
            .expect("broadcast success must not become an error");
        assert_eq!(
            mock.broadcasts.lock().unwrap().len(),
            1,
            "backend received the tx"
        );
        assert_eq!(
            out.txid,
            mock.broadcasts.lock().unwrap()[0]
                .compute_txid()
                .to_string()
        );
        assert!(
            out.persist_error
                .as_deref()
                .unwrap_or("")
                .contains("injected"),
            "{out:?}"
        );
        assert_eq!(
            handle.balance().await.total(),
            built.change_sat,
            "in-memory state still tracks the spend"
        );

        struct Failing;
        #[async_trait::async_trait]
        impl ChainBackend for Failing {
            async fn full_scan(
                &self,
                _: bdk_wallet::chain::spk_client::FullScanRequest<KeychainKind>,
                _stop_gap: usize,
            ) -> Result<bdk_wallet::chain::spk_client::FullScanResponse<KeychainKind>> {
                unreachable!()
            }
            async fn sync(
                &self,
                _: bdk_wallet::chain::spk_client::SyncRequest<(KeychainKind, u32)>,
            ) -> Result<bdk_wallet::chain::spk_client::SyncResponse> {
                unreachable!()
            }
            async fn broadcast(&self, _: &Transaction) -> Result<bdk_wallet::bitcoin::Txid> {
                Err(Error::Backend("relay refused".into()))
            }
            async fn fee_estimates(&self) -> Result<FeeEstimate> {
                unreachable!()
            }
            async fn height(&self) -> Result<u32> {
                unreachable!()
            }
        }
        let h2 = WalletHandle::open_with(
            cfg(AddressType::P2wpkh),
            &KeyMaterial::PrivHex(SK_HEX.into()),
            Box::new(Failing),
            Box::new(MemoryPersister::new()),
        )
        .await
        .unwrap();
        fund(&h2, 50_000).await;
        let built = h2
            .build_transfer(
                &[Recipient {
                    address: dest(AddressType::P2tr),
                    amount_sat: 10_000,
                }],
                1.0,
            )
            .await
            .unwrap();
        let signed = h2.sign(&built.psbt_base64).await.unwrap();
        assert!(matches!(
            h2.broadcast(&signed).await,
            Err(Error::Backend(_))
        ));
        assert_eq!(
            h2.balance().await.total(),
            50_000,
            "nothing applied on failed broadcast"
        );
    }

    #[tokio::test]
    async fn build_rejects_bad_input() {
        let (handle, _) = open(AddressType::P2wpkh).await;
        fund(&handle, 50_000).await;
        assert!(matches!(
            handle.build_transfer(&[], 1.0).await,
            Err(Error::BuildTx(_))
        ));
        let mainnet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4".to_string();
        assert!(matches!(
            handle
                .build_transfer(
                    &[Recipient {
                        address: mainnet,
                        amount_sat: 1
                    }],
                    1.0
                )
                .await,
            Err(Error::InvalidAddress(_))
        ));
        assert!(matches!(
            handle
                .build_transfer(
                    &[Recipient {
                        address: dest(AddressType::P2wpkh),
                        amount_sat: 1_000_000
                    }],
                    1.0
                )
                .await,
            Err(Error::InsufficientFunds { .. })
        ));
    }

    /// The point of the internal keychain: change leaves the receive addresses
    /// alone. Also pins the `address()` / `new_address()` split.
    #[tokio::test]
    async fn hd_reveals_addresses_and_keeps_change_off_them() {
        let (handle, _) = open_hd(AddressType::P2wpkh).await;
        assert!(handle.is_hd());
        assert!(
            handle.id().starts_with("regtest-p2wpkh-"),
            "{}",
            handle.id()
        );

        let first = handle.address().await;
        assert_eq!(handle.address().await, first, "an unused address is stable");
        let second = handle.new_address().await.unwrap();
        assert_ne!(second, first, "new_address reveals a fresh one");
        assert_eq!(handle.address().await, first, "…and first is still unused");

        fund(&handle, 100_000).await;
        assert_eq!(
            handle.address().await,
            second,
            "once the first is used, address() moves on"
        );

        let built = handle
            .build_transfer(
                &[Recipient {
                    address: dest(AddressType::P2tr),
                    amount_sat: 40_000,
                }],
                2.0,
            )
            .await
            .unwrap();
        assert!(built.change_sat > 0, "the spend must produce change");

        let psbt = Psbt::from_str(&built.psbt_base64).unwrap();
        let inner = handle.inner.lock().await;
        let net = bdk_wallet::bitcoin::Network::Regtest;
        let change: Vec<String> = psbt
            .unsigned_tx
            .output
            .iter()
            .filter(|o| inner.wallet.is_mine(o.script_pubkey.clone()))
            .map(|o| {
                Address::from_script(&o.script_pubkey, net)
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(change.len(), 1, "exactly one output comes back to us");
        assert_ne!(change[0], first, "change is not the funded receive address");
        assert_ne!(change[0], second, "change is not a receive address at all");
        assert_eq!(
            inner
                .wallet
                .derivation_of_spk(
                    Address::from_str(&change[0])
                        .unwrap()
                        .assume_checked()
                        .script_pubkey()
                )
                .map(|(keychain, _)| keychain),
            Some(KeychainKind::Internal),
            "change lives on the internal keychain"
        );
    }

    /// A single-key wallet has one address, so "give me a new one" gives it back.
    #[tokio::test]
    async fn single_key_new_address_is_the_same_address() {
        let (handle, _) = open(AddressType::P2wpkh).await;
        assert!(!handle.is_hd());
        let address = handle.address().await;
        assert_eq!(handle.new_address().await.unwrap(), address);
        assert_eq!(handle.address().await, address);
    }

    #[test]
    fn fee_rate_conversion_rounds_up() {
        assert_eq!(fee_rate_from_sat_vb(1.0).to_sat_per_kwu(), 250);
        assert_eq!(fee_rate_from_sat_vb(0.1).to_sat_per_kwu(), 250);
        assert_eq!(fee_rate_from_sat_vb(2.5).to_sat_per_kwu(), 625);
    }

    /// State persisted through the portable boundary reloads into a new handle
    /// — the same path IndexedDB takes: one aggregated changeset per wallet.
    #[tokio::test]
    async fn persists_and_reloads_through_persister() {
        /// Persister sharing one aggregated changeset between handles.
        #[derive(Clone, Default)]
        struct SharedPersister(Arc<std::sync::Mutex<bdk_wallet::ChangeSet>>);

        #[async_trait::async_trait]
        impl crate::persist::Persister for SharedPersister {
            async fn initialize(&mut self) -> Result<bdk_wallet::ChangeSet> {
                Ok(self.0.lock().unwrap().clone())
            }

            async fn persist(&mut self, delta: &bdk_wallet::ChangeSet) -> Result<()> {
                use bdk_wallet::chain::Merge;
                self.0.lock().unwrap().merge(delta.clone());
                Ok(())
            }
        }

        let key = KeyMaterial::PrivHex(SK_HEX.into());
        let store = SharedPersister::default();

        let a = WalletHandle::open_with(
            cfg(AddressType::P2wpkh),
            &key,
            Box::new(MockBackend::default()),
            Box::new(store.clone()),
        )
        .await
        .unwrap();
        fund(&a, 1234).await;
        let address = a.address().await;
        drop(a);

        // Stored state is JSON-portable (what a browser store would hold).
        let json = crate::persist::changeset_to_json(&store.0.lock().unwrap().clone()).unwrap();
        assert!(!json.is_empty());
        let restored = crate::persist::changeset_from_json(Some(&json)).unwrap();

        let mut reloaded = SharedPersister::default();
        crate::persist::Persister::persist(&mut reloaded, &restored)
            .await
            .unwrap();
        let b = WalletHandle::open_with(
            cfg(AddressType::P2wpkh),
            &key,
            Box::new(MockBackend::default()),
            Box::new(reloaded),
        )
        .await
        .unwrap();
        assert_eq!(b.balance().await.total(), 1234);
        assert_eq!(b.address().await, address);
    }

    #[tokio::test]
    async fn rescan_forwards_the_gap_and_rejects_nonsense() {
        let (handle, mock) = open(AddressType::P2wpkh).await;
        handle.sync().await.unwrap();
        assert_eq!(
            *mock.last_stop_gap.lock().unwrap(),
            Some(DEFAULT_STOP_GAP as usize)
        );
        handle.rescan(100).await.unwrap();
        assert_eq!(*mock.last_stop_gap.lock().unwrap(), Some(100));
        assert!(matches!(handle.rescan(0).await, Err(Error::Unsupported(_))));
        assert!(matches!(
            handle.rescan(MAX_STOP_GAP + 1).await,
            Err(Error::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn insufficient_funds_carries_amounts() {
        let (handle, _) = open(AddressType::P2wpkh).await;
        fund(&handle, 10_000).await;
        let err = handle
            .build_transfer(
                &[Recipient {
                    address: dest(AddressType::P2wpkh),
                    amount_sat: 1_000_000,
                }],
                1.0,
            )
            .await
            .unwrap_err();
        assert_eq!(err.code(), "insufficient_funds");
        match err {
            Error::InsufficientFunds {
                needed_sat,
                available_sat,
            } => {
                assert!(
                    needed_sat > available_sat,
                    "{needed_sat} vs {available_sat}"
                );
                assert_eq!(available_sat, 10_000);
            }
            other => panic!("expected InsufficientFunds, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn drain_builds_with_no_change_output() {
        let (handle, _) = open(AddressType::P2wpkh).await;
        fund(&handle, 100_000).await;
        let built = handle
            .build_drain(&dest(AddressType::P2wpkh), 2.0)
            .await
            .unwrap();
        assert_eq!(built.change_sat, 0);
        assert_eq!(built.input_count, 1);
        assert_eq!(built.total_out_sat + built.fee_sat, 100_000);
        // A real spend, not a preview trick: it signs.
        handle.sign(&built.psbt_base64).await.unwrap();
    }

    #[tokio::test]
    async fn public_descriptors_expose_the_account_xpub_only_for_hd() {
        let (hd, _) = open_hd(AddressType::P2wpkh).await;
        let d = hd.public_descriptors().await;
        assert!(
            d.external.starts_with("wpkh([73c5da0a/84"),
            "{}",
            d.external
        );
        assert!(
            d.external.contains("tpub") && d.external.contains("/0/*)"),
            "{}",
            d.external
        );
        assert!(!d.external.contains("tprv"));
        let internal = d.internal.as_deref().expect("hd has a change keychain");
        assert!(internal.contains("/1/*)"), "{internal}");
        let xpub = d.account_xpub.as_deref().expect("hd has an account xpub");
        assert!(xpub.starts_with("tpub"), "{xpub}");
        assert_eq!(d.fingerprint.as_deref(), Some("73c5da0a"));

        let (single, _) = open(AddressType::P2wpkh).await;
        let s = single.public_descriptors().await;
        assert!(s.external.starts_with("wpkh(02"), "{}", s.external);
        assert!(s.internal.is_none() && s.account_xpub.is_none() && s.fingerprint.is_none());
    }

    #[tokio::test]
    async fn transaction_detail_marks_our_outputs() {
        let (handle, _) = open(AddressType::P2wpkh).await;
        fund(&handle, 100_000).await;
        let txid = handle.list_transactions().await[0].txid.clone();
        let d = handle.transaction(&txid).await.unwrap().expect("known tx");
        assert_eq!(d.txid, txid);
        assert_eq!(
            (d.received_sat, d.net_sat, d.confirmations),
            (100_000, 100_000, None)
        );
        assert_eq!(d.outputs.len(), 1);
        assert!(d.outputs[0].ours);
        assert_eq!(d.outputs[0].value_sat, 100_000);
        assert!(
            d.outputs[0]
                .address
                .as_deref()
                .is_some_and(|a| a.starts_with("bcrt1")),
            "{:?}",
            d.outputs[0].address
        );
        // The funding input spends an output the wallet never saw.
        assert_eq!(d.inputs.len(), 1);
        assert_eq!(d.inputs[0].value_sat, None);
        assert!(!d.inputs[0].ours);
        assert_eq!(d.fee_sat, None);
        assert!(d.vsize > 0);
        assert!(
            handle
                .transaction(&"22".repeat(32))
                .await
                .unwrap()
                .is_none()
        );
    }
}
