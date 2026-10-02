//! Shared by the end-to-end tests; each one declares `mod common;`.
//!
//! Every test file is a crate of its own and uses only some of what is here,
//! so the rest would be dead code in it.
#![allow(dead_code)]

use std::str::FromStr;
use std::time::Duration;

use bdk_testenv::TestEnv;
use wallet_core::bdk_wallet::keys::bip39::{Language, Mnemonic};
use wallet_core::bdk_wallet::template::Bip84;
use wallet_core::bdk_wallet::{KeychainKind, Wallet as BdkWallet};
use wallet_core::bitcoin::{Address, Amount, Txid};
use wallet_core::{
    AddressType, BackendConfig, BuiltTx, KeyMaterial, MemoryPersister, Network, Recipient,
    WalletConfig, WalletHandle,
};

pub const TIMEOUT: Duration = Duration::from_secs(60);

pub fn config(url: &str) -> WalletConfig {
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
pub fn start() -> anyhow::Result<(TestEnv, String)> {
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
/// Returns the payment's txid.
pub fn fund(env: &TestEnv, address: &str, sat: u64) -> anyhow::Result<Txid> {
    let txid = env.send(&regtest_address(address), Amount::from_sat(sat))?;
    env.wait_until_electrum_sees_txid(txid, TIMEOUT)?;
    Ok(txid)
}

/// Mine one block and wait until the index has it.
pub fn confirm(env: &TestEnv) -> anyhow::Result<()> {
    env.mine_blocks(1, None)?;
    env.wait_until_electrum_sees_block(TIMEOUT)?;
    Ok(())
}

pub async fn open(url: &str, key: &KeyMaterial) -> anyhow::Result<WalletHandle> {
    Ok(WalletHandle::open(config(url), key, Box::new(MemoryPersister::new())).await?)
}

/// Build, unsigned, a payment of `amount_sat` to `address` alone.
pub async fn build_payment(
    wallet: &WalletHandle,
    address: &str,
    amount_sat: u64,
    fee_rate_sat_vb: f64,
) -> anyhow::Result<BuiltTx> {
    let recipient = Recipient {
        address: address.to_owned(),
        amount_sat,
    };
    Ok(wallet.build_transfer(&[recipient], fee_rate_sat_vb).await?)
}

/// Sign and broadcast `built`, and wait until the index has it.
pub async fn send(env: &TestEnv, wallet: &WalletHandle, built: &BuiltTx) -> anyhow::Result<String> {
    let signed = wallet.sign(&built.psbt_base64).await?;
    let sent = wallet.broadcast(&signed).await?;
    assert_eq!(sent.persist_error, None, "local state must persist");
    env.wait_until_electrum_sees_txid(Txid::from_str(&sent.txid)?, TIMEOUT)?;
    Ok(sent.txid)
}

/// Derive an address straight from the seed with BDK's BIP84 template, so an
/// assertion does not just re-read what the wallet under test believes.
/// `passphrase` is the BIP39 one: it changes the seed, so it changes every
/// address the account derives.
pub fn derived_address(
    words: &str,
    passphrase: Option<&str>,
    keychain: KeychainKind,
    index: u32,
) -> String {
    let mnemonic = Mnemonic::parse_in(Language::English, words).expect("mnemonic parses");
    let passphrase = passphrase.map(str::to_owned);
    let reference = BdkWallet::create(
        Bip84(
            (mnemonic.clone(), passphrase.clone()),
            KeychainKind::External,
        ),
        Bip84((mnemonic, passphrase), KeychainKind::Internal),
    )
    .network(wallet_core::bitcoin::Network::Regtest)
    .create_wallet_no_persist()
    .expect("reference wallet builds");
    reference.peek_address(keychain, index).address.to_string()
}
