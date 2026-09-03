//! End-to-end HD (BIP39/BIP32) wallet flow against a real node.
//!
//! The single-key path is covered by `send.rs`. What is different here is the
//! account: receive addresses come one after another off the external keychain,
//! and change goes to a *separate* internal keychain instead of back to the
//! address that was just paid. This walks that through `bitcoind` + `electrs`:
//! fund two different receive addresses, spend, and check where the change
//! landed.

use std::str::FromStr;
use std::time::Duration;

use bdk_testenv::TestEnv;
use wallet_core::bdk_wallet::keys::bip39::{Language, Mnemonic};
use wallet_core::bdk_wallet::template::Bip84;
use wallet_core::bdk_wallet::{KeychainKind, Wallet as BdkWallet};
use wallet_core::bitcoin::{Address, Amount};
use wallet_core::{
    AddressType, BackendConfig, KeyMaterial, MemoryPersister, Network, Recipient, WalletConfig,
    WalletHandle,
};

const TIMEOUT: Duration = Duration::from_secs(60);
const FIRST_SAT: u64 = 200_000;
const SECOND_SAT: u64 = 120_000;
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

/// Derive an address straight from the seed with BDK's BIP84 template, so the
/// assertions below do not just re-read what the wallet under test believes.
fn derived(words: &str, keychain: KeychainKind, index: u32) -> String {
    let mnemonic = Mnemonic::parse_in(Language::English, words).expect("generated mnemonic parses");
    let reference = BdkWallet::create(
        Bip84((mnemonic.clone(), None), KeychainKind::External),
        Bip84((mnemonic, None), KeychainKind::Internal),
    )
    .network(wallet_core::bitcoin::Network::Regtest)
    .create_wallet_no_persist()
    .expect("reference wallet builds");
    reference.peek_address(keychain, index).address.to_string()
}

#[tokio::test]
async fn hd_wallet_receives_on_fresh_addresses_and_changes_internally() -> anyhow::Result<()> {
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

    let seed = wallet_core::generate_mnemonic(Network::Regtest, AddressType::P2wpkh, 12)?;
    let words = seed.words.clone();
    let wallet = WalletHandle::open(
        config(esplora_url.clone()),
        &KeyMaterial::Mnemonic {
            words: words.clone(),
            passphrase: None,
        },
        Box::new(MemoryPersister::new()),
    )
    .await?;
    assert!(wallet.is_hd(), "a mnemonic opens an HD wallet");

    // --- receive on the first address
    let first = wallet.address().await;
    assert_eq!(first, seed.address, "generate and open agree on address 0");
    assert_eq!(first, derived(&words, KeychainKind::External, 0));
    assert_eq!(
        wallet.address().await,
        first,
        "an unused address is handed out again"
    );

    let first_txid = env.send(&regtest_address(&first), Amount::from_sat(FIRST_SAT))?;
    env.wait_until_electrum_sees_txid(first_txid, TIMEOUT)?;
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;

    wallet.sync().await?;
    assert_eq!(wallet.balance().await.confirmed, FIRST_SAT);
    assert_eq!(wallet.list_utxos().await.len(), 1);

    // --- receive on a second, freshly revealed address
    let second = wallet.new_address().await?;
    assert_ne!(second, first, "new_address must not hand back the old one");
    assert_eq!(second, derived(&words, KeychainKind::External, 1));

    let second_txid = env.send(&regtest_address(&second), Amount::from_sat(SECOND_SAT))?;
    env.wait_until_electrum_sees_txid(second_txid, TIMEOUT)?;
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;

    wallet.sync().await?;
    let funded = FIRST_SAT + SECOND_SAT;
    assert_eq!(
        wallet.balance().await.confirmed,
        funded,
        "both receive addresses are tracked by one wallet"
    );
    let utxos = wallet.list_utxos().await;
    assert_eq!(utxos.len(), 2, "one utxo per funded address");
    let mut funded_addresses: Vec<String> = utxos.iter().map(|u| u.address.clone()).collect();
    funded_addresses.sort();
    let mut expected = vec![first.clone(), second.clone()];
    expected.sort();
    assert_eq!(funded_addresses, expected);

    // --- spend: the change must not come back to a receive address
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
    assert!(built.change_sat > 0, "the spend must produce change");

    let signed = wallet.sign(&built.psbt_base64).await?;
    let broadcast = wallet.broadcast(&signed).await?;
    assert_eq!(broadcast.persist_error, None, "local state must persist");

    env.wait_until_electrum_sees_txid(
        wallet_core::bitcoin::Txid::from_str(&broadcast.txid)?,
        TIMEOUT,
    )?;
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;
    wallet.sync().await?;

    assert_eq!(
        wallet.balance().await.confirmed,
        funded - SEND_SAT - built.fee_sat,
        "only the payment and its fee left the wallet"
    );
    // Whatever coin selection picked, the outputs we still own are the
    // untouched receive utxos plus exactly one change output — and that change
    // output is on neither receive address.
    let after = wallet.list_utxos().await;
    assert_eq!(
        after.len() as u32,
        3 - built.input_count,
        "spent inputs are gone, one change output arrived"
    );
    let receiving = [first.clone(), second.clone()];
    let change: Vec<_> = after
        .iter()
        .filter(|u| !receiving.contains(&u.address))
        .collect();
    assert_eq!(
        change.len(),
        1,
        "exactly one output is not a receive address"
    );
    assert_eq!(change[0].value, built.change_sat);
    assert_eq!(
        change[0].address,
        derived(&words, KeychainKind::Internal, 0),
        "change goes to the internal keychain — the point of the change branch"
    );

    Ok(())
}
