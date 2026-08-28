//! Esplora HTTP backend (async, rustls).

use async_trait::async_trait;
use bdk_esplora::EsploraAsyncExt;
use bdk_esplora::esplora_client::{AsyncClient, Builder};
use bdk_wallet::KeychainKind;
use bdk_wallet::bitcoin::{Transaction, Txid};
use bdk_wallet::chain::spk_client::{FullScanRequest, FullScanResponse, SyncRequest, SyncResponse};

use super::{ChainBackend, FeeEstimate};
use crate::{Error, Result};

const STOP_GAP: usize = 20;
const PARALLEL_REQUESTS: usize = 4;

pub struct EsploraBackend {
    client: AsyncClient,
}

impl EsploraBackend {
    pub fn new(url: &str) -> Result<Self> {
        let client = Builder::new(url.trim_end_matches('/'))
            .timeout(30)
            .build_async()
            .map_err(|e| Error::Backend(e.to_string()))?;
        Ok(Self { client })
    }
}

fn map_err(e: impl std::fmt::Display) -> Error {
    Error::Backend(e.to_string())
}

#[async_trait]
impl ChainBackend for EsploraBackend {
    async fn full_scan(
        &self,
        request: FullScanRequest<KeychainKind>,
    ) -> Result<FullScanResponse<KeychainKind>> {
        self.client
            .full_scan(request, STOP_GAP, PARALLEL_REQUESTS)
            .await
            .map_err(map_err)
    }

    async fn sync(&self, request: SyncRequest<(KeychainKind, u32)>) -> Result<SyncResponse> {
        self.client
            .sync(request, PARALLEL_REQUESTS)
            .await
            .map_err(map_err)
    }

    async fn broadcast(&self, tx: &Transaction) -> Result<Txid> {
        self.client.broadcast(tx).await.map_err(map_err)?;
        Ok(tx.compute_txid())
    }

    async fn fee_estimates(&self) -> Result<FeeEstimate> {
        let map = self.client.get_fee_estimates().await.map_err(map_err)?;
        Ok(FeeEstimate {
            sat_per_vb_by_target: map.into_iter().collect(),
        })
    }

    async fn height(&self) -> Result<u32> {
        self.client.get_height().await.map_err(map_err)
    }
}
