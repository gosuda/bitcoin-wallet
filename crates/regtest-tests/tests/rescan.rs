//! A restored wallet that used more addresses than the default gap.
//!
//! `sync()` full-scans a wallet with no history and stops after twenty unused
//! addresses in a row. Funds parked further out are invisible to it, and — the
//! part that made this a real bug — stayed invisible, because once anything
//! was known the wallet only ever re-checked what it had already revealed.
//! `rescan` is the way out; this proves it against a real node.

use std::time::Duration;

use bdk_testenv::TestEnv;
mod common;
use common::derived_address;
use wallet_core::bdk_wallet::KeychainKind;
use wallet_core::bitcoin::{Address, Amount};
use wallet_core::{
    AddressType, BackendConfig, KeyMaterial, MemoryPersister, Network, WalletConfig, WalletHandle,
};

const TIMEOUT: Duration = Duration::from_secs(60);
/// Well past the default gap of 20, comfortably inside a rescan of 100.
const FAR_INDEX: u32 = 30;
const FAR_SAT: u64 = 150_000;

#[tokio::test]
async fn rescan_finds_funds_beyond_the_default_gap() -> anyhow::Result<()> {
    let env = TestEnv::new()?;
    let esplora_url = format!(
        "http://{}",
        env.electrsd
            .esplora_url
            .clone()
            .expect("electrs was started with the esplora http api")
    );
    env.mine_blocks(101, None)?;

    let seed = wallet_core::generate_mnemonic(Network::Regtest, AddressType::P2wpkh, 12)?;
    let far = derived_address(&seed.words, None, KeychainKind::External, FAR_INDEX);
    let far_address =
        Address::from_str(&far)?.require_network(wallet_core::bitcoin::Network::Regtest)?;

    // Money arrives at an address this wallet has never handed out — the
    // shape of a restore from words that were used elsewhere.
    let txid = env.send(&far_address, Amount::from_sat(FAR_SAT))?;
    env.wait_until_electrum_sees_txid(txid, TIMEOUT)?;
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;

    let wallet = WalletHandle::open(
        WalletConfig {
            network: Network::Regtest,
            address_type: AddressType::P2wpkh,
            backend: BackendConfig::Esplora { url: esplora_url },
        },
        &KeyMaterial::Mnemonic {
            words: seed.words.clone(),
            passphrase: None,
        },
        Box::new(MemoryPersister::new()),
    )
    .await?;

    wallet.sync().await?;
    assert_eq!(
        wallet.balance().await.confirmed,
        0,
        "the default gap stops short of index {FAR_INDEX}; this is the bug a rescan exists for"
    );

    wallet.rescan(100).await?;
    assert_eq!(
        wallet.balance().await.confirmed,
        FAR_SAT,
        "a wider gap finds it"
    );
    let utxos = wallet.list_utxos().await;
    assert_eq!(utxos.len(), 1);
    assert_eq!(utxos[0].address, far);

    // And it sticks: a plain sync afterwards keeps what the rescan found.
    wallet.sync().await?;
    assert_eq!(wallet.balance().await.confirmed, FAR_SAT);

    Ok(())
}

use std::str::FromStr;
