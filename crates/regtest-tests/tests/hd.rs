//! End-to-end HD (BIP39/BIP32) wallet flow against a real node.
//!
//! The single-key path is covered by `send.rs`. What is different here is the
//! account: receive addresses come one after another off the external keychain,
//! and change goes to a *separate* internal keychain instead of back to the
//! address that was just paid. This walks that through `bitcoind` + `electrs`:
//! fund two different receive addresses, spend, and check where the change
//! landed.

// Only ever compiled as a test. Saying so lets clippy's test exemption
// reach the helpers here, not just the #[test] functions.
#![cfg(test)]

mod common;
use common::{build_payment, confirm, derived_address, fund, open, send, start};
use wallet_core::bdk_wallet::KeychainKind;
use wallet_core::{AddressType, KeyMaterial, Network};

const FIRST_SAT: u64 = 200_000;
const SECOND_SAT: u64 = 120_000;
const SEND_SAT: u64 = 40_000;

fn derived(words: &str, keychain: KeychainKind, index: u32) -> String {
    derived_address(words, None, keychain, index)
}

#[tokio::test]
async fn hd_wallet_receives_on_fresh_addresses_and_changes_internally() -> anyhow::Result<()> {
    let (env, esplora_url) = start()?;

    let seed = wallet_core::generate_mnemonic(Network::Regtest, AddressType::P2wpkh, 12)?;
    let words = seed.words.clone();
    let wallet = open(&esplora_url, &KeyMaterial::parse(&words)).await?;
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

    fund(&env, &first, FIRST_SAT)?;
    confirm(&env)?;

    wallet.sync().await?;
    assert_eq!(wallet.balance().await.confirmed, FIRST_SAT);
    assert_eq!(wallet.list_utxos().await.len(), 1);

    // --- receive on a second, freshly revealed address
    let second = wallet.new_address().await?;
    assert_ne!(second, first, "new_address must not hand back the old one");
    assert_eq!(second, derived(&words, KeychainKind::External, 1));

    fund(&env, &second, SECOND_SAT)?;
    confirm(&env)?;

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

    // --- the same words under a passphrase are a different wallet
    //
    // BIP39 mixes the passphrase into the seed, so this is a separate account
    // with its own address space. Against the same chain and the same funded
    // words it must hand out an address this wallet does not own, and find none
    // of the coins.
    let passphrased = open(
        &esplora_url,
        &KeyMaterial::parse_with_passphrase(&words, Some("regtest passphrase"))?,
    )
    .await?;
    assert_ne!(
        passphrased.id(),
        wallet.id(),
        "a passphrase makes it a different wallet id"
    );
    let passphrased_first = passphrased.address().await;
    assert_ne!(passphrased_first, first);
    assert_ne!(passphrased_first, second);
    assert_eq!(
        passphrased_first,
        derived_address(
            &words,
            Some("regtest passphrase"),
            KeychainKind::External,
            0
        ),
        "the passphrase account is BIP84 of the passphrased seed"
    );
    passphrased.sync().await?;
    assert_eq!(
        passphrased.balance().await.confirmed,
        0,
        "the passphrase account sees none of the coins sent to these words"
    );

    // --- spend: the change must not come back to a receive address
    let destination = wallet_core::generate_key(Network::Regtest, AddressType::P2tr)?;
    let built = build_payment(&wallet, &destination.address, SEND_SAT, 2.0).await?;
    assert_eq!(built.total_out_sat, SEND_SAT);
    assert!(built.change_sat > 0, "the spend must produce change");

    send(&env, &wallet, &built).await?;
    confirm(&env)?;
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
