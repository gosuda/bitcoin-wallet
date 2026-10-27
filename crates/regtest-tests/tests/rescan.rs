//! A restored wallet that used more addresses than the default gap.
//!
//! `sync()` full-scans a wallet with no history and stops after twenty unused
//! addresses in a row; after that it re-checks only what it has revealed, so
//! funds parked further out stay unseen. `rescan` finds them, here against a
//! real node.

#![cfg(test)]

mod common;
use common::{confirm, derived_address, fund, open, start};
use wallet_core::bdk_wallet::KeychainKind;
use wallet_core::{AddressType, KeyMaterial, Network};

/// Well past the default gap of 20, comfortably inside a rescan of 100.
const FAR_INDEX: u32 = 30;
const FAR_SAT: u64 = 150_000;

#[tokio::test]
async fn rescan_finds_funds_beyond_the_default_gap() -> anyhow::Result<()> {
    let (env, esplora_url) = start()?;

    let seed = wallet_core::generate_mnemonic(Network::Regtest, AddressType::P2wpkh, 12)?;
    let far = derived_address(&seed.words, None, KeychainKind::External, FAR_INDEX);

    // Money arrives at an address this wallet has never handed out — the
    // shape of a restore from words that were used elsewhere.
    fund(&env, &far, FAR_SAT)?;
    confirm(&env)?;

    let wallet = open(&esplora_url, &KeyMaterial::parse(&seed.words)).await?;

    wallet.sync().await?;
    assert_eq!(
        wallet.balance().await.confirmed,
        0,
        "a sync's default gap stops short of index {FAR_INDEX}"
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
