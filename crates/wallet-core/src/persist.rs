//! Portable persistence boundary for public wallet state.
//!
//! The wallet stages BDK [`ChangeSet`]s; a [`Persister`] stores them. The core
//! never chooses a database: the platform supplies one (IndexedDB in the
//! browser and the desktop webview, memory for the CLI and tests). Only public
//! data ever flows through here — keys live behind [`crate::keystore::Keystore`].

use bdk_wallet::ChangeSet;
use bdk_wallet::chain::Merge;

use crate::{Error, MaybeSend, Result};

/// Storage for the wallet's public state as an aggregated [`ChangeSet`].
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
pub trait Persister: MaybeSend {
    /// Load everything stored so far (an empty changeset when nothing is).
    async fn initialize(&mut self) -> Result<ChangeSet>;
    /// Durably record a staged delta. Implementations that keep a single
    /// aggregated record can [`merge`](Merge::merge) it into what they hold.
    async fn persist(&mut self, delta: &ChangeSet) -> Result<()>;
}

/// Serialize a changeset for storage (JSON; stable across native and WASM).
pub fn changeset_to_json(cs: &ChangeSet) -> Result<String> {
    serde_json::to_string(cs).map_err(|e| Error::Persist(e.to_string()))
}

/// Inverse of [`changeset_to_json`]; `None`/empty input yields an empty changeset.
pub fn changeset_from_json(json: Option<&str>) -> Result<ChangeSet> {
    match json {
        Some(j) if !j.trim().is_empty() => {
            serde_json::from_str(j).map_err(|e| Error::Persist(e.to_string()))
        }
        _ => Ok(ChangeSet::default()),
    }
}

/// Keeps the aggregated changeset in memory; state lives only for the session.
#[derive(Default)]
pub struct MemoryPersister {
    full: ChangeSet,
}

impl MemoryPersister {
    pub fn new() -> Self {
        Self::default()
    }

    /// Snapshot of everything persisted so far (e.g. to hand to another persister).
    pub fn snapshot(&self) -> &ChangeSet {
        &self.full
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
impl Persister for MemoryPersister {
    async fn initialize(&mut self) -> Result<ChangeSet> {
        Ok(self.full.clone())
    }

    async fn persist(&mut self, delta: &ChangeSet) -> Result<()> {
        self.full.merge(delta.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip_empty() {
        let cs = changeset_from_json(None).unwrap();
        assert!(cs.is_empty());
        let json = changeset_to_json(&cs).unwrap();
        assert!(changeset_from_json(Some(&json)).unwrap().is_empty());
    }
}
