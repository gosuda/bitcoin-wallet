//! Plain data crossing the IPC boundary. Core types (`Balance`, `Utxo`,
//! `FeeEstimate`, `GeneratedKey`) are re-used directly; these are the extras.

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

#[derive(Debug, Clone, Serialize)]
pub struct WalletInfo {
    pub address: String,
    pub network: Network,
    pub address_type: AddressType,
    pub wallet_id: String,
}

/// Unsigned transaction summary; the PSBT itself stays in Rust under `psbt_id`.
#[derive(Debug, Clone, Serialize)]
pub struct TxPreview {
    pub psbt_id: String,
    pub fee_sat: u64,
    pub vsize: u64,
    pub total_out_sat: u64,
    pub change_sat: u64,
    pub input_count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BroadcastResult {
    pub txid: String,
    pub explorer_url: String,
}
