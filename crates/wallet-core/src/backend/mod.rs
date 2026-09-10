//! Chain-data backends. Every backend satisfies the same narrow contract so the
//! wallet never depends on a specific provider (Esplora today; a mock for tests).

use std::collections::BTreeMap;

use bdk_wallet::KeychainKind;
use bdk_wallet::bitcoin::{Transaction, Txid};
use bdk_wallet::chain::spk_client::{FullScanRequest, FullScanResponse, SyncRequest, SyncResponse};
use serde::{Deserialize, Serialize};

use crate::{MaybeSend, MaybeSync, Result};

#[cfg(feature = "backend-esplora")]
pub mod esplora;
/// Test double. Behind `cfg(test)` so it never ships in the wasm binary.
#[cfg(test)]
pub mod mock;

/// How to reach a chain-data provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackendConfig {
    /// Any Esplora-compatible HTTP API (mempool.space, blockstream.info, electrs, bitcoin-rs …).
    Esplora { url: String },
}

/// Fee-rate estimates in sat/vB keyed by confirmation target (blocks).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FeeEstimate {
    pub sat_per_vb_by_target: BTreeMap<u16, f64>,
}

impl FeeEstimate {
    /// Best available rate for `target` blocks: exact target, else the nearest
    /// faster target, else the nearest slower one.
    pub fn for_target(&self, target: u16) -> Option<f64> {
        if let Some(v) = self.sat_per_vb_by_target.get(&target) {
            return Some(*v);
        }
        self.sat_per_vb_by_target
            .range(..target)
            .next_back()
            .or_else(|| self.sat_per_vb_by_target.range(target..).next())
            .map(|(_, v)| *v)
    }
}

/// Provider-neutral chain access used by [`crate::WalletHandle`].
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
pub trait ChainBackend: MaybeSend + MaybeSync {
    /// Discover all history for the keychains in `request`, giving up on a
    /// keychain after `stop_gap` consecutive scripts with no history.
    async fn full_scan(
        &self,
        request: FullScanRequest<KeychainKind>,
        stop_gap: usize,
    ) -> Result<FullScanResponse<KeychainKind>>;
    /// Refresh already-revealed scripts / txids / outpoints.
    async fn sync(&self, request: SyncRequest<(KeychainKind, u32)>) -> Result<SyncResponse>;
    /// Relay a signed transaction.
    async fn broadcast(&self, tx: &Transaction) -> Result<Txid>;
    /// Current fee-rate estimates.
    async fn fee_estimates(&self) -> Result<FeeEstimate>;
    /// Current chain tip height.
    async fn height(&self) -> Result<u32>;
}

/// Instantiate a backend from its configuration.
pub fn connect(config: &BackendConfig) -> Result<Box<dyn ChainBackend>> {
    match config {
        #[cfg(feature = "backend-esplora")]
        BackendConfig::Esplora { url } => Ok(Box::new(esplora::EsploraBackend::new(url)?)),
        #[allow(unreachable_patterns)]
        other => Err(crate::Error::Unsupported(format!(
            "backend not compiled in: {other:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_target_fallback() {
        let mut f = FeeEstimate::default();
        f.sat_per_vb_by_target.insert(1, 10.0);
        f.sat_per_vb_by_target.insert(6, 4.0);
        assert_eq!(f.for_target(6), Some(4.0));
        assert_eq!(f.for_target(3), Some(10.0));
        assert_eq!(f.for_target(20), Some(4.0));
        assert_eq!(FeeEstimate::default().for_target(6), None);
    }

    #[test]
    fn backend_config_serde() {
        let json = r#"{"kind":"esplora","url":"https://x/api"}"#;
        let c: BackendConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            c,
            BackendConfig::Esplora {
                url: "https://x/api".into()
            }
        );
    }
}
