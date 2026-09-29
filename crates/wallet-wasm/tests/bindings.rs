//! The bindings as JavaScript receives them, run in Node:
//! `wasm-pack test --node crates/wallet-wasm`.
//!
//! Nothing here touches the network. Opening a wallet only builds its backend
//! client, and every call below reads or writes local state.

// Only ever compiled as a test, and only for wasm32, where the crate exists.
// Two attributes rather than one `cfg(all(..))`: clippy recognises only a
// bare `cfg(test)` as the test exemption the helpers below rely on.
#![cfg(test)]
#![cfg(target_arch = "wasm32")]

use js_sys::{Function, JSON, Object, Reflect};
use wallet_wasm::{Wallet, generate_key, generate_mnemonic, validate_mnemonic, wallet_id_for_key};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_test::wasm_bindgen_test;

/// BIP39's own test phrase, so every run derives the same wallet.
const WORDS: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn get(target: &JsValue, key: &str) -> JsValue {
    Reflect::get(target, &JsValue::from_str(key)).unwrap()
}

fn text(target: &JsValue, key: &str) -> String {
    get(target, key).as_string().expect(key)
}

/// A thrown binding error as the UI's `isAppError` sees it — a real JS
/// `Error` with a string `code` and `message` — returning the code.
fn code_of(err: &JsValue) -> String {
    assert!(
        err.is_instance_of::<js_sys::Error>(),
        "not an Error: {err:?}"
    );
    assert!(get(err, "message").is_string(), "no message: {err:?}");
    get(err, "code").as_string().expect("no string code")
}

/// `details` as the UI reads it: plain properties (`details.needed_sat`), the
/// value `JSON.parse` gives the Tauri side. An ES `Map` would read
/// `undefined` for every one of them.
fn details_of(err: &JsValue) -> JsValue {
    let details = get(err, "details");
    assert!(details.is_object(), "no details: {err:?}");
    assert!(
        !details.is_instance_of::<js_sys::Map>(),
        "details arrived as a Map: {details:?}"
    );
    details
}

/// The persister contract from the crate docs, written in JS. It keeps its
/// one record in `record`, where a test can read or plant it.
fn persister(record: Option<&str>) -> JsValue {
    let p = Object::new();
    let set = |key: &str, value: &JsValue| {
        Reflect::set(&p, &JsValue::from_str(key), value).unwrap();
    };
    set("record", &record.map_or(JsValue::NULL, JsValue::from_str));
    set(
        "initialize",
        &Function::new_no_args("return Promise.resolve(this.record)"),
    );
    set(
        "persist",
        &Function::new_with_args("json", "this.record = json; return Promise.resolve()"),
    );
    p.into()
}

fn config(address_type: &str) -> JsValue {
    JSON::parse(&format!(
        r#"{{"network":"testnet4","address_type":"{address_type}",
            "backend":{{"kind":"esplora","url":"https://example.invalid/api"}}}}"#
    ))
    .unwrap()
}

async fn open(persister: &JsValue) -> Result<Wallet, JsValue> {
    Wallet::open(config("p2wpkh"), WORDS, persister.clone(), None).await
}

#[wasm_bindgen_test]
async fn an_overspend_reports_its_shortfall_as_numbers() {
    let wallet = open(&persister(None)).await.unwrap();
    let to = wallet.address().await;
    let recipients = JSON::parse(&format!(r#"[{{"address":"{to}","amount_sat":10000}}]"#)).unwrap();

    let err = wallet.build_transfer(recipients, 2.0).await.unwrap_err();

    assert_eq!(code_of(&err), "insufficient_funds");
    let details = details_of(&err);
    let needed = get(&details, "needed_sat").as_f64().expect("needed_sat");
    assert!(needed > 10_000.0, "the amount plus a fee, got {needed}");
    assert_eq!(get(&details, "available_sat").as_f64(), Some(0.0));
}

#[wasm_bindgen_test]
async fn an_unreadable_record_says_why_in_its_details() {
    let err = open(&persister(Some("{not json")))
        .await
        .err()
        .expect("a malformed record opened");

    assert_eq!(code_of(&err), "corrupt_state");
    let details = details_of(&err);
    assert_eq!(text(&details, "reason"), "malformed");
    // A missing value arrives as `null`, as it would from JSON.
    assert!(get(&details, "found").is_null(), "{details:?}");
}

#[wasm_bindgen_test]
async fn a_record_from_a_newer_build_names_both_versions() {
    let err = open(&persister(Some(r#"{"v":2,"changeset":{}}"#)))
        .await
        .err()
        .expect("a newer record opened");

    assert_eq!(code_of(&err), "corrupt_state");
    let details = details_of(&err);
    assert_eq!(text(&details, "reason"), "future_version");
    assert_eq!(get(&details, "found").as_f64(), Some(2.0));
    assert_eq!(get(&details, "supported").as_f64(), Some(1.0));
}

#[wasm_bindgen_test]
fn an_error_without_data_has_no_details_at_all() {
    let wrong_checksum = WORDS.replace("about", "abandon");
    let err = validate_mnemonic(&wrong_checksum).unwrap_err();

    assert_eq!(code_of(&err), "invalid_key");
    let message = text(&err, "message");
    assert!(
        message.starts_with("invalid key material: invalid mnemonic"),
        "{message}"
    );
    // Absent, not `undefined` or `null`: the property does not exist.
    assert!(!Reflect::has(&err, &JsValue::from_str("details")).unwrap());
}

#[wasm_bindgen_test]
fn an_unknown_name_is_unsupported() {
    let err = generate_key("mainnet-ish", "p2wpkh").unwrap_err();
    assert_eq!(code_of(&err), "unsupported");
    assert_eq!(text(&err, "message"), "unknown network 'mainnet-ish'");

    let err = generate_key("testnet4", "p2sh").unwrap_err();
    assert_eq!(code_of(&err), "unsupported");
    assert_eq!(text(&err, "message"), "unknown address type 'p2sh'");
}

/// The address a wallet opened from `secret` receives at first.
async fn first_address(secret: &str) -> String {
    Wallet::open(config("p2wpkh"), secret, persister(None), None)
        .await
        .unwrap()
        .address()
        .await
}

#[wasm_bindgen_test]
async fn a_generated_key_opens_to_the_address_it_came_with() {
    let key = generate_key("testnet4", "p2wpkh").unwrap();
    let address = text(&key, "address");
    assert!(address.starts_with("tb1q"), "{address}");
    for secret in [text(&key, "wif"), text(&key, "priv_hex")] {
        assert_eq!(first_address(&secret).await, address);
    }
    // The entropy comes from the JS host's `crypto.getRandomValues`.
    let other = generate_key("testnet4", "p2wpkh").unwrap();
    assert_ne!(text(&other, "priv_hex"), text(&key, "priv_hex"));
}

#[wasm_bindgen_test]
async fn a_generated_phrase_validates_and_opens_to_its_address() {
    for count in [12_u8, 24] {
        let phrase = generate_mnemonic("testnet4", "p2wpkh", count).unwrap();
        let words = text(&phrase, "words");
        assert_eq!(words.split_whitespace().count(), usize::from(count));
        validate_mnemonic(&words).unwrap();
        assert_eq!(first_address(&words).await, text(&phrase, "address"));
    }
    let err = generate_mnemonic("testnet4", "p2wpkh", 13).unwrap_err();
    assert_eq!(code_of(&err), "invalid_key");
}

#[wasm_bindgen_test]
async fn a_wallet_reopens_from_what_its_persister_kept() {
    let store = persister(None);
    let wallet = open(&store).await.unwrap();
    assert_eq!(
        wallet.id(),
        wallet_id_for_key(WORDS, "testnet4", "p2wpkh", None).unwrap()
    );
    assert_eq!(wallet.network(), "testnet4");
    assert_eq!(wallet.address_type(), "p2wpkh");
    assert!(wallet.is_hd() && !wallet.is_watch_only());

    let first = wallet.address().await;
    let second = wallet.new_address().await.unwrap();
    assert_ne!(second, first);

    // What reached JS is the versioned envelope, not a bare changeset.
    let record: serde_json::Value = serde_json::from_str(&text(&store, "record")).unwrap();
    assert_eq!(record["v"], 1);
    drop(wallet);

    // Reopened from that record, the wallet knows two addresses are out and
    // reveals a third. Opened without it, the same words start over.
    let reopened = open(&store).await.unwrap();
    let third = reopened.new_address().await.unwrap();
    assert!(third != first && third != second, "{third}");
    let fresh = open(&persister(None)).await.unwrap();
    assert_eq!(fresh.address().await, first);
    assert_eq!(fresh.new_address().await.unwrap(), second);
}

#[wasm_bindgen_test]
async fn the_nested_type_has_one_spelling_and_keeps_its_ids() {
    // The UI's own name goes in, and the same name comes back out.
    let wallet = Wallet::open(config("nested_p2wpkh"), WORDS, persister(None), None)
        .await
        .unwrap();
    assert_eq!(wallet.address_type(), "nested_p2wpkh");
    // BIP49 states its test vector on testnet, whose coin type testnet4 shares.
    assert_eq!(
        wallet.address().await,
        "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2"
    );

    // A wallet remembered while the UI still translated the name to
    // `np2wpkh` is stored under the same id, so it still unlocks.
    let id = wallet_id_for_key(WORDS, "testnet4", "nested_p2wpkh", None).unwrap();
    assert_eq!(
        id,
        wallet_id_for_key(WORDS, "testnet4", "np2wpkh", None).unwrap()
    );
    assert_eq!(wallet.id(), id);
}
