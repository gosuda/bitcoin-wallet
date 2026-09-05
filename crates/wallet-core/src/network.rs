//! Network enumeration mapped onto `bitcoin::Network`.

use serde::{Deserialize, Serialize};

use crate::bitcoin;

/// Bitcoin networks supported by the wallet core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Network {
    Bitcoin,
    Testnet3,
    Testnet4,
    Signet,
    Regtest,
}

impl Network {
    /// All networks, in display order.
    pub const ALL: [Network; 5] = [
        Network::Bitcoin,
        Network::Testnet3,
        Network::Testnet4,
        Network::Signet,
        Network::Regtest,
    ];

    /// Stable identifier used in config files and CLI flags.
    pub fn id(self) -> &'static str {
        match self {
            Network::Bitcoin => "bitcoin",
            Network::Testnet3 => "testnet3",
            Network::Testnet4 => "testnet4",
            Network::Signet => "signet",
            Network::Regtest => "regtest",
        }
    }

    /// Parse from [`Network::id`] (also accepts a few common aliases).
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "bitcoin" | "mainnet" | "btc" => Some(Network::Bitcoin),
            "testnet3" | "testnet" | "btc-testnet3" => Some(Network::Testnet3),
            "testnet4" | "btc-testnet4" => Some(Network::Testnet4),
            "signet" | "btc-signet" => Some(Network::Signet),
            "regtest" => Some(Network::Regtest),
            _ => None,
        }
    }

    /// Default public Esplora endpoint for this network (mempool.space).
    pub fn default_esplora_url(self) -> &'static str {
        match self {
            Network::Bitcoin => "https://mempool.space/api",
            Network::Testnet3 => "https://mempool.space/testnet/api",
            Network::Testnet4 => "https://mempool.space/testnet4/api",
            Network::Signet => "https://mempool.space/signet/api",
            Network::Regtest => "http://127.0.0.1:3002",
        }
    }

    /// Block-explorer page for a transaction, on the explorer that fronts the
    /// configured backend when there is one.
    ///
    /// The two public Esplora hosts also run web explorers, so a user pointed
    /// at blockstream.info is sent there rather than to mempool.space. Any other
    /// backend — electrs on a LAN, bitcoin-rs — has no web UI we know of, and
    /// mempool.space is the fallback. Regtest has no public explorer at all:
    /// `None`, and callers hide the link rather than open a dead one.
    pub fn explorer_tx_url(self, backend_url: &str, txid: &str) -> Option<String> {
        let path = match self {
            Network::Bitcoin => "",
            Network::Testnet3 => "/testnet",
            Network::Testnet4 => "/testnet4",
            Network::Signet => "/signet",
            Network::Regtest => return None,
        };
        let host = backend_url
            .split("://")
            .nth(1)
            .unwrap_or(backend_url)
            .split('/')
            .next()
            .unwrap_or("");
        // blockstream.info does not serve testnet4.
        let base = if host == "blockstream.info" && self != Network::Testnet4 {
            "https://blockstream.info"
        } else {
            "https://mempool.space"
        };
        Some(format!("{base}{path}/tx/{txid}"))
    }
}

impl From<Network> for bitcoin::Network {
    fn from(n: Network) -> Self {
        match n {
            Network::Bitcoin => bitcoin::Network::Bitcoin,
            Network::Testnet3 => bitcoin::Network::Testnet,
            Network::Testnet4 => bitcoin::Network::Testnet4,
            Network::Signet => bitcoin::Network::Signet,
            Network::Regtest => bitcoin::Network::Regtest,
        }
    }
}

impl TryFrom<bitcoin::Network> for Network {
    type Error = crate::Error;

    fn try_from(n: bitcoin::Network) -> Result<Self, Self::Error> {
        Ok(match n {
            bitcoin::Network::Bitcoin => Network::Bitcoin,
            bitcoin::Network::Testnet => Network::Testnet3,
            bitcoin::Network::Testnet4 => Network::Testnet4,
            bitcoin::Network::Signet => Network::Signet,
            bitcoin::Network::Regtest => Network::Regtest,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_roundtrip() {
        for n in Network::ALL {
            assert_eq!(Network::parse(n.id()), Some(n));
            let back: Network = bitcoin::Network::from(n).try_into().unwrap();
            assert_eq!(back, n);
        }
    }

    #[test]
    fn go_aliases() {
        assert_eq!(Network::parse("btc"), Some(Network::Bitcoin));
        assert_eq!(Network::parse("btc-testnet4"), Some(Network::Testnet4));
        assert_eq!(Network::parse("nope"), None);
    }

    #[test]
    fn explorer_url_follows_the_backend() {
        let signet = Network::Signet;
        assert_eq!(
            signet
                .explorer_tx_url("https://mempool.space/signet/api", "ab")
                .as_deref(),
            Some("https://mempool.space/signet/tx/ab")
        );
        assert_eq!(
            signet
                .explorer_tx_url("https://blockstream.info/signet/api", "ab")
                .as_deref(),
            Some("https://blockstream.info/signet/tx/ab")
        );
        // An endpoint without a web explorer falls back rather than guessing.
        assert_eq!(
            signet
                .explorer_tx_url("http://electrs.lan:3002", "ab")
                .as_deref(),
            Some("https://mempool.space/signet/tx/ab")
        );
        // blockstream.info has no testnet4.
        assert_eq!(
            Network::Testnet4
                .explorer_tx_url("https://blockstream.info/testnet/api", "ab")
                .as_deref(),
            Some("https://mempool.space/testnet4/tx/ab")
        );
        assert_eq!(
            Network::Regtest.explorer_tx_url("http://127.0.0.1:3002", "ab"),
            None
        );
    }
}
