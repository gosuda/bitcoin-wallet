//! Process-wide state. The wallet lives in the webview, so all that is left
//! here is the OS credential store used by the secret commands.

use std::sync::{Arc, OnceLock};

use wallet_core::NativeKeystore;

/// Credential-store namespace; one entry per wallet id underneath it.
const KEYSTORE_SERVICE: &str = "dev.gosuda.bitcoinwallet";

pub struct AppState {
    keystore: Arc<NativeKeystore>,
    keystore_ok: OnceLock<bool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            keystore: Arc::new(NativeKeystore::new(KEYSTORE_SERVICE)),
            keystore_ok: OnceLock::new(),
        }
    }
}

impl AppState {
    /// Shared handle, cheap to clone into the blocking pool.
    pub fn keystore(&self) -> Arc<NativeKeystore> {
        Arc::clone(&self.keystore)
    }

    /// Whether the credential store works here, probed once per launch.
    ///
    /// Cached because the probe writes and reads a throwaway entry on mobile,
    /// and both the startup check and the `keystore_available` command want the
    /// answer — there is no reason to touch the keychain twice for it.
    pub fn keystore_ok(&self) -> bool {
        *self.keystore_ok.get_or_init(|| match self.keystore.self_check() {
            Ok(()) => true,
            Err(e) => {
                eprintln!(
                    "keystore unavailable: {e} — \"Remember on this device\" will not be offered"
                );
                false
            }
        })
    }
}
