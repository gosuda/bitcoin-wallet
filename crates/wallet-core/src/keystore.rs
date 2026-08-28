//! Key storage boundary.
//!
//! [`MemoryKeystore`] keeps material for the session only. [`NativeKeystore`]
//! (feature `keystore-native`) stores it in the OS credential store — macOS
//! Keychain, Windows Credential Manager, Secret Service on Linux — so a wallet
//! can be unlocked on later launches without re-entering the key. Browser
//! builds get their own implementation later.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::keys::KeyMaterial;
use crate::{Error, Result};

/// Storage for unlock material, keyed by a wallet identifier.
pub trait Keystore: Send + Sync {
    fn load(&self, wallet_id: &str) -> Result<Option<KeyMaterial>>;
    fn store(&self, wallet_id: &str, key: KeyMaterial) -> Result<()>;
    fn remove(&self, wallet_id: &str) -> Result<()>;
}

/// Process-memory keystore; nothing survives the process.
#[derive(Default)]
pub struct MemoryKeystore {
    inner: Mutex<HashMap<String, KeyMaterial>>,
}

impl MemoryKeystore {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, KeyMaterial>>> {
        self.inner
            .lock()
            .map_err(|_| Error::Persist("keystore mutex poisoned".into()))
    }
}

impl Keystore for MemoryKeystore {
    fn load(&self, wallet_id: &str) -> Result<Option<KeyMaterial>> {
        Ok(self.lock()?.get(wallet_id).cloned())
    }

    fn store(&self, wallet_id: &str, key: KeyMaterial) -> Result<()> {
        self.lock()?.insert(wallet_id.to_owned(), key);
        Ok(())
    }

    fn remove(&self, wallet_id: &str) -> Result<()> {
        self.lock()?.remove(wallet_id);
        Ok(())
    }
}

/// OS-credential-store keystore. One entry per wallet id under `service`.
#[cfg(all(feature = "keystore-native", not(target_arch = "wasm32")))]
pub struct NativeKeystore {
    service: String,
}

#[cfg(all(feature = "keystore-native", not(target_arch = "wasm32")))]
impl NativeKeystore {
    /// `service` is the credential-store namespace, e.g. the app identifier.
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, wallet_id: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, wallet_id).map_err(|e| Error::Persist(e.to_string()))
    }
}

#[cfg(all(feature = "keystore-native", not(target_arch = "wasm32")))]
impl Keystore for NativeKeystore {
    fn load(&self, wallet_id: &str) -> Result<Option<KeyMaterial>> {
        match self.entry(wallet_id)?.get_password() {
            Ok(json) => {
                let key = serde_json::from_str(&json).map_err(|e| Error::Persist(e.to_string()))?;
                Ok(Some(key))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Persist(e.to_string())),
        }
    }

    fn store(&self, wallet_id: &str, key: KeyMaterial) -> Result<()> {
        let json = zeroize::Zeroizing::new(
            serde_json::to_string(&key).map_err(|e| Error::Persist(e.to_string()))?,
        );
        self.entry(wallet_id)?
            .set_password(&json)
            .map_err(|e| Error::Persist(e.to_string()))
    }

    fn remove(&self, wallet_id: &str) -> Result<()> {
        match self.entry(wallet_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Persist(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_load_remove() {
        let ks = MemoryKeystore::new();
        assert!(ks.load("a").unwrap().is_none());
        ks.store("a", KeyMaterial::Wif("x".into())).unwrap();
        assert!(matches!(ks.load("a").unwrap(), Some(KeyMaterial::Wif(_))));
        ks.remove("a").unwrap();
        assert!(ks.load("a").unwrap().is_none());
    }

    #[test]
    #[ignore = "touches the OS credential store"]
    #[cfg(all(feature = "keystore-native", not(target_arch = "wasm32")))]
    fn native_roundtrip() {
        let ks = NativeKeystore::new("dev.gosuda.bitcoinwallet.test");
        let id = "wallet-core-test";
        ks.remove(id).unwrap();
        assert!(ks.load(id).unwrap().is_none());
        ks.store(id, KeyMaterial::PrivHex("aa".repeat(32))).unwrap();
        match &ks.load(id).unwrap() {
            Some(KeyMaterial::PrivHex(h)) => assert_eq!(*h, "aa".repeat(32)),
            other => panic!("unexpected {other:?}"),
        }
        ks.remove(id).unwrap();
        assert!(ks.load(id).unwrap().is_none());
    }
}
