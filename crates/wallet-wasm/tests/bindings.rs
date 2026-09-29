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
use wallet_wasm::Wallet;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_test::wasm_bindgen_test;

/// BIP39's own test phrase, so every run derives the same wallet.
const WORDS: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn get(target: &JsValue, key: &str) -> JsValue {
    Reflect::get(target, &JsValue::from_str(key)).unwrap()
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

fn config() -> JsValue {
    JSON::parse(
        r#"{"network":"testnet4","address_type":"p2wpkh",
            "backend":{"kind":"esplora","url":"https://example.invalid/api"}}"#,
    )
    .unwrap()
}

async fn open(persister: &JsValue) -> Result<Wallet, JsValue> {
    Wallet::open(config(), WORDS, persister.clone(), None).await
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
    assert_eq!(
        get(&details, "reason").as_string().as_deref(),
        Some("malformed")
    );
    // A missing value arrives as `null`, as it would from JSON.
    assert!(get(&details, "found").is_null(), "{details:?}");
}
