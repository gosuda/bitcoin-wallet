//! Key storage boundary.
//!
//! [`MemoryKeystore`] keeps material for the session only. [`NativeKeystore`]
//! (feature `keystore-native`) stores it in the OS credential store — macOS
//! Keychain, Windows Credential Manager, Secret Service on Linux, iOS Keychain,
//! Android Keystore — so a wallet can be unlocked on later launches without
//! re-entering the key. Browser builds get their own implementation later.
//!
//! Mobile takes a different route to the same place. `keyring`'s `v1` wrapper
//! finds and installs the platform store itself on desktop, but on iOS and
//! Android it refuses to: `Entry::new` short-circuits to `NoDefaultStore`
//! regardless of what store is installed beneath it. So those two platforms
//! skip the wrapper, talk to `keyring_core` directly, and install the store
//! themselves — Keychain Services in `protected` mode on iOS, and on Android
//! SharedPreferences encrypted under an AES/GCM key held in the Android
//! Keystore.
//!
//! That difference is invisible to the compiler: a missing store is a runtime
//! failure on a device that builds perfectly well on CI. [`NativeKeystore::
//! self_check`] exists so the app can find out at startup instead of when a
//! user first presses "Remember".

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

/// Which credential-store API this platform uses, and how it gets installed.
/// See the module docs for why mobile does not go through `keyring`.
#[cfg(all(feature = "keystore-native", not(target_arch = "wasm32")))]
mod backend {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub use keyring::{Entry, Error};
    #[cfg(any(target_os = "ios", target_os = "android"))]
    pub use keyring_core::{Entry, Error};

    /// Installs the platform store. Idempotent, and a no-op on desktop, where
    /// `keyring` installs one on the first `Entry::new`.
    ///
    /// Success is remembered; failure deliberately is not. On Android the store
    /// needs `ndk_context`, which the activity sets up, so an early call can
    /// fail for a reason that has gone away by the next one — caching that
    /// would disable the keychain for the rest of the session.
    pub fn prepare() -> Result<(), String> {
        #[cfg(any(target_os = "ios", target_os = "android"))]
        {
            use std::sync::atomic::{AtomicBool, Ordering};
            static INSTALLED: AtomicBool = AtomicBool::new(false);
            if INSTALLED.load(Ordering::Acquire) {
                return Ok(());
            }
            // Android's store reaches the Keystore through `ndk_context`, which
            // *panics* rather than erroring when no context has been installed
            // — and unwinding out of that panic crosses the JNI boundary. Catch
            // it here and report it as the ordinary failure it is.
            let built = std::panic::catch_unwind(|| {
                #[cfg(target_os = "ios")]
                let store = apple_native_keyring_store::protected::Store::new();
                #[cfg(target_os = "android")]
                let store = android_native_keyring_store::Store::new();
                // The closure is load-bearing: `Arc<Store>` only unsize-coerces
                // to `Arc<dyn CredentialStoreApi>` at a call site, not when the
                // function is passed to `map` by reference.
                store
                    .map(|s| keyring_core::set_default_store(s))
                    .map_err(|e| e.to_string())
            });
            let installed = built.unwrap_or_else(|_| {
                Err("the platform credential store panicked while starting up".to_owned())
            });
            // Two threads racing here both install an equivalent store, and the
            // second simply replaces the first. Harmless.
            if installed.is_ok() {
                INSTALLED.store(true, Ordering::Release);
            }
            installed
        }
        #[cfg(not(any(target_os = "ios", target_os = "android")))]
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

    /// Reports whether the credential store is usable in this process.
    ///
    /// Call it at startup. On iOS and Android the store has to be installed at
    /// runtime and can fail there while compiling cleanly, so without this the
    /// first symptom is a user pressing "Remember" and getting an error.
    ///
    /// On mobile it round-trips a throwaway value, because merely building a
    /// credential proves too little there: the iOS `protected` store only
    /// validates the service and user strings, so an entry constructs happily
    /// on a build whose keychain will reject every read and write for want of
    /// an entitlement. Desktop stops at construction on purpose — writing at
    /// startup on Linux could raise a Secret Service unlock prompt before the
    /// user has asked for anything, and there a failed store install already
    /// surfaces as `NoDefaultStore`.
    pub fn self_check(&self) -> Result<()> {
        backend::prepare().map_err(Error::Persist)?;
        let entry = self.entry("_wallet_core_self_check")?;

        #[cfg(any(target_os = "ios", target_os = "android"))]
        {
            const PROBE: &str = "wallet-core self check";
            entry
                .set_password(PROBE)
                .map_err(|e| Error::Persist(e.to_string()))?;
            let got = entry
                .get_password()
                .map_err(|e| Error::Persist(e.to_string()))?;
            // Best effort: leaving the probe behind is untidy, not unsafe.
            let _ = entry.delete_credential();
            if got != PROBE {
                return Err(Error::Persist(
                    "credential store returned a different value than it stored".into(),
                ));
            }
        }

        let _ = entry;
        Ok(())
    }

    fn entry(&self, wallet_id: &str) -> Result<backend::Entry> {
        backend::prepare().map_err(Error::Persist)?;
        backend::Entry::new(&self.service, wallet_id).map_err(|e| Error::Persist(e.to_string()))
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
            Err(backend::Error::NoEntry) => Ok(None),
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
            Ok(()) | Err(backend::Error::NoEntry) => Ok(()),
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
