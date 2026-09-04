//! Plain data crossing the IPC boundary: the app configuration, and what the
//! keystore hands back. Wallet types belong to the WASM core in the webview.

use std::fmt;

use serde::{Deserialize, Serialize};
use wallet_core::{AddressType, BackendConfig, Network};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Non-secret, persisted app configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub network: Network,
    pub backend: BackendConfig,
    pub address_type: AddressType,
}

/// What the OS keystore held for a wallet: the secret the user supplied, and
/// the BIP39 passphrase that was stored with it.
///
/// The two travel together because they are one wallet's identity — the words
/// alone open a *different* wallet. Both are secret: zeroized on drop, redacted
/// in `Debug`, and never logged.
#[derive(Clone, Serialize, Zeroize, ZeroizeOnDrop)]
pub struct StoredSecret {
    pub secret: String,
    pub passphrase: Option<String>,
}

impl fmt::Debug for StoredSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("StoredSecret(<redacted>)")
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        let network = Network::Signet;
        Self {
            network,
            backend: BackendConfig::Esplora {
                url: network.default_esplora_url().to_owned(),
            },
            address_type: AddressType::P2wpkh,
        }
    }
}
