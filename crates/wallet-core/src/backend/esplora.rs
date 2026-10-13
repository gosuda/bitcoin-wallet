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
/// Budget for one round trip: broadcast, fee estimates, tip height — and for
/// each request of a scan.
const CALL_DEADLINE_SECS: u64 = 30;
/// Maximum wall-clock time for one scan, including all requests and retries.
const SCAN_DEADLINE_SECS: u64 = 30 * 60;

// The configured Esplora server is untrusted for resource usage. The patched
// client limits each response before buffering, total scan bytes, pages and
// transactions, and detects repeated pagination cursors. A separate scan
// deadline caps endless but individually timely requests. Per-request timeouts
// remain useful for individual hangs; neither limit replaces the other.

/// Bound a single backend call in time.
///
/// On wasm32 `esplora-client` drops the timeout it is given, so without this a
/// hung endpoint hung the wallet wherever the shell had not bounded the request
/// itself. Natively it also bounds the client's retries, each of which gets
/// reqwest's per-request timeout afresh, and a caller sees the same
/// [`Error::Timeout`] on every target.
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
    if let EsploraError::ResourceLimit(reason) = &e {
        return Error::ResourceLimit((*reason).to_owned());
    }
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
        let client = self.client.for_scan();
        deadline(SCAN_DEADLINE_SECS, async {
            client
                .full_scan(request, stop_gap, PARALLEL_REQUESTS)
                .await
                .map_err(|e| map_err(*e))
        })
        .await
    }

    async fn sync(&self, request: SyncRequest<(KeychainKind, u32)>) -> Result<SyncResponse> {
        let client = self.client.for_scan();
        deadline(SCAN_DEADLINE_SECS, async {
            client
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

// Each target has its own `deadline`, so each test runs on both: under tokio
// natively, and in Node through `wasm-pack test --node` for wasm32.
#[cfg(test)]
mod tests {
    use super::*;

    /// The native branch used to be a no-op that returned the future untouched,
    /// so a single call was bounded nowhere but the browser. There, this race
    /// is the only bound a hung endpoint meets unless the shell sets one.
    #[cfg_attr(not(target_arch = "wasm32"), tokio::test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    async fn the_deadline_actually_fires() {
        let never = std::future::pending::<Result<()>>();
        // `std`'s clock panics on wasm32; this one reads `performance.now()`.
        let started = web_time::Instant::now();
        let error = deadline(1, never).await.unwrap_err();
        assert!(matches!(error, Error::Timeout(1)), "{error:?}");
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }

    #[cfg_attr(not(target_arch = "wasm32"), tokio::test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    async fn a_call_inside_the_budget_is_untouched() {
        let ok = async { Ok(7_u8) };
        assert_eq!(deadline(30, ok).await.unwrap(), 7);
    }

    #[test]
    fn a_resource_limit_stays_distinct_from_backend_errors() {
        let error = map_err(EsploraError::ResourceLimit("scan page budget exceeded"));
        assert!(matches!(
            &error,
            Error::ResourceLimit(message) if message == "scan page budget exceeded"
        ));
        assert_eq!(error.code(), "resource_limit");
    }

    /// The server lies about the size and sends no body. The limit must
    /// reject its headers without reading or allocating the advertised bytes.
    #[cfg(not(target_arch = "wasm32"))]
    #[tokio::test]
    async fn an_oversized_body_is_rejected_before_it_is_buffered() {
        use std::io::Write;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 16777217\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });

        let backend = EsploraBackend::new(&url).unwrap();
        let error = backend.height().await.unwrap_err();
        assert!(matches!(
            &error,
            Error::ResourceLimit(message) if message == "response body exceeds 16 MiB"
        ));
        server.join().unwrap();
    }
}
