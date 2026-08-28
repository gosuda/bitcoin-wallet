//! Plain data crossing the IPC boundary. Only the app configuration is left:
//! wallet types belong to the WASM core in the webview.

use serde::{Deserialize, Serialize};
use wallet_core::{AddressType, BackendConfig, Network};

/// Non-secret, persisted app configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub network: Network,
    pub backend: BackendConfig,
    pub address_type: AddressType,
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
