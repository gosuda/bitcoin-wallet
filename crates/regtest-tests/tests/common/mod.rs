//! Shared by the end-to-end tests; each one declares `mod common;`.

use wallet_core::bdk_wallet::keys::bip39::{Language, Mnemonic};
use wallet_core::bdk_wallet::template::Bip84;
use wallet_core::bdk_wallet::{KeychainKind, Wallet as BdkWallet};

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
