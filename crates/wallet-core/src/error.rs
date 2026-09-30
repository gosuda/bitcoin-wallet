//! Error domain of the wallet core.

use serde::Serialize;
use serde_json::{Value, json};
use thiserror::Error;

/// All failures surfaced by the wallet core.
///
/// Every variant has a stable [`Error::code`]. That is what crosses the IPC
/// and wasm boundaries: the message is for people, the code is for the UI to
/// branch on — retry on a timeout, top up on insufficient funds. A few
/// variants also carry [`Error::details`]: structured data a screen can use
/// directly (a shortfall in sats) instead of parsing it back out of prose.
#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid key material: {0}")]
    InvalidKey(String),
    #[error("invalid address: {0}")]
    InvalidAddress(String),
    #[error("descriptor error: {0}")]
    Descriptor(String),
    #[error("persistence error: {0}")]
    Persist(String),
    #[error("backend error: {0}")]
    Backend(String),
    /// The backend did not answer within the deadline. Kept apart from
    /// [`Error::Backend`] because the right response is to retry or switch
    /// endpoint, not to read the message.
    #[error("the backend did not answer within {0} s")]
    Timeout(u64),
    #[error("transaction build error: {0}")]
    BuildTx(String),
    /// The wallet cannot cover the outputs plus the fee. The amounts ride
    /// along so a UI can say by how much, not only that it failed.
    ///
    /// `frozen_sat` is what the coins frozen with `set_frozen` hold, which a
    /// send the wallet chose coins for left out: without it, "need 11 more"
    /// reads as a wallet with nothing in it. It is 0 for a send held to
    /// chosen coins, which names its coins itself.
    #[error("insufficient funds: need {needed_sat} sat, have {available_sat} sat{}", frozen_note(*frozen_sat))]
    InsufficientFunds {
        needed_sat: u64,
        available_sat: u64,
        frozen_sat: u64,
    },
    /// A fee rate that is not a plausible sat/vB value: not finite, negative,
    /// or past the ceiling. Kept apart from [`Error::BuildTx`] because it is
    /// caught before a builder is touched, on every path a rate can arrive
    /// from (a manual entry, a bump, a saved preference).
    #[error("invalid fee rate: {0}")]
    InvalidFeeRate(String),
    #[error("signing error: {0}")]
    Sign(String),
    #[error("psbt error: {0}")]
    Psbt(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// An output's value is at or below the network's dust limit. Kept apart
    /// from [`Error::BuildTx`] so a screen can point at the amount field
    /// instead of repeating BDK's index-only wording.
    #[error("output {output} is below the dust limit")]
    Dust { output: usize },
    /// A fee bump's requested rate or absolute fee does not clear BDK's
    /// replacement rule. Exactly one of the two fields is set, matching
    /// whichever of BDK's two "too low" variants this came from.
    #[error("fee too low to replace the original: {}",
        required_sat_vb.map(|r| format!("needs at least {r} sat/vB"))
            .or_else(|| required_sat.map(|r| format!("needs at least {r} sat")))
            .unwrap_or_else(|| "no minimum given".into()))]
    FeeTooLow {
        required_sat_vb: Option<f64>,
        required_sat: Option<u64>,
    },
    /// A send held to chosen coins was given none. Kept apart from
    /// [`Error::BuildTx`] for the same reason every other build failure this
    /// module can name precisely is.
    #[error("no coins were selected to fund this transaction")]
    NoUtxos,
    /// A coin the caller named is not an unspent output of this wallet: spent
    /// since the coin list was read, or never ours. Kept apart from
    /// [`Error::BuildTx`] because the fix is to read the coins again.
    #[error("not an unspent coin of this wallet: {0}")]
    UnknownCoin(String),
    /// A txid string did not parse. Kept apart from [`Error::BuildTx`]
    /// because the fix is a different txid, not a different transaction.
    #[error("invalid transaction id: {0}")]
    InvalidTxid(String),
    /// The transaction a fee bump named cannot be replaced: unknown to the
    /// wallet, already confirmed, or built without RBF signaling.
    #[error("transaction cannot be replaced: {0}")]
    NotReplaceable(String),
    /// The persisted wallet state could not be read back: a future format
    /// version, a record that does not decode as a changeset, or one that
    /// does not match the wallet being opened. Kept apart from
    /// [`Error::Persist`], which is an I/O failure talking to the store —
    /// this is the store answering fine with something unusable. `reason`
    /// is one of a fixed set of tags ("future_version", "malformed",
    /// "mismatch"); `found`/`supported` are set only for "future_version".
    #[error("saved wallet data could not be read: {reason}")]
    CorruptState {
        reason: &'static str,
        found: Option<u64>,
        supported: Option<u64>,
    },
}

impl Error {
    /// Stable machine-readable name of the variant.
    pub fn code(&self) -> &'static str {
        match self {
            Error::InvalidKey(_) => "invalid_key",
            Error::InvalidAddress(_) => "invalid_address",
            Error::Descriptor(_) => "descriptor",
            Error::Persist(_) => "persist",
            Error::Backend(_) => "backend",
            Error::Timeout(_) => "timeout",
            Error::BuildTx(_) => "build_tx",
            Error::InsufficientFunds { .. } => "insufficient_funds",
            Error::InvalidFeeRate(_) => "invalid_fee_rate",
            Error::Sign(_) => "sign",
            Error::Psbt(_) => "psbt",
            Error::Unsupported(_) => "unsupported",
            Error::Dust { .. } => "dust",
            Error::FeeTooLow { .. } => "fee_too_low",
            Error::NoUtxos => "no_utxos",
            Error::UnknownCoin(_) => "unknown_coin",
            Error::InvalidTxid(_) => "invalid_txid",
            Error::NotReplaceable(_) => "not_replaceable",
            Error::CorruptState { .. } => "corrupt_state",
        }
    }

    /// Structured data a UI can use directly, for the variants that carry
    /// more than prose. `None` for everything else — the message already
    /// says all there is to say.
    pub fn details(&self) -> Option<Value> {
        match self {
            Error::Timeout(secs) => Some(json!({ "secs": secs })),
            Error::InsufficientFunds {
                needed_sat,
                available_sat,
                frozen_sat,
            } => Some(json!({
                "needed_sat": needed_sat,
                "available_sat": available_sat,
                "frozen_sat": frozen_sat,
            })),
            Error::Dust { output } => Some(json!({ "output": output })),
            Error::FeeTooLow {
                required_sat_vb,
                required_sat,
            } => Some(json!({
                "required_sat_vb": required_sat_vb,
                "required_sat": required_sat,
            })),
            Error::CorruptState {
                reason,
                found,
                supported,
            } => Some(json!({ "reason": reason, "found": found, "supported": supported })),
            _ => None,
        }
    }

    /// For a send the wallet chose coins for: what the frozen coins it left
    /// out hold. Every other error passes through as it is.
    pub(crate) fn with_frozen(self, frozen: u64) -> Self {
        match self {
            Error::InsufficientFunds {
                needed_sat,
                available_sat,
                ..
            } => Error::InsufficientFunds {
                needed_sat,
                available_sat,
                frozen_sat: frozen,
            },
            other => other,
        }
    }
}

/// The end of an insufficient-funds message: nothing when no coin is frozen.
fn frozen_note(frozen_sat: u64) -> String {
    if frozen_sat == 0 {
        String::new()
    } else {
        format!(" ({frozen_sat} sat more is frozen)")
    }
}

/// The shape [`Error`] takes crossing the wasm and Tauri IPC boundaries.
/// `Error` itself is not [`Serialize`] — nothing about the error domain
/// forces every future variant to also be a wire format — this is that
/// wire format, built once from whichever error actually occurred.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl From<&Error> for ErrorPayload {
    fn from(e: &Error) -> Self {
        Self {
            code: e.code(),
            message: e.to_string(),
            details: e.details(),
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    /// One instance of each variant with its code, the exact set of keys
    /// `details()` must produce (for the variants that carry structured
    /// data), and the message people see. A table, not a chain of asserts,
    /// so a new variant only needs one new row here.
    #[allow(clippy::type_complexity)]
    fn samples() -> Vec<(
        Error,
        &'static str,
        Option<&'static [&'static str]>,
        &'static str,
    )> {
        vec![
            (
                Error::InvalidKey("x".into()),
                "invalid_key",
                None,
                "invalid key material: x",
            ),
            (
                Error::InvalidAddress("x".into()),
                "invalid_address",
                None,
                "invalid address: x",
            ),
            (
                Error::Descriptor("x".into()),
                "descriptor",
                None,
                "descriptor error: x",
            ),
            (
                Error::Persist("x".into()),
                "persist",
                None,
                "persistence error: x",
            ),
            (
                Error::Backend("x".into()),
                "backend",
                None,
                "backend error: x",
            ),
            (
                Error::Timeout(30),
                "timeout",
                Some(["secs"].as_slice()),
                "the backend did not answer within 30 s",
            ),
            (
                Error::BuildTx("x".into()),
                "build_tx",
                None,
                "transaction build error: x",
            ),
            (
                Error::InsufficientFunds {
                    needed_sat: 10,
                    available_sat: 5,
                    frozen_sat: 0,
                },
                "insufficient_funds",
                Some(["needed_sat", "available_sat", "frozen_sat"].as_slice()),
                "insufficient funds: need 10 sat, have 5 sat",
            ),
            (
                Error::InvalidFeeRate("x".into()),
                "invalid_fee_rate",
                None,
                "invalid fee rate: x",
            ),
            (Error::Sign("x".into()), "sign", None, "signing error: x"),
            (Error::Psbt("x".into()), "psbt", None, "psbt error: x"),
            (
                Error::Unsupported("x".into()),
                "unsupported",
                None,
                "unsupported: x",
            ),
            (
                Error::Dust { output: 0 },
                "dust",
                Some(["output"].as_slice()),
                "output 0 is below the dust limit",
            ),
            (
                Error::FeeTooLow {
                    required_sat_vb: Some(2.0),
                    required_sat: None,
                },
                "fee_too_low",
                Some(["required_sat_vb", "required_sat"].as_slice()),
                "fee too low to replace the original: needs at least 2 sat/vB",
            ),
            (
                Error::NoUtxos,
                "no_utxos",
                None,
                "no coins were selected to fund this transaction",
            ),
            (
                Error::UnknownCoin("x".into()),
                "unknown_coin",
                None,
                "not an unspent coin of this wallet: x",
            ),
            (
                Error::InvalidTxid("x".into()),
                "invalid_txid",
                None,
                "invalid transaction id: x",
            ),
            (
                Error::NotReplaceable("x".into()),
                "not_replaceable",
                None,
                "transaction cannot be replaced: x",
            ),
            (
                Error::CorruptState {
                    reason: "future_version",
                    found: Some(2),
                    supported: Some(1),
                },
                "corrupt_state",
                Some(["reason", "found", "supported"].as_slice()),
                "saved wallet data could not be read: future_version",
            ),
        ]
    }

    /// Adding a variant fails to compile here until it has an ordinal. Give
    /// it the next one, raise `VARIANTS` beside it, and add its row to
    /// `samples` — `the_table_covers_every_variant` fails until all three agree.
    fn ordinal(e: &Error) -> usize {
        match e {
            Error::InvalidKey(_) => 0,
            Error::InvalidAddress(_) => 1,
            Error::Descriptor(_) => 2,
            Error::Persist(_) => 3,
            Error::Backend(_) => 4,
            Error::Timeout(_) => 5,
            Error::BuildTx(_) => 6,
            Error::InsufficientFunds { .. } => 7,
            Error::InvalidFeeRate(_) => 8,
            Error::Sign(_) => 9,
            Error::Psbt(_) => 10,
            Error::Unsupported(_) => 11,
            Error::Dust { .. } => 12,
            Error::FeeTooLow { .. } => 13,
            Error::NoUtxos => 14,
            Error::InvalidTxid(_) => 15,
            Error::NotReplaceable(_) => 16,
            Error::CorruptState { .. } => 17,
            Error::UnknownCoin(_) => 18,
        }
    }
    const VARIANTS: usize = 19;

    #[test]
    fn the_table_covers_every_variant() {
        let mut seen: Vec<usize> = samples().iter().map(|(e, ..)| ordinal(e)).collect();
        seen.sort_unstable();
        assert_eq!(seen, (0..VARIANTS).collect::<Vec<_>>());
    }

    #[test]
    fn every_variant_has_its_code_message_and_details_shape() {
        for (err, code, keys, message) in samples() {
            assert_eq!(err.code(), code);
            assert_eq!(err.to_string(), message, "{code}: message");
            match (err.details(), keys) {
                (Some(Value::Object(map)), Some(expected)) => {
                    for k in expected {
                        assert!(map.contains_key(*k), "{code}: missing details key {k}");
                    }
                    assert_eq!(
                        map.len(),
                        expected.len(),
                        "{code}: unexpected details keys in {map:?}"
                    );
                }
                (None, None) => {}
                (details, keys) => {
                    panic!("{code}: details {details:?} does not match expected keys {keys:?}")
                }
            }
        }
    }

    /// `FeeTooLow` builds its message from whichever of its two fields is
    /// set; the table above shows one branch, these are the other two.
    #[test]
    fn fee_too_low_names_whichever_minimum_it_has() {
        let absolute = Error::FeeTooLow {
            required_sat_vb: None,
            required_sat: Some(1234),
        };
        assert_eq!(
            absolute.to_string(),
            "fee too low to replace the original: needs at least 1234 sat"
        );
        let neither = Error::FeeTooLow {
            required_sat_vb: None,
            required_sat: None,
        };
        assert_eq!(
            neither.to_string(),
            "fee too low to replace the original: no minimum given"
        );
    }

    #[test]
    fn every_code_is_unique() {
        let codes: Vec<&str> = samples().into_iter().map(|(_, code, ..)| code).collect();
        let mut sorted = codes.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), codes.len(), "duplicate code in {codes:?}");
    }

    /// The table's row has nothing frozen; with frozen coins the message says
    /// what they hold, so a log or the CLI shows why a full wallet fell short.
    #[test]
    fn a_shortfall_with_frozen_coins_says_what_they_hold() {
        let err = Error::InsufficientFunds {
            needed_sat: 10,
            available_sat: 0,
            frozen_sat: 29_290,
        };
        assert_eq!(
            err.to_string(),
            "insufficient funds: need 10 sat, have 0 sat (29290 sat more is frozen)"
        );
    }

    #[test]
    fn error_payload_carries_the_message_and_the_details() {
        let err = Error::InsufficientFunds {
            needed_sat: 100,
            available_sat: 40,
            frozen_sat: 7,
        };
        let payload = ErrorPayload::from(&err);
        assert_eq!(payload.code, "insufficient_funds");
        assert_eq!(payload.message, err.to_string());
        assert_eq!(
            payload.details,
            Some(json!({ "needed_sat": 100, "available_sat": 40, "frozen_sat": 7 }))
        );

        let plain = Error::InvalidKey("bad".into());
        assert_eq!(ErrorPayload::from(&plain).details, None);
    }
}
