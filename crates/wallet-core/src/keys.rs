//! Single-key material handling: hex / WIF parsing, address derivation and
//! descriptor construction.

use std::fmt;

use bdk_wallet::bitcoin::key::{CompressedPublicKey, Secp256k1};
use bdk_wallet::bitcoin::{Address, NetworkKind, PrivateKey, PublicKey};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::network::Network;
use crate::{Error, Result};

/// Output script types supported for a single-key wallet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddressType {
    /// Bare pay-to-pubkey. Kept for parity; most indexers do not track it.
    P2pk,
    P2pkh,
    P2wpkh,
    NestedP2wpkh,
    P2tr,
}

impl AddressType {
    pub const ALL: [AddressType; 5] = [
        AddressType::P2pk,
        AddressType::P2pkh,
        AddressType::P2wpkh,
        AddressType::NestedP2wpkh,
        AddressType::P2tr,
    ];

    pub fn id(self) -> &'static str {
        match self {
            AddressType::P2pk => "p2pk",
            AddressType::P2pkh => "p2pkh",
            AddressType::P2wpkh => "p2wpkh",
            AddressType::NestedP2wpkh => "np2wpkh",
            AddressType::P2tr => "p2tr",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "p2pk" => Some(AddressType::P2pk),
            "p2pkh" => Some(AddressType::P2pkh),
            "p2wpkh" => Some(AddressType::P2wpkh),
            "np2wpkh" | "p2sh-p2wpkh" | "nested" => Some(AddressType::NestedP2wpkh),
            "p2tr" | "taproot" => Some(AddressType::P2tr),
            _ => None,
        }
    }

    /// Whether ordinary backends can discover funds sent to this script type.
    pub fn is_indexable(self) -> bool {
        !matches!(self, AddressType::P2pk)
    }
}

/// Secret key material as supplied by the user. Zeroized on drop; `Debug` is redacted.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "snake_case")]
pub enum KeyMaterial {
    /// 32-byte secret key as 64 hex characters.
    PrivHex(String),
    /// Wallet-import-format string.
    Wif(String),
}

impl fmt::Debug for KeyMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("KeyMaterial(<redacted>)")
    }
}

impl KeyMaterial {
    /// Auto-detect hex vs WIF from the input shape.
    pub fn parse(input: &str) -> Self {
        let trimmed = input.trim();
        let is_hex = trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit());
        if is_hex {
            KeyMaterial::PrivHex(trimmed.to_owned())
        } else {
            KeyMaterial::Wif(trimmed.to_owned())
        }
    }

    /// Resolve into a compressed private key for the given network kind.
    pub fn to_private_key(&self, network: Network) -> Result<PrivateKey> {
        let kind = NetworkKind::from(bdk_wallet::bitcoin::Network::from(network));
        match self {
            KeyMaterial::PrivHex(h) => {
                let bytes = hex::decode(h.trim()).map_err(|e| Error::InvalidKey(e.to_string()))?;
                PrivateKey::from_slice(&bytes, kind).map_err(|e| Error::InvalidKey(e.to_string()))
            }
            KeyMaterial::Wif(w) => {
                let pk =
                    PrivateKey::from_wif(w.trim()).map_err(|e| Error::InvalidKey(e.to_string()))?;
                if pk.network != kind {
                    return Err(Error::InvalidKey(format!(
                        "WIF is for {:?} but wallet network is {}",
                        pk.network,
                        network.id()
                    )));
                }
                if !pk.compressed {
                    return Err(Error::InvalidKey(
                        "uncompressed WIF keys are not supported".into(),
                    ));
                }
                Ok(pk)
            }
        }
    }
}

/// Result of [`generate_key`]: the only place secret material is returned to callers.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct GeneratedKey {
    pub priv_hex: String,
    pub wif: String,
    #[zeroize(skip)]
    pub pub_hex: String,
    #[zeroize(skip)]
    pub address: String,
}

impl fmt::Debug for GeneratedKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GeneratedKey")
            .field("pub_hex", &self.pub_hex)
            .field("address", &self.address)
            .finish_non_exhaustive()
    }
}

/// Generate a fresh random key and its address (Go TUI "newAddress" parity).
pub fn generate_key(network: Network, address_type: AddressType) -> Result<GeneratedKey> {
    let kind = NetworkKind::from(bdk_wallet::bitcoin::Network::from(network));
    let sk = PrivateKey::generate(kind);
    let pubkey = sk.public_key(&Secp256k1::new());
    Ok(GeneratedKey {
        priv_hex: hex::encode(sk.to_bytes()),
        wif: sk.to_wif(),
        pub_hex: pubkey.to_string(),
        address: address_string(&pubkey, network, address_type)?,
    })
}

/// Address for the given key material.
pub fn address_for_key(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
) -> Result<String> {
    let sk = key.to_private_key(network)?;
    let pubkey = sk.public_key(&Secp256k1::new());
    address_string(&pubkey, network, address_type)
}

/// Encode an address for the public key. P2PK has no address encoding, so the
/// compressed public key hex is returned instead.
pub fn address_string(
    pubkey: &PublicKey,
    network: Network,
    address_type: AddressType,
) -> Result<String> {
    let net = bdk_wallet::bitcoin::Network::from(network);
    let compressed =
        CompressedPublicKey::try_from(*pubkey).map_err(|e| Error::InvalidKey(e.to_string()))?;
    let addr = match address_type {
        AddressType::P2pk => return Ok(pubkey.to_string()),
        AddressType::P2pkh => Address::p2pkh(pubkey, net),
        AddressType::P2wpkh => Address::p2wpkh(&compressed, net),
        AddressType::NestedP2wpkh => Address::p2shwpkh(&compressed, net),
        AddressType::P2tr => {
            let (xonly, _) = pubkey.inner.x_only_public_key();
            Address::p2tr(&Secp256k1::new(), xonly, None, net)
        }
    };
    Ok(addr.to_string())
}

/// Build the (secret) BDK descriptor string for a single key.
pub(crate) fn descriptor_for(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
) -> Result<String> {
    let wif = key.to_private_key(network)?.to_wif();
    Ok(match address_type {
        AddressType::P2pk => format!("pk({wif})"),
        AddressType::P2pkh => format!("pkh({wif})"),
        AddressType::P2wpkh => format!("wpkh({wif})"),
        AddressType::NestedP2wpkh => format!("sh(wpkh({wif}))"),
        AddressType::P2tr => format!("tr({wif})"),
    })
}

/// Short, non-secret wallet identifier derived from the public key.
pub fn wallet_id(key: &KeyMaterial, network: Network, address_type: AddressType) -> Result<String> {
    let pubkey = key.to_private_key(network)?.public_key(&Secp256k1::new());
    let hash = pubkey.pubkey_hash().to_string();
    Ok(format!(
        "{}-{}-{}",
        network.id(),
        address_type.id(),
        &hash[..16]
    ))
}

/// Extract the public key from a bare `<pubkey> OP_CHECKSIG` script.
pub(crate) fn pubkey_from_p2pk_script(script: &bdk_wallet::bitcoin::Script) -> Option<String> {
    script.p2pk_public_key().map(|pk| pk.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Well-known test vector: secret key 1 (compressed pubkey = generator point).
    const SK1_HEX: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const G_HEX: &str = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    #[test]
    fn hex_and_wif_agree() {
        let hex_key = KeyMaterial::PrivHex(SK1_HEX.into());
        let wif = hex_key.to_private_key(Network::Signet).unwrap().to_wif();
        let wif_key = KeyMaterial::Wif(wif);
        for t in AddressType::ALL {
            assert_eq!(
                address_for_key(&hex_key, Network::Signet, t).unwrap(),
                address_for_key(&wif_key, Network::Signet, t).unwrap()
            );
        }
    }

    #[test]
    fn known_addresses_for_secret_one() {
        let key = KeyMaterial::PrivHex(SK1_HEX.into());
        assert_eq!(
            address_for_key(&key, Network::Bitcoin, AddressType::P2pk).unwrap(),
            G_HEX
        );
        assert_eq!(
            address_for_key(&key, Network::Bitcoin, AddressType::P2pkh).unwrap(),
            "1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH"
        );
        assert_eq!(
            address_for_key(&key, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        );
        assert!(
            address_for_key(&key, Network::Testnet3, AddressType::P2wpkh)
                .unwrap()
                .starts_with("tb1q")
        );
        assert!(
            address_for_key(&key, Network::Testnet4, AddressType::P2tr)
                .unwrap()
                .starts_with("tb1p")
        );
        assert!(
            address_for_key(&key, Network::Regtest, AddressType::P2wpkh)
                .unwrap()
                .starts_with("bcrt1q")
        );
        assert!(
            address_for_key(&key, Network::Bitcoin, AddressType::NestedP2wpkh)
                .unwrap()
                .starts_with('3')
        );
    }

    #[test]
    fn wif_network_mismatch_rejected() {
        let mainnet_wif = KeyMaterial::PrivHex(SK1_HEX.into())
            .to_private_key(Network::Bitcoin)
            .unwrap()
            .to_wif();
        assert!(
            KeyMaterial::Wif(mainnet_wif)
                .to_private_key(Network::Signet)
                .is_err()
        );
    }

    #[test]
    fn parse_detects_shape() {
        assert!(matches!(
            KeyMaterial::parse(SK1_HEX),
            KeyMaterial::PrivHex(_)
        ));
        assert!(matches!(KeyMaterial::parse("cN9..."), KeyMaterial::Wif(_)));
    }

    #[test]
    fn generate_is_valid_and_random() {
        let a = generate_key(Network::Signet, AddressType::P2wpkh).unwrap();
        let b = generate_key(Network::Signet, AddressType::P2wpkh).unwrap();
        assert_ne!(a.priv_hex, b.priv_hex);
        let derived = address_for_key(
            &KeyMaterial::PrivHex(a.priv_hex.clone()),
            Network::Signet,
            AddressType::P2wpkh,
        )
        .unwrap();
        assert_eq!(derived, a.address);
        assert!(!format!("{a:?}").contains(&a.priv_hex));
    }

    #[test]
    fn descriptors_parse_in_bdk() {
        let key = KeyMaterial::PrivHex(SK1_HEX.into());
        for t in AddressType::ALL {
            let d = descriptor_for(&key, Network::Signet, t).unwrap();
            bdk_wallet::Wallet::create_single(d)
                .network(bdk_wallet::bitcoin::Network::Signet)
                .create_wallet_no_persist()
                .unwrap_or_else(|e| panic!("{t:?}: {e}"));
        }
    }
}
