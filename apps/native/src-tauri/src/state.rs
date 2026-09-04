//! Process-wide state. The wallet lives in the webview, so all that is left
//! here is the OS credential store used by the secret commands.

use std::sync::Arc;

use wallet_core::NativeKeystore;

/// Credential-store namespace; one entry per wallet id underneath it.
const KEYSTORE_SERVICE: &str = "dev.gosuda.bitcoinwallet";

pub struct AppState {
    keystore: Arc<NativeKeystore>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            keystore: Arc::new(NativeKeystore::new(KEYSTORE_SERVICE)),
        }
    }
}

impl AppState {
    /// Shared handle, cheap to clone into the blocking pool.
    pub fn keystore(&self) -> Arc<NativeKeystore> {
        Arc::clone(&self.keystore)
    }
}
