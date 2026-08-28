//! Process-wide state: the open wallet and PSBTs awaiting confirmation.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::RwLock;
use wallet_core::WalletHandle;

pub struct PendingTx {
    pub psbt_base64: String,
}

#[derive(Default)]
pub struct AppState {
    pub wallet: RwLock<Option<Arc<WalletHandle>>>,
    pub pending: Mutex<HashMap<String, PendingTx>>,
    counter: AtomicU64,
}

impl AppState {
    /// Snapshot of the open wallet without holding the lock across awaits.
    pub async fn wallet(&self) -> Option<Arc<WalletHandle>> {
        self.wallet.read().await.clone()
    }

    /// Opaque, process-unique id for a pending PSBT.
    pub fn next_psbt_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{t:x}-{n:x}")
    }

    pub fn take_pending(&self, id: &str) -> Option<PendingTx> {
        self.pending.lock().ok()?.remove(id)
    }

    pub fn put_pending(&self, id: String, tx: PendingTx) {
        if let Ok(mut map) = self.pending.lock() {
            map.insert(id, tx);
        }
    }

    pub fn clear_pending(&self) {
        if let Ok(mut map) = self.pending.lock() {
            map.clear();
        }
    }
}
