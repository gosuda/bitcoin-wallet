//! Key storage boundary.
//!
//! Milestone 1 ships only an in-memory store: the UI supplies key material for
//! the session and it is zeroized on drop. OS-keychain and browser-safe
//! implementations plug in behind the same trait later.

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
}
