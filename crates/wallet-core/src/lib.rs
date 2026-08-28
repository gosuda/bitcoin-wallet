//! Portable Bitcoin wallet core built on BDK.
//!
//! - [`keys`]: single-key material, address derivation, key generation.
//! - [`backend`]: provider-neutral chain access (Esplora, mock).
//! - [`WalletHandle`]: sync, balance, UTXOs, build → sign → broadcast.
//! - [`keystore`]: storage boundary for unlock material.
//!
//! No UI concerns live here; every public type is plain `serde` data so native
//! (Tauri) and browser (WASM) shells can wrap the API 1:1.

pub use bdk_wallet::bitcoin;

pub mod backend;
pub mod error;
pub mod keys;
pub mod keystore;
pub mod network;
pub mod wallet;

pub use backend::{BackendConfig, ChainBackend, FeeEstimate};
pub use error::{Error, Result};
pub use keys::{AddressType, GeneratedKey, KeyMaterial, address_for_key, generate_key};
#[cfg(feature = "keystore-native")]
pub use keystore::NativeKeystore;
pub use keystore::{Keystore, MemoryKeystore};
pub use network::Network;
pub use wallet::{Balance, Broadcast, BuiltTx, Recipient, Utxo, WalletConfig, WalletHandle};
