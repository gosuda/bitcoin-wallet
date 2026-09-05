//! In-memory backend for tests: replays canned responses and records broadcasts.

use std::sync::Mutex;

use bdk_wallet::KeychainKind;
use bdk_wallet::bitcoin::{Transaction, Txid};
use bdk_wallet::chain::spk_client::{FullScanRequest, FullScanResponse, SyncRequest, SyncResponse};

use super::{ChainBackend, FeeEstimate};
use crate::Result;

#[derive(Default)]
pub struct MockBackend {
    pub full_scan_response: Mutex<Option<FullScanResponse<KeychainKind>>>,
    pub sync_response: Mutex<Option<SyncResponse>>,
    pub fee: FeeEstimate,
    pub height: u32,
    pub broadcasts: Mutex<Vec<Transaction>>,
    /// What the wallet last asked a full scan to look past.
    pub last_stop_gap: Mutex<Option<usize>>,
}

impl MockBackend {
    pub fn with_fee(target: u16, sat_per_vb: f64) -> Self {
        let mut fee = FeeEstimate::default();
        fee.sat_per_vb_by_target.insert(target, sat_per_vb);
        Self {
            fee,
            ..Default::default()
        }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl ChainBackend for MockBackend {
    async fn full_scan(
        &self,
        _request: FullScanRequest<KeychainKind>,
        stop_gap: usize,
    ) -> Result<FullScanResponse<KeychainKind>> {
        *self.last_stop_gap.lock().unwrap() = Some(stop_gap);
        Ok(self
            .full_scan_response
            .lock()
            .unwrap()
            .take()
            .unwrap_or_default())
    }

    async fn sync(&self, _request: SyncRequest<(KeychainKind, u32)>) -> Result<SyncResponse> {
        Ok(self
            .sync_response
            .lock()
            .unwrap()
            .take()
            .unwrap_or_default())
    }

    async fn broadcast(&self, tx: &Transaction) -> Result<Txid> {
        self.broadcasts.lock().unwrap().push(tx.clone());
        Ok(tx.compute_txid())
    }

    async fn fee_estimates(&self) -> Result<FeeEstimate> {
        Ok(self.fee.clone())
    }

    async fn height(&self) -> Result<u32> {
        Ok(self.height)
    }
}
