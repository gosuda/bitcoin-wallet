//! Portable Bitcoin wallet core built on BDK.
//!
//! - [`keys`]: single-key material, address derivation, key generation.
//! - [`backend`]: provider-neutral chain access (Esplora, mock).
//! - [`persist`]: portable persistence boundary for public wallet state.
//! - [`WalletHandle`]: sync, balance, UTXOs, build → sign → broadcast.
//! - [`keystore`]: storage boundary for unlock material (secrets).
//!
//! One wallet model everywhere: the same crate runs natively (CLI, tests) and
//! as WASM in the browser or a Tauri webview. The platform supplies persistence
//! and secure key storage; no UI or database lives here.

pub use bdk_wallet;
pub use bdk_wallet::bitcoin;

pub mod backend;
pub mod error;
pub mod keys;
pub mod keystore;
pub mod network;
pub mod persist;
pub mod wallet;

pub use backend::{BackendConfig, ChainBackend, FeeEstimate};
pub use error::{Error, Result};
pub use keys::{AddressType, GeneratedKey, KeyMaterial, address_for_key, generate_key};
#[cfg(all(feature = "keystore-native", not(target_arch = "wasm32")))]
pub use keystore::NativeKeystore;
pub use keystore::{Keystore, MemoryKeystore};
pub use network::Network;
pub use persist::{MemoryPersister, Persister};
pub use wallet::{
    Balance, Broadcast, BuiltTx, Recipient, TxSummary, Utxo, WalletConfig, WalletHandle,
};

/// `Send` on native targets, nothing on WASM (browser futures are not `Send`).
#[cfg(not(target_arch = "wasm32"))]
pub trait MaybeSend: Send {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Send> MaybeSend for T {}
#[cfg(target_arch = "wasm32")]
pub trait MaybeSend {}
#[cfg(target_arch = "wasm32")]
impl<T> MaybeSend for T {}

/// `Sync` on native targets, nothing on WASM.
#[cfg(not(target_arch = "wasm32"))]
pub trait MaybeSync: Sync {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Sync> MaybeSync for T {}
#[cfg(target_arch = "wasm32")]
pub trait MaybeSync {}
#[cfg(target_arch = "wasm32")]
impl<T> MaybeSync for T {}
