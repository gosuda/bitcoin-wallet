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

    /// Block-explorer URL for a transaction id.
    pub fn explorer_tx_url(self, txid: &str) -> String {
        let base = match self {
            Network::Bitcoin => "https://mempool.space",
            Network::Testnet3 => "https://mempool.space/testnet",
            Network::Testnet4 => "https://mempool.space/testnet4",
            Network::Signet => "https://mempool.space/signet",
            Network::Regtest => "http://127.0.0.1:3002",
        };
        format!("{base}/tx/{txid}")
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
}
