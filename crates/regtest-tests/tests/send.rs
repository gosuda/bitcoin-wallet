//! End-to-end wallet flow against a real node.
//!
//! `bdk_testenv` starts `bitcoind` plus an `electrs` serving the Esplora HTTP
//! API, so the wallet talks to the same kind of backend it uses in production.
//! This is the funded-send path that public faucets make hard to exercise:
//! receive real coins, spend them, and read the result back out of the chain.

use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bdk_testenv::TestEnv;
use wallet_core::bdk_wallet::ChangeSet;
use wallet_core::bdk_wallet::chain::Merge;
use wallet_core::bitcoin::{Address, Amount};
use wallet_core::persist::{Persister, changeset_from_json, changeset_to_json};
use wallet_core::{
    AddressType, BackendConfig, KeyMaterial, MemoryPersister, Network, Recipient, WalletConfig,
    WalletHandle,
};

const TIMEOUT: Duration = Duration::from_secs(60);
const FUNDING_SAT: u64 = 200_000;
const SEND_SAT: u64 = 40_000;

fn config(url: String) -> WalletConfig {
    WalletConfig {
        network: Network::Regtest,
        address_type: AddressType::P2wpkh,
        backend: BackendConfig::Esplora { url },
    }
}

fn regtest_address(addr: &str) -> Address {
    Address::from_str(addr)
        .expect("wallet address parses")
        .require_network(wallet_core::bitcoin::Network::Regtest)
        .expect("wallet address is regtest")
}

#[tokio::test]
async fn receive_then_spend_against_a_real_node() -> anyhow::Result<()> {
    let env = TestEnv::new()?;
    let esplora_url = format!(
        "http://{}",
        env.electrsd
            .esplora_url
            .clone()
            .expect("electrs was started with the esplora http api")
    );

    // Coinbase maturity, so bitcoind has something spendable to send us.
    env.mine_blocks(101, None)?;

    let key = wallet_core::generate_key(Network::Regtest, AddressType::P2wpkh)?;
    let wallet = WalletHandle::open(
        config(esplora_url.clone()),
        &KeyMaterial::PrivHex(key.priv_hex.clone()),
        Box::new(MemoryPersister::new()),
    )
    .await?;

    // --- receive
    let funding_txid = env.send(
        &regtest_address(&wallet.address().await),
        Amount::from_sat(FUNDING_SAT),
    )?;
    env.wait_until_electrum_sees_txid(funding_txid, TIMEOUT)?;
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;

    wallet.sync().await?;
    let balance = wallet.balance().await;
    assert_eq!(balance.confirmed, FUNDING_SAT, "funding must be confirmed");
    assert_eq!(wallet.list_utxos().await.len(), 1);

    let history = wallet.list_transactions().await;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].txid, funding_txid.to_string());
    assert_eq!(
        history[0].net_sat, FUNDING_SAT as i64,
        "incoming is positive"
    );
    assert!(!history[0].is_outgoing());
    assert!(history[0].confirmations.unwrap_or(0) >= 1);

    // --- spend
    let destination = wallet_core::generate_key(Network::Regtest, AddressType::P2tr)?;
    let built = wallet
        .build_transfer(
            &[Recipient {
                address: destination.address.clone(),
                amount_sat: SEND_SAT,
            }],
            2.0,
        )
        .await?;
    assert_eq!(built.total_out_sat, SEND_SAT);
    assert_eq!(built.change_sat, FUNDING_SAT - SEND_SAT - built.fee_sat);

    let signed = wallet.sign(&built.psbt_base64).await?;
    let broadcast = wallet.broadcast(&signed).await?;
    assert_eq!(broadcast.persist_error, None, "local state must persist");

    let spend_txid = wallet_core::bitcoin::Txid::from_str(&broadcast.txid)?;
    env.wait_until_electrum_sees_txid(spend_txid, TIMEOUT)?;
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;

    // --- read it back from the chain
    wallet.sync().await?;
    let balance = wallet.balance().await;
    assert_eq!(
        balance.confirmed,
        FUNDING_SAT - SEND_SAT - built.fee_sat,
        "spent amount and fee left the wallet"
    );

    let history = wallet.list_transactions().await;
    assert_eq!(history.len(), 2, "funding and spend");
    let spend = history
        .iter()
        .find(|t| t.txid == broadcast.txid)
        .expect("spend is in history");
    assert!(spend.is_outgoing());
    assert_eq!(spend.net_sat, -((SEND_SAT + built.fee_sat) as i64));
    assert_eq!(spend.fee_sat, Some(built.fee_sat));
    assert!(spend.confirmations.unwrap_or(0) >= 1, "spend confirmed");
    assert_eq!(history[0].txid, broadcast.txid, "newest first");

    Ok(())
}

/// One JSON record per wallet, shared between opens — the same shape the
/// browser build keeps in IndexedDB.
#[derive(Clone, Default)]
struct Store(Arc<Mutex<Option<String>>>);

struct JsonPersister {
    store: Store,
    full: ChangeSet,
}

impl JsonPersister {
    fn new(store: Store) -> Self {
        Self {
            store,
            full: ChangeSet::default(),
        }
    }
}

#[async_trait::async_trait]
impl Persister for JsonPersister {
    async fn initialize(&mut self) -> wallet_core::Result<ChangeSet> {
        let json = self.store.0.lock().expect("store lock").clone();
        self.full = changeset_from_json(json.as_deref())?;
        Ok(self.full.clone())
    }

    async fn persist(&mut self, delta: &ChangeSet) -> wallet_core::Result<()> {
        self.full.merge(delta.clone());
        *self.store.0.lock().expect("store lock") = Some(changeset_to_json(&self.full)?);
        Ok(())
    }
}

/// A wallet reopened from persisted state keeps its history and balance
/// without touching the network — the path the browser build relies on.
#[tokio::test]
async fn state_survives_reopen_from_persister() -> anyhow::Result<()> {
    let env = TestEnv::new()?;
    let esplora_url = format!(
        "http://{}",
        env.electrsd
            .esplora_url
            .clone()
            .expect("electrs was started with the esplora http api")
    );
    env.mine_blocks(101, None)?;

    let key = wallet_core::generate_key(Network::Regtest, AddressType::P2wpkh)?;
    let material = KeyMaterial::PrivHex(key.priv_hex.clone());
    let store = Store::default();

    {
        let wallet = WalletHandle::open(
            config(esplora_url.clone()),
            &material,
            Box::new(JsonPersister::new(store.clone())),
        )
        .await?;
        let txid = env.send(
            &regtest_address(&wallet.address().await),
            Amount::from_sat(FUNDING_SAT),
        )?;
        env.wait_until_electrum_sees_txid(txid, TIMEOUT)?;
        env.mine_blocks(1, None)?;
        env.wait_until_electrum_sees_block(TIMEOUT)?;
        wallet.sync().await?;
        assert_eq!(wallet.balance().await.confirmed, FUNDING_SAT);
    }
    assert!(
        store.0.lock().expect("store lock").is_some(),
        "state was written"
    );

    // Reopen against the same record, with no sync at all.
    let reopened = WalletHandle::open(
        config(esplora_url),
        &material,
        Box::new(JsonPersister::new(store)),
    )
    .await?;
    assert_eq!(reopened.balance().await.confirmed, FUNDING_SAT);
    assert_eq!(reopened.list_transactions().await.len(), 1);

    Ok(())
}
