//! Error domain of the wallet core.

use thiserror::Error;

/// All failures surfaced by the wallet core.
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
    #[error("transaction build error: {0}")]
    BuildTx(String),
    #[error("signing error: {0}")]
    Sign(String),
    #[error("psbt error: {0}")]
    Psbt(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
}

pub type Result<T> = std::result::Result<T, Error>;
