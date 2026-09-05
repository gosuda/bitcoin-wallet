//! Error domain of the wallet core.

use thiserror::Error;

/// All failures surfaced by the wallet core.
///
/// Every variant has a stable [`Error::code`]. That is what crosses the IPC
/// and wasm boundaries: the message is for people, the code is for the UI to
/// branch on — retry on a timeout, top up on insufficient funds.
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
    #[error("signing error: {0}")]
    Sign(String),
    #[error("psbt error: {0}")]
    Psbt(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
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
            Error::Sign(_) => "sign",
            Error::Psbt(_) => "psbt",
            Error::Unsupported(_) => "unsupported",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
