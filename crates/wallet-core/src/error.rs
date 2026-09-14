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
    #[error("insufficient funds: need {needed_sat} sat, have {available_sat} sat")]
    InsufficientFunds { needed_sat: u64, available_sat: u64 },
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
    /// `manually_selected_only` was requested with nothing selected. Not
    /// reachable through this wallet's own UI today, kept apart from
    /// [`Error::BuildTx`] for the same reason every other build failure this
    /// module can name precisely is.
    #[error("no coins were selected to fund this transaction")]
    NoUtxos,
    /// A txid string did not parse. Kept apart from [`Error::BuildTx`]
    /// because the fix is a different txid, not a different transaction.
    #[error("invalid transaction id: {0}")]
    InvalidTxid(String),
    /// The transaction a fee bump named cannot be replaced: unknown to the
    /// wallet, already confirmed, or built without RBF signaling.
    #[error("transaction cannot be replaced: {0}")]
    NotReplaceable(String),
    /// The persisted wallet state could not be read back: a future format
    /// version, or a record that does not parse at all. Kept apart from
    /// [`Error::Persist`], which is an I/O failure talking to the store —
    /// this is the store answering fine with something unusable.
    #[error("saved wallet data could not be read: {reason}")]
    CorruptState { reason: String },
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
            } => Some(json!({ "needed_sat": needed_sat, "available_sat": available_sat })),
            Error::Dust { output } => Some(json!({ "output": output })),
            Error::FeeTooLow {
                required_sat_vb,
                required_sat,
            } => Some(json!({
                "required_sat_vb": required_sat_vb,
                "required_sat": required_sat,
            })),
            Error::CorruptState { reason } => Some(json!({ "reason": reason })),
            _ => None,
        }
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

    /// One instance of each variant, paired with its code and — for the
    /// variants that carry structured data — the exact set of keys
    /// `details()` must produce. A table, not a chain of asserts, so a new
    /// variant only needs one new row here.
    #[allow(clippy::type_complexity)]
    fn samples() -> Vec<(Error, &'static str, Option<&'static [&'static str]>)> {
        vec![
            (Error::InvalidKey("x".into()), "invalid_key", None),
            (Error::InvalidAddress("x".into()), "invalid_address", None),
            (Error::Descriptor("x".into()), "descriptor", None),
            (Error::Persist("x".into()), "persist", None),
            (Error::Backend("x".into()), "backend", None),
            (Error::Timeout(30), "timeout", Some(["secs"].as_slice())),
            (Error::BuildTx("x".into()), "build_tx", None),
            (
                Error::InsufficientFunds {
                    needed_sat: 10,
                    available_sat: 5,
                },
                "insufficient_funds",
                Some(["needed_sat", "available_sat"].as_slice()),
            ),
            (Error::InvalidFeeRate("x".into()), "invalid_fee_rate", None),
            (Error::Sign("x".into()), "sign", None),
            (Error::Psbt("x".into()), "psbt", None),
            (Error::Unsupported("x".into()), "unsupported", None),
            (
                Error::Dust { output: 0 },
                "dust",
                Some(["output"].as_slice()),
            ),
            (
                Error::FeeTooLow {
                    required_sat_vb: Some(2.0),
                    required_sat: None,
                },
                "fee_too_low",
                Some(["required_sat_vb", "required_sat"].as_slice()),
            ),
            (Error::NoUtxos, "no_utxos", None),
            (Error::InvalidTxid("x".into()), "invalid_txid", None),
            (Error::NotReplaceable("x".into()), "not_replaceable", None),
            (
                Error::CorruptState { reason: "x".into() },
                "corrupt_state",
                Some(["reason"].as_slice()),
            ),
        ]
    }

    #[test]
    fn every_variant_has_its_code_and_the_expected_details_shape() {
        for (err, code, keys) in samples() {
            assert_eq!(err.code(), code);
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

    #[test]
    fn every_code_is_unique() {
        let codes: Vec<&str> = samples().into_iter().map(|(_, code, _)| code).collect();
        let mut sorted = codes.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), codes.len(), "duplicate code in {codes:?}");
    }

    #[test]
    fn error_payload_carries_the_message_and_the_details() {
        let err = Error::InsufficientFunds {
            needed_sat: 100,
            available_sat: 40,
        };
        let payload = ErrorPayload::from(&err);
        assert_eq!(payload.code, "insufficient_funds");
        assert_eq!(payload.message, err.to_string());
        assert_eq!(
            payload.details,
            Some(json!({ "needed_sat": 100, "available_sat": 40 }))
        );

        let plain = Error::InvalidKey("bad".into());
        assert_eq!(ErrorPayload::from(&plain).details, None);
    }
}
