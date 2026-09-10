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
    /// The probe writes and reads a throwaway entry, which on mobile is real
    /// keychain I/O — slow enough that it does not belong on the thread trying
    /// to put a window on screen, nor on an async worker. It runs on the
    /// blocking pool, and the answer is cached because both the startup prime
    /// and the `keystore_available` command want it.
    pub async fn keystore_ok(&self) -> bool {
        if let Some(known) = self.keystore_ok.get() {
            return *known;
        }
        let keystore = self.keystore();
        let probed = tauri::async_runtime::spawn_blocking(move || match keystore.self_check() {
            Ok(()) => true,
            Err(e) => {
                eprintln!(
                    "keystore unavailable: {e} — \"Remember on this device\" will not be offered"
                );
                false
            }
        })
        .await
        .unwrap_or(false);
        // Two callers racing the first probe each run one — the startup prime
        // and the frontend's first `keystore_available` are exactly that pair.
        // Each probe now uses a credential of its own, so they cannot answer
        // for each other and both reach the same verdict; the stored answer is
        // whichever landed first, at the cost of one extra keychain round trip.
        *self.keystore_ok.get_or_init(|| probed)
    }
}
