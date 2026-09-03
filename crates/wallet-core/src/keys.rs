//! Key material handling: hex / WIF / BIP39 mnemonic parsing, address
//! derivation and descriptor construction.
//!
//! Two shapes of wallet live here:
//!
//! - **single-key** ([`KeyMaterial::PrivHex`], [`KeyMaterial::Wif`]): one
//!   secret, one address, one keychain. Change comes back to that same address.
//! - **HD** ([`KeyMaterial::Mnemonic`]): a BIP39 seed expanded through BDK's
//!   descriptor templates into a BIP32 account with separate receive and change
//!   keychains — BIP44 for p2pkh, BIP49 for np2wpkh, BIP84 for p2wpkh and
//!   BIP86 for p2tr. The coin type follows the network, as the templates define
//!   it (`0'` on mainnet, `1'` everywhere else).

use std::fmt;

use bdk_wallet::KeychainKind;
use bdk_wallet::bitcoin::key::{CompressedPublicKey, Secp256k1};
use bdk_wallet::bitcoin::{Address, NetworkKind, PrivateKey, PublicKey};
use bdk_wallet::descriptor::{ExtendedDescriptor, IntoWalletDescriptor};
use bdk_wallet::keys::bip39::{Language, Mnemonic, WordCount};
use bdk_wallet::keys::{
    DescriptorPublicKey, GeneratableKey, GeneratedKey as BdkGeneratedKey, KeyMap,
};
use bdk_wallet::miniscript::{ForEachKey, Segwitv0};
use bdk_wallet::template::{Bip44, Bip49, Bip84, Bip86};
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
    /// BIP39 English mnemonic with an optional passphrase: an HD wallet.
    Mnemonic {
        words: String,
        passphrase: Option<String>,
    },
}

impl fmt::Debug for KeyMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("KeyMaterial(<redacted>)")
    }
}

impl KeyMaterial {
    /// Auto-detect mnemonic vs hex vs WIF from the input shape. Anything with
    /// more than one whitespace-separated word is taken to be a mnemonic (its
    /// checksum is only verified when the wallet is opened — see
    /// [`validate_mnemonic`] for eager feedback).
    pub fn parse(input: &str) -> Self {
        let trimmed = input.trim();
        if trimmed.split_whitespace().nth(1).is_some() {
            return KeyMaterial::Mnemonic {
                words: normalize_mnemonic(trimmed),
                passphrase: None,
            };
        }
        let is_hex = trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit());
        if is_hex {
            KeyMaterial::PrivHex(trimmed.to_owned())
        } else {
            KeyMaterial::Wif(trimmed.to_owned())
        }
    }

    /// Whether this material expands into a BIP32 account (receive + change
    /// keychains) rather than a single key.
    pub fn is_hd(&self) -> bool {
        matches!(self, KeyMaterial::Mnemonic { .. })
    }

    /// The secret as the user supplied it — hex, WIF, or the mnemonic words —
    /// so a caller that stored [`KeyMaterial`] can hand the string back and
    /// have [`Self::parse`] read it the same way again.
    ///
    /// A mnemonic passphrase is not part of this string; [`Self::parse`] never
    /// sets one, so material that went through it round-trips exactly.
    pub fn secret(&self) -> String {
        match self {
            KeyMaterial::PrivHex(s) | KeyMaterial::Wif(s) => s.clone(),
            KeyMaterial::Mnemonic { words, .. } => words.clone(),
        }
    }

    /// Resolve into a compressed private key for the given network kind.
    ///
    /// Only single-key material has one: a mnemonic is an account, not a key.
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
            KeyMaterial::Mnemonic { .. } => Err(Error::Unsupported(
                "a BIP39 mnemonic is an HD account, not a single private key".into(),
            )),
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

/// Result of [`generate_mnemonic`]. `words` is the backup phrase: it is
/// zeroized on drop and never appears in `Debug`.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct GeneratedMnemonic {
    pub words: String,
    /// First receive address of the account (external keychain, index 0).
    #[zeroize(skip)]
    pub address: String,
}

impl fmt::Debug for GeneratedMnemonic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GeneratedMnemonic")
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

/// Generate a fresh BIP39 mnemonic (English) and the account's first receive
/// address. `word_count` must be 12 or 24.
pub fn generate_mnemonic(
    network: Network,
    address_type: AddressType,
    word_count: u8,
) -> Result<GeneratedMnemonic> {
    let count = match word_count {
        12 => WordCount::Words12,
        24 => WordCount::Words24,
        other => {
            return Err(Error::InvalidKey(format!(
                "word count must be 12 or 24, got {other}"
            )));
        }
    };
    let generated: BdkGeneratedKey<Mnemonic, Segwitv0> =
        Mnemonic::generate((count, Language::English))
            .map_err(|e| Error::InvalidKey(format!("could not generate a mnemonic: {e:?}")))?;
    let words = generated.to_string();
    let key = KeyMaterial::Mnemonic {
        words: words.clone(),
        passphrase: None,
    };
    let address = address_for_key(&key, network, address_type)?;
    Ok(GeneratedMnemonic { words, address })
}

/// Check a BIP39 phrase against the English wordlist and its checksum.
///
/// Meant for restore screens: it tells the user the phrase is wrong before a
/// wallet is opened with it.
pub fn validate_mnemonic(words: &str) -> Result<()> {
    parse_mnemonic(words).map(|_| ())
}

/// Collapse whitespace and fold case, the way BIP39 English phrases are written.
fn normalize_mnemonic(words: &str) -> String {
    words
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_mnemonic(words: &str) -> Result<Mnemonic> {
    let normalized = normalize_mnemonic(words);
    if normalized.is_empty() {
        return Err(Error::InvalidKey("mnemonic is empty".into()));
    }
    Mnemonic::parse_in(Language::English, normalized.as_str())
        .map_err(|e| Error::InvalidKey(format!("invalid mnemonic: {e}")))
}

/// Address for the given key material. For a mnemonic this is the account's
/// first receive address (external keychain, index 0).
pub fn address_for_key(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
) -> Result<String> {
    if key.is_hd() {
        return hd_address_at(key, network, address_type, 0);
    }
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

/// The secret descriptor(s) a wallet is opened with.
pub(crate) enum Descriptors {
    /// One key on one keychain: change comes back to the same address.
    Single(String),
    /// A BIP32 account: receive and change live on separate keychains.
    Hd { external: String, internal: String },
}

/// Descriptors for the given key material — one for a single key, a pair for
/// an HD account.
pub(crate) fn descriptors_for(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
) -> Result<Descriptors> {
    if key.is_hd() {
        return Ok(Descriptors::Hd {
            external: hd_descriptor_string(key, network, address_type, KeychainKind::External)?,
            internal: hd_descriptor_string(key, network, address_type, KeychainKind::Internal)?,
        });
    }
    Ok(Descriptors::Single(descriptor_for(
        key,
        network,
        address_type,
    )?))
}

/// Expand a mnemonic through the BDK descriptor template for `address_type`.
///
/// The template owns the derivation path — purpose from the script type, coin
/// type from the network kind — so no path is spelled out here. The returned
/// descriptor and key map already carry the network kind of `network`.
fn hd_wallet_descriptor(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
    keychain: KeychainKind,
) -> Result<(ExtendedDescriptor, KeyMap)> {
    let KeyMaterial::Mnemonic { words, passphrase } = key else {
        return Err(Error::InvalidKey(
            "HD derivation needs a BIP39 mnemonic".into(),
        ));
    };
    let seed = (parse_mnemonic(words)?, passphrase.clone());
    let kind = NetworkKind::from(bdk_wallet::bitcoin::Network::from(network));
    let secp = Secp256k1::new();
    let built = match address_type {
        AddressType::P2pk => {
            return Err(Error::Unsupported(
                "p2pk has no BIP32 account layout; use p2pkh, np2wpkh, p2wpkh or p2tr with a mnemonic"
                    .into(),
            ));
        }
        AddressType::P2pkh => Bip44(seed, keychain).into_wallet_descriptor(&secp, kind),
        AddressType::NestedP2wpkh => Bip49(seed, keychain).into_wallet_descriptor(&secp, kind),
        AddressType::P2wpkh => Bip84(seed, keychain).into_wallet_descriptor(&secp, kind),
        AddressType::P2tr => Bip86(seed, keychain).into_wallet_descriptor(&secp, kind),
    };
    built.map_err(|e| Error::Descriptor(e.to_string()))
}

fn hd_descriptor_string(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
    keychain: KeychainKind,
) -> Result<String> {
    let (descriptor, keymap) = hd_wallet_descriptor(key, network, address_type, keychain)?;
    Ok(descriptor.to_string_with_secret(&keymap))
}

/// Address at `index` on the external keychain of an HD account.
fn hd_address_at(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
    index: u32,
) -> Result<String> {
    let (descriptor, _) = hd_wallet_descriptor(key, network, address_type, KeychainKind::External)?;
    descriptor
        .at_derivation_index(index)
        .map_err(|e| Error::Descriptor(e.to_string()))?
        .address(bdk_wallet::bitcoin::Network::from(network))
        .map(|a| a.to_string())
        .map_err(|e| Error::InvalidAddress(e.to_string()))
}

/// Hash160 identifier of the account xpub, whose first four bytes are the
/// account fingerprint. Stable for a given mnemonic, network and script type.
fn hd_account_identifier(
    key: &KeyMaterial,
    network: Network,
    address_type: AddressType,
) -> Result<String> {
    let (descriptor, _) = hd_wallet_descriptor(key, network, address_type, KeychainKind::External)?;
    let mut identifier = None;
    descriptor.for_each_key(|k| {
        if identifier.is_none()
            && let DescriptorPublicKey::XPub(xkey) = k
        {
            identifier = Some(xkey.xkey.identifier().to_string());
        }
        true
    });
    identifier.ok_or_else(|| Error::Descriptor("HD descriptor has no extended key".into()))
}

/// Short, non-secret wallet identifier: `<network>-<addrtype>-<16 hex>`.
///
/// For a single key the hex comes from the public key hash; for a mnemonic it
/// comes from the account xpub, so the same seed used with a different script
/// type or network is a different wallet.
pub fn wallet_id(key: &KeyMaterial, network: Network, address_type: AddressType) -> Result<String> {
    let hash = if key.is_hd() {
        hd_account_identifier(key, network, address_type)?
    } else {
        key.to_private_key(network)?
            .public_key(&Secp256k1::new())
            .pubkey_hash()
            .to_string()
    };
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

    /// The BIP39 all-zero-entropy vector, used by BIP84/BIP86 for their own
    /// reference addresses.
    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn mnemonic(words: &str) -> KeyMaterial {
        KeyMaterial::Mnemonic {
            words: words.into(),
            passphrase: None,
        }
    }

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

    /// Adding HD support must not move a single-key wallet: same addresses,
    /// same id, same descriptors.
    #[test]
    fn single_key_wallet_is_unchanged() {
        let key = KeyMaterial::PrivHex(SK1_HEX.into());
        assert_eq!(
            wallet_id(&key, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            "bitcoin-p2wpkh-751e76e8199196d4"
        );
        assert_eq!(
            wallet_id(&key, Network::Regtest, AddressType::P2tr).unwrap(),
            "regtest-p2tr-751e76e8199196d4"
        );
        assert_eq!(
            descriptor_for(&key, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            "wpkh(KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn)"
        );
        assert!(matches!(
            descriptors_for(&key, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            Descriptors::Single(_)
        ));
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
        assert!(matches!(
            KeyMaterial::parse(ABANDON),
            KeyMaterial::Mnemonic { .. }
        ));
        // Ragged whitespace and case are normalized away.
        let parsed = KeyMaterial::parse("  Abandon\tabandon\n ABOUT ");
        let KeyMaterial::Mnemonic { words, passphrase } = &parsed else {
            panic!("expected a mnemonic");
        };
        assert_eq!(words, "abandon abandon about");
        assert_eq!(passphrase.as_deref(), None);

        // Anything parsed comes back out unchanged, so stored material can be
        // re-read without knowing which variant it is.
        for raw in [SK1_HEX, "cN9...", ABANDON] {
            let parsed = KeyMaterial::parse(raw);
            assert_eq!(parsed.secret(), raw);
            assert_eq!(KeyMaterial::parse(&parsed.secret()).secret(), raw);
        }
    }

    /// `KeyMaterial` is written as JSON into the OS credential store, so its
    /// tags are a storage format: entries written before HD support must keep
    /// loading, and the new variant must be readable back.
    #[test]
    fn key_material_json_shape_is_stable() {
        let stored: KeyMaterial =
            serde_json::from_str(&format!(r#"{{"priv_hex":"{SK1_HEX}"}}"#)).unwrap();
        assert_eq!(stored.secret(), SK1_HEX);
        assert!(!stored.is_hd());

        let json = serde_json::to_string(&KeyMaterial::parse(ABANDON)).unwrap();
        assert_eq!(
            json,
            format!(r#"{{"mnemonic":{{"words":"{ABANDON}","passphrase":null}}}}"#)
        );
        let back: KeyMaterial = serde_json::from_str(&json).unwrap();
        assert!(back.is_hd());
        assert_eq!(back.secret(), ABANDON);
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

    /// The reference vectors from BIP84 and BIP86: same seed, same account
    /// layout, same first receive address.
    #[test]
    fn known_bip39_vectors_on_mainnet() {
        let key = mnemonic(ABANDON);
        assert_eq!(
            address_for_key(&key, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
            "BIP84 m/84'/0'/0'/0/0"
        );
        assert_eq!(
            address_for_key(&key, Network::Bitcoin, AddressType::P2tr).unwrap(),
            "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
            "BIP86 m/86'/0'/0'/0/0"
        );
        assert_eq!(
            address_for_key(&key, Network::Bitcoin, AddressType::P2pkh).unwrap(),
            "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
            "BIP44 m/44'/0'/0'/0/0"
        );
        // BIP49 states its vector on testnet, so that is where it is checked.
        assert_eq!(
            address_for_key(&key, Network::Testnet3, AddressType::NestedP2wpkh).unwrap(),
            "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2",
            "BIP49 m/49'/1'/0'/0/0"
        );
    }

    /// The templates take the coin type from the network, so the same seed is a
    /// different account on testnet.
    #[test]
    fn coin_type_follows_the_network() {
        let key = mnemonic(ABANDON);
        let signet = address_for_key(&key, Network::Signet, AddressType::P2wpkh).unwrap();
        assert!(signet.starts_with("tb1q"), "{signet}");
        assert!(
            address_for_key(&key, Network::Regtest, AddressType::P2tr)
                .unwrap()
                .starts_with("bcrt1p")
        );
        assert_ne!(
            signet,
            address_for_key(&key, Network::Bitcoin, AddressType::P2wpkh).unwrap()
        );
    }

    #[test]
    fn passphrase_changes_the_account() {
        let plain = mnemonic(ABANDON);
        let with_pass = KeyMaterial::Mnemonic {
            words: ABANDON.into(),
            passphrase: Some("TREZOR".into()),
        };
        assert_ne!(
            address_for_key(&plain, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            address_for_key(&with_pass, Network::Bitcoin, AddressType::P2wpkh).unwrap()
        );
        assert_ne!(
            wallet_id(&plain, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            wallet_id(&with_pass, Network::Bitcoin, AddressType::P2wpkh).unwrap()
        );
    }

    #[test]
    fn bad_checksum_is_rejected() {
        // Valid words, wrong checksum (last word swapped for another entry).
        let wrong = ABANDON.replace("about", "abandon");
        let err = validate_mnemonic(&wrong).unwrap_err();
        assert!(matches!(err, Error::InvalidKey(_)), "{err:?}");
        assert!(format!("{err}").contains("mnemonic"), "{err}");
        assert!(address_for_key(&mnemonic(&wrong), Network::Bitcoin, AddressType::P2wpkh).is_err());

        assert!(validate_mnemonic("not even close to a mnemonic").is_err());
        assert!(validate_mnemonic("").is_err());
        assert!(validate_mnemonic(ABANDON).is_ok());
        // Case and ragged whitespace are tolerated.
        assert!(validate_mnemonic(&ABANDON.to_uppercase().replace(' ', "  ")).is_ok());
    }

    #[test]
    fn generated_mnemonic_round_trips() {
        for words in [12u8, 24] {
            let generated = generate_mnemonic(Network::Signet, AddressType::P2wpkh, words).unwrap();
            assert_eq!(generated.words.split_whitespace().count(), words as usize);
            validate_mnemonic(&generated.words).unwrap();

            let parsed = KeyMaterial::parse(&generated.words);
            assert!(parsed.is_hd());
            assert_eq!(
                address_for_key(&parsed, Network::Signet, AddressType::P2wpkh).unwrap(),
                generated.address
            );
            assert!(!format!("{generated:?}").contains(&generated.words));
        }
        assert_ne!(
            generate_mnemonic(Network::Signet, AddressType::P2wpkh, 12)
                .unwrap()
                .words,
            generate_mnemonic(Network::Signet, AddressType::P2wpkh, 12)
                .unwrap()
                .words
        );
        assert!(matches!(
            generate_mnemonic(Network::Signet, AddressType::P2wpkh, 15),
            Err(Error::InvalidKey(_))
        ));
    }

    #[test]
    fn p2pk_has_no_hd_layout() {
        assert!(matches!(
            address_for_key(&mnemonic(ABANDON), Network::Bitcoin, AddressType::P2pk),
            Err(Error::Unsupported(_))
        ));
        assert!(matches!(
            descriptors_for(&mnemonic(ABANDON), Network::Bitcoin, AddressType::P2pk),
            Err(Error::Unsupported(_))
        ));
    }

    /// The same network and script type, but a different kind of wallet: the
    /// ids must not collide.
    #[test]
    fn wallet_id_separates_hd_from_single_key() {
        let hd = wallet_id(&mnemonic(ABANDON), Network::Signet, AddressType::P2wpkh).unwrap();
        let single = wallet_id(
            &KeyMaterial::PrivHex(SK1_HEX.into()),
            Network::Signet,
            AddressType::P2wpkh,
        )
        .unwrap();
        assert_ne!(hd, single);
        for id in [&hd, &single] {
            let (prefix, hash) = id.rsplit_once('-').unwrap();
            assert_eq!(prefix, "signet-p2wpkh");
            assert_eq!(hash.len(), 16);
            assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        }
        // Stable across calls, and distinct per script type and network.
        // Wallet ids key persistence and the OS keychain, so the HD one is
        // pinned: changing the scheme orphans every stored wallet.
        assert_eq!(hd, "signet-p2wpkh-e99b862826a40a32");
        let other_type = wallet_id(&mnemonic(ABANDON), Network::Signet, AddressType::P2tr).unwrap();
        assert_ne!(
            hd.rsplit_once('-').unwrap().1,
            other_type.rsplit_once('-').unwrap().1
        );
    }

    /// Both keychains build, and the change keychain is a different branch.
    #[test]
    fn hd_descriptors_cover_both_keychains() {
        let key = mnemonic(ABANDON);
        let Descriptors::Hd { external, internal } =
            descriptors_for(&key, Network::Regtest, AddressType::P2wpkh).unwrap()
        else {
            panic!("a mnemonic must produce HD descriptors");
        };
        // Regtest is a test network, so BIP84 coin type 1', and the two
        // keychains are the `0` and `1` branches of the same account.
        assert!(external.contains("tprv"), "{external}");
        assert!(external.contains("/84'/1'/0'/0/*"), "{external}");
        assert!(internal.contains("/84'/1'/0'/1/*"), "{internal}");
        assert_ne!(external, internal);

        let wallet = bdk_wallet::Wallet::create(external, internal)
            .network(bdk_wallet::bitcoin::Network::Regtest)
            .create_wallet_no_persist()
            .expect("HD descriptors open a BDK wallet");
        // `73c5da0a` is the published master fingerprint of this seed, so the
        // origin proves the account really is m/84'/1'/0' of it.
        assert!(
            wallet
                .public_descriptor(KeychainKind::External)
                .to_string()
                .contains("[73c5da0a/84'/1'/0']"),
            "{}",
            wallet.public_descriptor(KeychainKind::External)
        );
    }
}
