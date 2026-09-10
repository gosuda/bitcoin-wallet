//! Esplora HTTP backend (async, rustls).

use std::future::Future;

use bdk_esplora::EsploraAsyncExt;
#[cfg(target_arch = "wasm32")]
use bdk_esplora::esplora_client::Sleeper;
use bdk_esplora::esplora_client::{AsyncClient, Builder, Error as EsploraError};
use bdk_wallet::KeychainKind;
use bdk_wallet::bitcoin::{Transaction, Txid};
use bdk_wallet::chain::spk_client::{FullScanRequest, FullScanResponse, SyncRequest, SyncResponse};

use super::{ChainBackend, FeeEstimate};
use crate::{Error, Result};

const PARALLEL_REQUESTS: usize = 4;
/// Budget for one round trip: broadcast, fee estimates, tip height.
const CALL_DEADLINE_SECS: u64 = 30;
/// Budget for a scan, which is many round trips. The client's own retry
/// backoff on a flapping endpoint (six tries, ~16 s) fits inside it several
/// times over, so this only ever fires on a genuinely hung server.
const SCAN_DEADLINE_SECS: u64 = 180;

/// Bound a backend call in time.
///
/// Both targets need this, for different reasons. Natively reqwest enforces a
/// timeout *per request*, which does not bound a scan: a scan is many requests,
/// and a server answering each one slowly can run past any budget while no
/// single request ever times out. On wasm32 `esplora-client` silently drops the
/// timeout it is given — reqwest cannot abort a `fetch` there — so those builds
/// have no per-request bound at all and a hung endpoint hung the wallet.
///
/// Wrapping the whole call means [`SCAN_DEADLINE_SECS`] is a real budget on
/// every target rather than a comment, and a caller sees the same
/// [`Error::Timeout`] wherever it runs.
#[cfg(not(target_arch = "wasm32"))]
async fn deadline<T>(secs: u64, call: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::time::timeout(std::time::Duration::from_secs(secs), call).await {
        Ok(result) => result,
        Err(_elapsed) => Err(Error::Timeout(secs)),
    }
}

#[cfg(target_arch = "wasm32")]
async fn deadline<T>(secs: u64, call: impl Future<Output = Result<T>>) -> Result<T> {
    use futures_util::future::{Either, select};
    let timer = gloo_timers::future::TimeoutFuture::new((secs * 1000) as u32);
    match select(Box::pin(call), Box::pin(timer)).await {
        Either::Left((result, _)) => result,
        Either::Right(((), _)) => Err(Error::Timeout(secs)),
    }
}

/// Retry/backoff sleeper for the browser: `setTimeout` via gloo. wasm is
/// single-threaded, so wrapping the non-`Send` timer future is sound.
#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Copy)]
pub struct WebSleeper;

#[cfg(target_arch = "wasm32")]
impl Sleeper for WebSleeper {
    type Sleep = send_wrapper::SendWrapper<gloo_timers::future::TimeoutFuture>;

    fn sleep(dur: std::time::Duration) -> Self::Sleep {
        send_wrapper::SendWrapper::new(gloo_timers::future::TimeoutFuture::new(
            dur.as_millis() as u32
        ))
    }
}

#[cfg(not(target_arch = "wasm32"))]
type Client = AsyncClient;
#[cfg(target_arch = "wasm32")]
type Client = AsyncClient<WebSleeper>;

pub struct EsploraBackend {
    client: Client,
}

impl EsploraBackend {
    pub fn new(url: &str) -> Result<Self> {
        // Honoured per request natively; a no-op on wasm32 — see `deadline`.
        let builder = Builder::new(url.trim_end_matches('/')).timeout(CALL_DEADLINE_SECS);
        #[cfg(not(target_arch = "wasm32"))]
        let client = builder
            .build_async()
            .map_err(|e| Error::Backend(e.to_string()))?;
        #[cfg(target_arch = "wasm32")]
        let client = builder
            .build_async_with_sleeper::<WebSleeper>()
            .map_err(|e| Error::Backend(e.to_string()))?;
        Ok(Self { client })
    }
}

/// Map a backend error, keeping "it did not answer in time" distinguishable.
///
/// reqwest reports its own per-request timeout natively. Folding that into a
/// generic `Backend` error gave the same situation two different codes
/// depending on the target, since wasm has only the deadline above and always
/// produced `Timeout`.
fn map_err(e: EsploraError) -> Error {
    if let EsploraError::Reqwest(ref inner) = e
        && inner.is_timeout()
    {
        return Error::Timeout(CALL_DEADLINE_SECS);
    }
    Error::Backend(e.to_string())
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl ChainBackend for EsploraBackend {
    async fn full_scan(
        &self,
        request: FullScanRequest<KeychainKind>,
        stop_gap: usize,
    ) -> Result<FullScanResponse<KeychainKind>> {
        deadline(SCAN_DEADLINE_SECS, async {
            self.client
                .full_scan(request, stop_gap, PARALLEL_REQUESTS)
                .await
                .map_err(|e| map_err(*e))
        })
        .await
    }

    async fn sync(&self, request: SyncRequest<(KeychainKind, u32)>) -> Result<SyncResponse> {
        deadline(SCAN_DEADLINE_SECS, async {
            self.client
                .sync(request, PARALLEL_REQUESTS)
                .await
                .map_err(|e| map_err(*e))
        })
        .await
    }

    async fn broadcast(&self, tx: &Transaction) -> Result<Txid> {
        deadline(CALL_DEADLINE_SECS, async {
            self.client.broadcast(tx).await.map_err(map_err)?;
            Ok(tx.compute_txid())
        })
        .await
    }

    async fn fee_estimates(&self) -> Result<FeeEstimate> {
        deadline(CALL_DEADLINE_SECS, async {
            let map = self.client.get_fee_estimates().await.map_err(map_err)?;
            Ok(FeeEstimate {
                sat_per_vb_by_target: map.into_iter().collect(),
            })
        })
        .await
    }

    async fn height(&self) -> Result<u32> {
        deadline(CALL_DEADLINE_SECS, async {
            self.client.get_height().await.map_err(map_err)
        })
        .await
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    /// The native branch used to be a no-op that returned the future untouched,
    /// so `SCAN_DEADLINE_SECS` bounded nothing off the browser.
    #[tokio::test]
    async fn the_native_deadline_actually_fires() {
        let never = std::future::pending::<Result<()>>();
        let started = std::time::Instant::now();
        let error = deadline(1, never).await.unwrap_err();
        assert!(matches!(error, Error::Timeout(1)), "{error:?}");
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }

    #[tokio::test]
    async fn a_call_inside_the_budget_is_untouched() {
        let ok = async { Ok(7_u8) };
        assert_eq!(deadline(30, ok).await.unwrap(), 7);
    }
}
