//! The flows the app ships beyond a plain send, against a real node:
//! a two-recipient send and the detail view of it, a drain, and a
//! watch-only copy of a wallet. `send.rs` covers the plain send, fee bump and
//! reopen; `hd.rs` the account layout and a passphrase's separate wallet.

// Only ever compiled as a test. Saying so lets clippy's test exemption
// reach the helpers here, not just the #[test] functions.
#![cfg(test)]

use std::str::FromStr;
use std::time::Duration;

use bdk_testenv::TestEnv;
use wallet_core::bitcoin::{Address, Amount, Txid};
use wallet_core::{
    AddressType, BackendConfig, BuiltTx, KeyMaterial, MemoryPersister, Network, Recipient,
    WalletConfig, WalletHandle,
};

const TIMEOUT: Duration = Duration::from_secs(60);
const FUNDING_SAT: u64 = 200_000;

fn config(url: &str) -> WalletConfig {
    WalletConfig {
        network: Network::Regtest,
        address_type: AddressType::P2wpkh,
        backend: BackendConfig::Esplora { url: url.into() },
    }
}

fn regtest_address(addr: &str) -> Address {
    Address::from_str(addr)
        .expect("wallet address parses")
        .require_network(wallet_core::bitcoin::Network::Regtest)
        .expect("wallet address is regtest")
}

/// `bitcoind` plus an Esplora-serving `electrs`, with coinbase maturity mined
/// so the node has coins to pay us. Returns the Esplora URL beside it.
fn start() -> anyhow::Result<(TestEnv, String)> {
    let env = TestEnv::new()?;
    let url = format!(
        "http://{}",
        env.electrsd
            .esplora_url
            .clone()
            .expect("electrs was started with the esplora http api")
    );
    env.mine_blocks(101, None)?;
    Ok((env, url))
}

/// Pay `sat` from the node to `address` and wait until the index has it.
fn fund(env: &TestEnv, address: &str, sat: u64) -> anyhow::Result<()> {
    let txid = env.send(&regtest_address(address), Amount::from_sat(sat))?;
    env.wait_until_electrum_sees_txid(txid, TIMEOUT)?;
    Ok(())
}

/// Mine one block and wait until the index has it.
fn confirm(env: &TestEnv) -> anyhow::Result<()> {
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;
    Ok(())
}

async fn open(url: &str, key: &KeyMaterial) -> anyhow::Result<WalletHandle> {
    Ok(WalletHandle::open(config(url), key, Box::new(MemoryPersister::new())).await?)
}

/// A new HD wallet, as the app's "New wallet" makes one.
async fn new_hd_wallet(url: &str) -> anyhow::Result<WalletHandle> {
    let seed = wallet_core::generate_mnemonic(Network::Regtest, AddressType::P2wpkh, 12)?;
    let key = KeyMaterial::Mnemonic {
        words: seed.words.clone(),
        passphrase: None,
    };
    open(url, &key).await
}

/// A wallet of its own for a recipient, so an assertion reads what arrived
/// rather than what the sender believes it sent.
async fn recipient(url: &str, address_type: AddressType) -> anyhow::Result<WalletHandle> {
    let key = wallet_core::generate_key(Network::Regtest, address_type)?;
    let wallet = WalletHandle::open(
        WalletConfig {
            address_type,
            ..config(url)
        },
        &KeyMaterial::PrivHex(key.priv_hex.clone()),
        Box::new(MemoryPersister::new()),
    )
    .await?;
    Ok(wallet)
}

/// Sign and broadcast `built`, and wait until the index has it.
async fn send(env: &TestEnv, wallet: &WalletHandle, built: &BuiltTx) -> anyhow::Result<String> {
    let signed = wallet.sign(&built.psbt_base64).await?;
    let sent = wallet.broadcast(&signed).await?;
    assert_eq!(sent.persist_error, None, "local state must persist");
    env.wait_until_electrum_sees_txid(Txid::from_str(&sent.txid)?, TIMEOUT)?;
    Ok(sent.txid)
}

/// Two recipients in one transaction each receive exactly their amount, and
/// the detail view of it reads the fee, the confirmation and who owns what.
#[tokio::test]
async fn a_two_recipient_send_confirms_and_its_detail_reads_back() -> anyhow::Result<()> {
    const TO_FIRST_SAT: u64 = 30_000;
    const TO_SECOND_SAT: u64 = 45_000;
    let (env, url) = start()?;
    let wallet = new_hd_wallet(&url).await?;
    fund(&env, &wallet.address().await, FUNDING_SAT)?;
    confirm(&env)?;
    wallet.sync().await?;

    let first = recipient(&url, AddressType::P2wpkh).await?;
    let second = recipient(&url, AddressType::P2tr).await?;
    let (first_address, second_address) = (first.address().await, second.address().await);
    let built = wallet
        .build_transfer(
            &[
                Recipient {
                    address: first_address.clone(),
                    amount_sat: TO_FIRST_SAT,
                },
                Recipient {
                    address: second_address.clone(),
                    amount_sat: TO_SECOND_SAT,
                },
            ],
            2.0,
        )
        .await?;
    assert_eq!(built.total_out_sat, TO_FIRST_SAT + TO_SECOND_SAT);
    assert_eq!(
        built.change_sat,
        FUNDING_SAT - TO_FIRST_SAT - TO_SECOND_SAT - built.fee_sat
    );
    let txid = send(&env, &wallet, &built).await?;
    confirm(&env)?;

    // --- what arrived, read from each recipient's own wallet
    first.sync().await?;
    second.sync().await?;
    assert_eq!(first.balance().await.confirmed, TO_FIRST_SAT);
    assert_eq!(second.balance().await.confirmed, TO_SECOND_SAT);

    // --- the sender's detail view of the same transaction
    wallet.sync().await?;
    let detail = wallet
        .transaction(&txid)
        .await?
        .expect("the send is in the wallet's history");
    assert_eq!(
        detail.fee_sat,
        Some(built.fee_sat),
        "the reviewed fee is paid"
    );
    assert_eq!(detail.confirmations, Some(1), "one block on top");
    assert!(detail.block_height.is_some());
    assert_eq!(
        detail.net_sat,
        -((TO_FIRST_SAT + TO_SECOND_SAT + built.fee_sat) as i64)
    );
    assert!(
        detail
            .inputs
            .iter()
            .all(|i| i.ours && i.value_sat == Some(FUNDING_SAT)),
        "{:?}",
        detail.inputs
    );
    let paid = |address: &str| {
        detail
            .outputs
            .iter()
            .find(|o| o.address.as_deref() == Some(address))
            .map(|o| (o.value_sat, o.ours))
    };
    assert_eq!(paid(&first_address), Some((TO_FIRST_SAT, false)));
    assert_eq!(paid(&second_address), Some((TO_SECOND_SAT, false)));
    let ours: Vec<_> = detail.outputs.iter().filter(|o| o.ours).collect();
    assert_eq!(ours.len(), 1, "exactly one output is change");
    assert_eq!(ours[0].value_sat, built.change_sat);
    assert_eq!(detail.outputs.len(), 3);

    Ok(())
}

/// Max: every coin leaves in one output, and the recipient receives exactly
/// the amount the review screen showed — no change comes back.
#[tokio::test]
async fn a_drain_arrives_whole_with_no_change() -> anyhow::Result<()> {
    const SECOND_FUNDING_SAT: u64 = 75_000;
    let (env, url) = start()?;
    let wallet = new_hd_wallet(&url).await?;
    fund(&env, &wallet.address().await, FUNDING_SAT)?;
    fund(&env, &wallet.new_address().await?, SECOND_FUNDING_SAT)?;
    confirm(&env)?;
    wallet.sync().await?;
    assert_eq!(wallet.list_utxos().await.len(), 2);

    let destination = recipient(&url, AddressType::P2wpkh).await?;
    let built = wallet
        .build_drain(&destination.address().await, 2.0)
        .await?;
    assert_eq!(built.input_count, 2, "a drain spends every coin");
    assert_eq!(built.change_sat, 0);
    assert_eq!(
        built.total_out_sat,
        FUNDING_SAT + SECOND_FUNDING_SAT - built.fee_sat
    );
    let txid = send(&env, &wallet, &built).await?;
    confirm(&env)?;

    destination.sync().await?;
    assert_eq!(
        destination.balance().await.confirmed,
        built.total_out_sat,
        "exactly the reviewed amount arrived"
    );

    wallet.sync().await?;
    assert_eq!(wallet.balance().await.confirmed, 0);
    assert!(wallet.list_utxos().await.is_empty());
    let detail = wallet
        .transaction(&txid)
        .await?
        .expect("the drain is in the wallet's history");
    assert_eq!(detail.outputs.len(), 1, "no change output");
    assert!(!detail.outputs[0].ours);
    assert_eq!(detail.fee_sat, Some(built.fee_sat));

    Ok(())
}

/// Following a wallet by its public descriptor sees what the wallet itself
/// sees — change included — and cannot sign.
#[tokio::test]
async fn a_watch_only_copy_mirrors_the_full_wallet() -> anyhow::Result<()> {
    const SEND_SAT: u64 = 40_000;
    let (env, url) = start()?;
    let wallet = new_hd_wallet(&url).await?;
    fund(&env, &wallet.address().await, FUNDING_SAT)?;
    confirm(&env)?;
    wallet.sync().await?;

    // A spend with change, so the copy has the internal keychain to find too.
    let elsewhere = wallet_core::generate_key(Network::Regtest, AddressType::P2wpkh)?;
    let built = wallet
        .build_transfer(
            &[Recipient {
                address: elsewhere.address.clone(),
                amount_sat: SEND_SAT,
            }],
            2.0,
        )
        .await?;
    assert!(built.change_sat > 0);
    send(&env, &wallet, &built).await?;
    confirm(&env)?;
    wallet.sync().await?;

    // The descriptor the Public keys card shows, pasted into "Follow".
    let descriptor = wallet.public_descriptors().await.external;
    let key = KeyMaterial::parse(&descriptor);
    assert!(key.is_watch_only(), "{descriptor}");
    let watcher = open(&url, &key).await?;
    assert!(watcher.is_watch_only());
    watcher.sync().await?;

    assert_eq!(watcher.balance().await, wallet.balance().await);
    assert_eq!(watcher.list_utxos().await, wallet.list_utxos().await);
    let txids = |history: Vec<wallet_core::TxSummary>| {
        history.into_iter().map(|t| t.txid).collect::<Vec<_>>()
    };
    assert_eq!(
        txids(watcher.list_transactions().await),
        txids(wallet.list_transactions().await)
    );
    assert_eq!(watcher.address().await, wallet.address().await);

    // It can build a payment, but signing one is refused.
    let unsigned = watcher
        .build_transfer(
            &[Recipient {
                address: elsewhere.address.clone(),
                amount_sat: SEND_SAT,
            }],
            2.0,
        )
        .await?;
    let refused = watcher.sign(&unsigned.psbt_base64).await.unwrap_err();
    assert_eq!(refused.code(), "unsupported");

    Ok(())
}
