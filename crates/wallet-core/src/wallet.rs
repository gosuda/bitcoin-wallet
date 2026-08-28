//! Single-key wallet handle: BDK wallet + persistence + chain backend.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use bdk_wallet::bitcoin::{Address, Amount, FeeRate, Psbt, Transaction};
use bdk_wallet::chain::ChainPosition;
use bdk_wallet::rusqlite::Connection;
use bdk_wallet::{KeychainKind, PersistedWallet, SignOptions, Wallet};
use serde::{Deserialize, Serialize};

use crate::backend::{BackendConfig, ChainBackend, FeeEstimate};
use crate::keys::{AddressType, KeyMaterial, descriptor_for, wallet_id};
use crate::network::Network;
use crate::{Error, Result};

/// Confirmation target used when the caller does not choose a fee rate (Go parity: 6 blocks).
pub const DEFAULT_FEE_TARGET: u16 = 6;
/// Floor applied to any fee rate (Go parity: 1 sat/vB).
pub const MIN_FEE_RATE_SAT_VB: f64 = 1.0;

/// Everything needed to open a wallet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConfig {
    pub network: Network,
    pub address_type: AddressType,
    pub backend: BackendConfig,
    /// SQLite file for wallet state; `None` keeps state in memory only.
    #[serde(default)]
    pub db_path: Option<PathBuf>,
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

struct Inner {
    wallet: PersistedWallet<Connection>,
    db: Connection,
}

/// Thread-safe wallet. Synchronous BDK calls run under a short-lived mutex;
/// network I/O happens outside the lock.
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
    /// Open (or create) the wallet for `key` using the configured backend.
    pub fn open(config: WalletConfig, key: &KeyMaterial) -> Result<Self> {
        let backend = crate::backend::connect(&config.backend)?;
        Self::open_with_backend(config, key, backend)
    }

    /// Open with an explicit backend (used by tests and custom providers).
    pub fn open_with_backend(
        config: WalletConfig,
        key: &KeyMaterial,
        backend: Box<dyn ChainBackend>,
    ) -> Result<Self> {
        let net = bdk_wallet::bitcoin::Network::from(config.network);
        let descriptor = descriptor_for(key, config.network, config.address_type)?;
        let id = wallet_id(key, config.network, config.address_type)?;

        let mut db = match &config.db_path {
            Some(path) => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| Error::Persist(e.to_string()))?;
                }
                Connection::open(path)
            }
            None => Connection::open_in_memory(),
        }
        .map_err(|e| Error::Persist(e.to_string()))?;

        let loaded = Wallet::load()
            .descriptor(KeychainKind::External, Some(descriptor.clone()))
            .extract_keys()
            .check_network(net)
            .load_wallet(&mut db)
            .map_err(|e| Error::Persist(e.to_string()))?;

        let wallet = match loaded {
            Some(w) => w,
            None => Wallet::create_single(descriptor)
                .network(net)
                .create_wallet(&mut db)
                .map_err(|e| Error::Descriptor(e.to_string()))?,
        };

        Ok(Self {
            inner: Mutex::new(Inner { wallet, db }),
            backend,
            network: config.network,
            address_type: config.address_type,
            id,
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| Error::Persist("wallet mutex poisoned".into()))
    }

    fn persist(inner: &mut Inner) -> Result<()> {
        inner
            .wallet
            .persist(&mut inner.db)
            .map(|_| ())
            .map_err(|e| Error::Persist(e.to_string()))
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
    pub fn address(&self) -> Result<String> {
        let inner = self.lock()?;
        let info = inner.wallet.peek_address(KeychainKind::External, 0);
        Ok(match self.address_type {
            AddressType::P2pk => {
                crate::keys::pubkey_from_p2pk_script(&info.address.script_pubkey())
                    .unwrap_or_else(|| info.address.to_string())
            }
            _ => info.address.to_string(),
        })
    }

    /// Pull chain state from the backend and persist it.
    pub async fn sync(&self) -> Result<()> {
        enum Req {
            Full(bdk_wallet::chain::spk_client::FullScanRequest<KeychainKind>),
            Partial(bdk_wallet::chain::spk_client::SyncRequest<(KeychainKind, u32)>),
        }
        let req = {
            let inner = self.lock()?;
            let has_history = inner.wallet.transactions().next().is_some();
            if has_history {
                Req::Partial(inner.wallet.start_sync_with_revealed_spks().build())
            } else {
                Req::Full(inner.wallet.start_full_scan().build())
            }
        };
        let update: bdk_wallet::Update = match req {
            Req::Full(r) => self.backend.full_scan(r).await?.into(),
            Req::Partial(r) => self.backend.sync(r).await?.into(),
        };
        let mut inner = self.lock()?;
        inner
            .wallet
            .apply_update(update)
            .map_err(|e| Error::Backend(e.to_string()))?;
        Self::persist(&mut inner)
    }

    pub fn balance(&self) -> Result<Balance> {
        let b = self.lock()?.wallet.balance();
        Ok(Balance {
            confirmed: b.confirmed.to_sat(),
            trusted_pending: b.trusted_pending.to_sat(),
            untrusted_pending: b.untrusted_pending.to_sat(),
            immature: b.immature.to_sat(),
        })
    }

    pub fn list_utxos(&self) -> Result<Vec<Utxo>> {
        let inner = self.lock()?;
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
        Ok(utxos)
    }

    pub async fn estimate_fee(&self) -> Result<FeeEstimate> {
        self.backend.fee_estimates().await
    }

    pub async fn chain_height(&self) -> Result<u32> {
        self.backend.height().await
    }

    /// Build an unsigned transfer; change returns to the wallet address.
    pub fn build_transfer(
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

        let mut inner = self.lock()?;
        let psbt = {
            let mut builder = inner.wallet.build_tx();
            builder
                .set_recipients(outputs)
                .fee_rate(fee_rate_from_sat_vb(fee_rate_sat_vb));
            builder
                .finish()
                .map_err(|e| Error::BuildTx(e.to_string()))?
        };
        Self::persist(&mut inner)?;

        let fee_sat = psbt.fee().map_err(|e| Error::Psbt(e.to_string()))?.to_sat();
        let tx = &psbt.unsigned_tx;
        let change_sat = tx
            .output
            .iter()
            .filter(|o| inner.wallet.is_mine(o.script_pubkey.clone()))
            .map(|o| o.value.to_sat())
            .sum();
        let total_out_sat = recipients.iter().map(|r| r.amount_sat).sum();
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
    pub fn sign(&self, psbt_base64: &str) -> Result<String> {
        let mut psbt = Psbt::from_str(psbt_base64).map_err(|e| Error::Psbt(e.to_string()))?;
        let inner = self.lock()?;
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
    pub async fn broadcast(&self, signed_psbt_base64: &str) -> Result<String> {
        let tx = Self::extract_tx(signed_psbt_base64)?;
        let txid = self.backend.broadcast(&tx).await?;
        let mut inner = self.lock()?;
        inner.wallet.apply_unconfirmed_txs([(tx, now_secs())]);
        Self::persist(&mut inner)?;
        Ok(txid.to_string())
    }

    /// One-shot transfer with Go `BroadcastTx` semantics:
    /// fee = max(1 sat/vB, backend estimate for 6 blocks) unless overridden.
    pub async fn send(
        &self,
        recipients: &[Recipient],
        fee_rate_sat_vb: Option<f64>,
    ) -> Result<String> {
        let rate = match fee_rate_sat_vb {
            Some(r) => r,
            None => self
                .estimate_fee()
                .await?
                .for_target(DEFAULT_FEE_TARGET)
                .unwrap_or(MIN_FEE_RATE_SAT_VB),
        };
        let built = self.build_transfer(recipients, rate)?;
        let signed = self.sign(&built.psbt_base64)?;
        self.broadcast(&signed).await
    }
}

#[cfg(test)]
mod tests {
    use bdk_wallet::bitcoin::{
        OutPoint, ScriptBuf, Sequence, TxIn, TxOut, Witness, absolute, transaction,
    };

    use super::*;
    use crate::backend::mock::MockBackend;

    const SK_HEX: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    fn open(address_type: AddressType) -> (WalletHandle, std::sync::Arc<MockBackend>) {
        let mock = std::sync::Arc::new(MockBackend::with_fee(6, 2.0));
        let cfg = WalletConfig {
            network: Network::Regtest,
            address_type,
            backend: BackendConfig::Esplora {
                url: "unused".into(),
            },
            db_path: None,
        };
        let handle = WalletHandle::open_with_backend(
            cfg,
            &KeyMaterial::PrivHex(SK_HEX.into()),
            Box::new(ArcBackend(mock.clone())),
        )
        .unwrap();
        (handle, mock)
    }

    struct ArcBackend(std::sync::Arc<MockBackend>);
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

    fn fund(handle: &WalletHandle, sats: u64) {
        let mut inner = handle.inner.lock().unwrap();
        let spk = inner
            .wallet
            .peek_address(KeychainKind::External, 0)
            .address
            .script_pubkey();
        let tx = Transaction {
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
        };
        inner.wallet.apply_unconfirmed_txs([(tx, 1)]);
    }

    #[tokio::test]
    async fn build_sign_broadcast_each_type() {
        for t in [
            AddressType::P2pkh,
            AddressType::P2wpkh,
            AddressType::NestedP2wpkh,
            AddressType::P2tr,
        ] {
            let (handle, mock) = open(t);
            assert_eq!(handle.balance().unwrap().total(), 0);
            fund(&handle, 100_000);
            assert_eq!(handle.balance().unwrap().total(), 100_000);
            assert_eq!(handle.list_utxos().unwrap().len(), 1);
            assert_eq!(
                handle.list_utxos().unwrap()[0].address,
                handle.address().unwrap()
            );

            let dest = crate::keys::generate_key(Network::Regtest, AddressType::P2wpkh)
                .unwrap()
                .address
                .clone();
            let built = handle
                .build_transfer(
                    &[Recipient {
                        address: dest.clone(),
                        amount_sat: 40_000,
                    }],
                    2.0,
                )
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
                .unwrap_or_else(|e| panic!("{t:?}: {e}"));
            let txid = handle.broadcast(&signed).await.unwrap();
            assert_eq!(mock.broadcasts.lock().unwrap().len(), 1);
            assert_eq!(
                mock.broadcasts.lock().unwrap()[0]
                    .compute_txid()
                    .to_string(),
                txid
            );
            // Change is now an unconfirmed UTXO of ours.
            assert_eq!(handle.balance().unwrap().total(), built.change_sat);
        }
    }

    #[tokio::test]
    async fn send_uses_estimate_and_floor() {
        let (handle, mock) = open(AddressType::P2wpkh);
        fund(&handle, 50_000);
        let dest = crate::keys::generate_key(Network::Regtest, AddressType::P2tr)
            .unwrap()
            .address
            .clone();
        handle
            .send(
                &[Recipient {
                    address: dest,
                    amount_sat: 10_000,
                }],
                None,
            )
            .await
            .unwrap();
        assert_eq!(mock.broadcasts.lock().unwrap().len(), 1);
    }

    #[test]
    fn build_rejects_bad_input() {
        let (handle, _) = open(AddressType::P2wpkh);
        fund(&handle, 50_000);
        assert!(matches!(
            handle.build_transfer(&[], 1.0),
            Err(Error::BuildTx(_))
        ));
        let mainnet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4".to_string();
        assert!(matches!(
            handle.build_transfer(
                &[Recipient {
                    address: mainnet,
                    amount_sat: 1
                }],
                1.0
            ),
            Err(Error::InvalidAddress(_))
        ));
        let dest = crate::keys::generate_key(Network::Regtest, AddressType::P2wpkh)
            .unwrap()
            .address
            .clone();
        assert!(matches!(
            handle.build_transfer(
                &[Recipient {
                    address: dest,
                    amount_sat: 1_000_000
                }],
                1.0
            ),
            Err(Error::BuildTx(_))
        ));
    }

    #[test]
    fn fee_rate_conversion_rounds_up() {
        assert_eq!(fee_rate_from_sat_vb(1.0).to_sat_per_kwu(), 250);
        assert_eq!(fee_rate_from_sat_vb(0.1).to_sat_per_kwu(), 250);
        assert_eq!(fee_rate_from_sat_vb(2.5).to_sat_per_kwu(), 625);
    }

    #[test]
    fn persists_and_reloads() {
        let dir = std::env::temp_dir().join(format!("wallet-core-test-{}", std::process::id()));
        let path = dir.join("w.sqlite");
        let cfg = WalletConfig {
            network: Network::Signet,
            address_type: AddressType::P2wpkh,
            backend: BackendConfig::Esplora {
                url: "unused".into(),
            },
            db_path: Some(path.clone()),
        };
        let key = KeyMaterial::PrivHex(SK_HEX.into());
        let a =
            WalletHandle::open_with_backend(cfg.clone(), &key, Box::new(MockBackend::default()))
                .unwrap();
        fund(&a, 1234);
        WalletHandle::persist(&mut a.inner.lock().unwrap()).unwrap();
        drop(a);
        let b =
            WalletHandle::open_with_backend(cfg, &key, Box::new(MockBackend::default())).unwrap();
        assert_eq!(b.balance().unwrap().total(), 1234);
        let _ = std::fs::remove_dir_all(dir);
    }
}
