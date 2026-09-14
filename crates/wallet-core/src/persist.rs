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

/// Current shape of a persisted changeset on the wire. Bumped only when a
/// change to the envelope or to [`ChangeSet`] itself would stop an older
/// build of this crate from reading a newer record correctly.
pub const STATE_FORMAT: u64 = 1;

/// Serialize a changeset for storage (JSON; stable across native and WASM).
///
/// Wraps the changeset in a small envelope carrying [`STATE_FORMAT`], so a
/// later format change can tell "written by an older build" from
/// "unreadable" instead of just failing to parse.
pub fn changeset_to_json(cs: &ChangeSet) -> Result<String> {
    use serde::Serialize;

    #[derive(Serialize)]
    struct Envelope<'a> {
        v: u64,
        changeset: &'a ChangeSet,
    }

    serde_json::to_string(&Envelope {
        v: STATE_FORMAT,
        changeset: cs,
    })
    .map_err(|e| Error::Persist(e.to_string()))
}

/// Inverse of [`changeset_to_json`]; `None`/empty input yields an empty
/// changeset.
///
/// Reads three shapes: a versioned envelope `{"v": N, "changeset": ...}` at
/// or below [`STATE_FORMAT`]; a bare `ChangeSet` object with no `"v"` key —
/// what every record written before the envelope existed still looks like;
/// or nothing at all. A `"v"` from the future, or JSON that does not parse
/// or does not decode as a changeset, is refused as [`Error::CorruptState`]
/// rather than handed to BDK, which would fail later with a less specific
/// error and no way to tell "written by a newer build" from "actually
/// corrupt".
pub fn changeset_from_json(json: Option<&str>) -> Result<ChangeSet> {
    let json = match json {
        Some(j) if !j.trim().is_empty() => j,
        _ => return Ok(ChangeSet::default()),
    };
    let malformed = || Error::CorruptState {
        reason: "malformed",
        found: None,
        supported: None,
    };
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| malformed())?;
    let record = match value.get("v") {
        Some(v) => {
            let found = v.as_u64().ok_or_else(malformed)?;
            if found > STATE_FORMAT {
                return Err(Error::CorruptState {
                    reason: "future_version",
                    found: Some(found),
                    supported: Some(STATE_FORMAT),
                });
            }
            value.get("changeset").cloned().ok_or_else(malformed)?
        }
        None => value,
    };
    serde_json::from_value(record).map_err(|_| malformed())
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

    #[test]
    fn a_legacy_bare_record_still_loads() {
        // What every record looked like before the envelope existed: the
        // `ChangeSet`'s own JSON with no wrapper at all.
        let bare = serde_json::to_string(&ChangeSet::default()).unwrap();
        assert!(changeset_from_json(Some(&bare)).unwrap().is_empty());
    }

    #[test]
    fn a_v1_envelope_round_trips() {
        let json = changeset_to_json(&ChangeSet::default()).unwrap();
        assert!(json.contains("\"v\":1"), "no envelope in {json}");
        assert!(changeset_from_json(Some(&json)).unwrap().is_empty());
    }

    #[test]
    fn a_future_version_is_refused_with_found_and_supported() {
        let err = changeset_from_json(Some(r#"{"v":2,"changeset":{}}"#)).unwrap_err();
        assert_eq!(err.code(), "corrupt_state");
        let details = err.details().unwrap();
        assert_eq!(details["reason"], "future_version");
        assert_eq!(details["found"], 2);
        assert_eq!(details["supported"], 1);
    }

    #[test]
    fn garbage_is_refused_as_malformed_not_handed_to_bdk() {
        for garbage in [
            "not json",
            "42",
            "[1,2,3]",
            r#"{"v":"not a number"}"#,
            r#"{"v":1}"#,
        ] {
            let err = changeset_from_json(Some(garbage)).unwrap_err();
            assert_eq!(err.code(), "corrupt_state", "input: {garbage}");
        }
    }
}
