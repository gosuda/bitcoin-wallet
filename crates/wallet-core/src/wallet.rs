//! Single-key wallet handle: BDK wallet + portable persistence + chain backend.

use std::str::FromStr;

use async_lock::Mutex;
use bdk_wallet::bitcoin::{Address, Amount, FeeRate, Psbt, Transaction};
use bdk_wallet::chain::{ChainPosition, Merge};
use bdk_wallet::{KeychainKind, SignOptions, Wallet};
use serde::{Deserialize, Serialize};
use web_time::{SystemTime, UNIX_EPOCH};

use crate::backend::{BackendConfig, ChainBackend, FeeEstimate};
use crate::keys::{AddressType, KeyMaterial, descriptor_for, wallet_id};
use crate::network::Network;
use crate::persist::Persister;
use crate::{Error, Result};

/// Confirmation target used when the caller does not choose a fee rate (Go parity: 6 blocks).
pub const DEFAULT_FEE_TARGET: u16 = 6;
/// Floor applied to any fee rate (Go parity: 1 sat/vB).
pub const MIN_FEE_RATE_SAT_VB: f64 = 1.0;

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
        let descriptor = descriptor_for(key, config.network, config.address_type)?;
        let id = wallet_id(key, config.network, config.address_type)?;

        let stored = persister.initialize().await?;
        let wallet = if stored.is_empty() {
            Wallet::create_single(descriptor)
                .network(net)
                .create_wallet_no_persist()
                .map_err(|e| Error::Descriptor(e.to_string()))?
        } else {
            Wallet::load()
                .descriptor(KeychainKind::External, Some(descriptor))
                .extract_keys()
                .check_network(net)
                .load_wallet_no_persist(stored)
                .map_err(|e| Error::Persist(e.to_string()))?
                .ok_or_else(|| Error::Persist("stored wallet state is empty".into()))?
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

    /// The wallet's single receiving address.
    pub async fn address(&self) -> String {
        let inner = self.inner.lock().await;
        let info = inner.wallet.peek_address(KeychainKind::External, 0);
        match self.address_type {
            AddressType::P2pk => {
                crate::keys::pubkey_from_p2pk_script(&info.address.script_pubkey())
                    .unwrap_or_else(|| info.address.to_string())
            }
            _ => info.address.to_string(),
        }
    }

    /// Pull chain state from the backend and persist it.
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
            Req::Full(r) => self.backend.full_scan(r).await?.into(),
            Req::Partial(r) => self.backend.sync(r).await?.into(),
        };
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

    pub async fn estimate_fee(&self) -> Result<FeeEstimate> {
        self.backend.fee_estimates().await
    }

    pub async fn chain_height(&self) -> Result<u32> {
        self.backend.height().await
    }

    /// Build an unsigned transfer; change returns to the wallet address.
    pub async fn build_transfer(
        &self,
        recipients: &[Recipient],
        fee_rate_sat_vb: f64,
    ) -> Result<BuiltTx> {
        if recipients.is_empty() {
            return Err(Error::BuildTx("no recipients".into()));
        }
        let net = bdk_wallet::bitcoin::Network::from(self.network);
        let mut outputs = Vec::with_capacity(recipients.len());
        for r in recipients {
            let addr = Address::from_str(&r.address)
                .map_err(|e| Error::InvalidAddress(format!("{}: {e}", r.address)))?
                .require_network(net)
                .map_err(|e| Error::InvalidAddress(format!("{}: {e}", r.address)))?;
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
            builder
                .finish()
                .map_err(|e| Error::BuildTx(e.to_string()))?
        };
        Self::persist(&mut inner).await?;

        let total_out_sat = recipients.iter().map(|r| r.amount_sat).sum();
        Self::summarize(&inner, psbt, Some(total_out_sat))
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
            builder
                .finish()
                .map_err(|e| Error::BuildTx(e.to_string()))?
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
        ) -> Result<bdk_wallet::chain::spk_client::FullScanResponse<KeychainKind>> {
            self.0.full_scan(r).await
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

    async fn open(address_type: AddressType) -> (WalletHandle, Arc<MockBackend>) {
        let mock = Arc::new(MockBackend::with_fee(6, 2.0));
        let handle = WalletHandle::open_with(
            cfg(address_type),
            &KeyMaterial::PrivHex(SK_HEX.into()),
            Box::new(ArcBackend(mock.clone())),
            Box::new(MemoryPersister::new()),
        )
        .await
        .unwrap();
        (handle, mock)
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
            Err(Error::BuildTx(_))
        ));
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
}
