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
//! - **watch-only** ([`KeyMaterial::WatchOnly`]): the public half of either —
//!   an account xpub or a public descriptor. It sees balance and history and
//!   can hand out addresses, and it cannot sign.

use std::fmt;

use bdk_wallet::KeychainKind;
use bdk_wallet::bitcoin::hashes::{Hash, hash160};
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
    /// An account xpub or a public descriptor: a wallet that watches and
    /// receives but cannot spend. Kept as the user gave it, so it round-trips
    /// through [`Self::parse`] like the other variants; expansion into
    /// descriptors happens at open time, when the address type is known.
    WatchOnly(String),
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
        if looks_watch_only(trimmed) {
            return KeyMaterial::WatchOnly(trimmed.to_owned());
        }
        let is_hex = trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit());
        if is_hex {
            KeyMaterial::PrivHex(trimmed.to_owned())
        } else {
            KeyMaterial::Wif(trimmed.to_owned())
        }
    }

    /// [`Self::parse`] with a BIP39 passphrase attached.
    ///
    /// The passphrase is part of the wallet's identity: BIP39 mixes it into the
    /// seed, so the same words with a different passphrase derive a different
    /// account — a different address space and a different [`wallet_id`].
    ///
    /// It only means anything for a mnemonic. A passphrase handed in with a hex
    /// or WIF secret is refused rather than dropped, so a caller cannot open a
    /// wallet that quietly ignores half of what the user typed. `None` and an
    /// empty string both mean "no passphrase", and both leave the result
    /// identical to [`Self::parse`].
    pub fn parse_with_passphrase(input: &str, passphrase: Option<&str>) -> Result<Self> {
        let key = Self::parse(input);
        let Some(passphrase) = passphrase.filter(|p| !p.is_empty()) else {
            return Ok(key);
        };
        if key.is_watch_only() {
            return Err(Error::InvalidKey(
                "a passphrase applies only to a BIP39 mnemonic; a watch-only wallet has no seed"
                    .into(),
            ));
        }
        if !key.is_hd() {
            return Err(Error::InvalidKey(
                "a passphrase applies only to a BIP39 mnemonic, not a single private key".into(),
            ));
        }
        Ok(KeyMaterial::Mnemonic {
            words: key.secret(),
            passphrase: Some(passphrase.to_owned()),
        })
    }

    /// Whether this material expands into a BIP32 account (receive + change
    /// keychains) rather than a single key.
    pub fn is_hd(&self) -> bool {
        matches!(self, KeyMaterial::Mnemonic { .. })
    }

    /// Whether this is the public half only: it can watch and receive, not sign.
    pub fn is_watch_only(&self) -> bool {
        matches!(self, KeyMaterial::WatchOnly(_))
    }

    /// The secret as the user supplied it — hex, WIF, or the mnemonic words —
    /// so a caller that stored [`KeyMaterial`] can hand the string back and
    /// have [`Self::parse`] read it the same way again.
    ///
    /// A mnemonic passphrase is not part of this string — it is the separate
    /// [`Self::passphrase`] — so material round-trips exactly through
    /// [`Self::parse`] alone, or through [`Self::parse_with_passphrase`] when
    /// it carries one.
    pub fn secret(&self) -> String {
        match self {
            KeyMaterial::PrivHex(s) | KeyMaterial::Wif(s) | KeyMaterial::WatchOnly(s) => s.clone(),
            KeyMaterial::Mnemonic { words, .. } => words.clone(),
        }
    }

    /// The BIP39 passphrase this material carries, if any. The other half of
    /// [`Self::secret`]: together they round-trip through
    /// [`Self::parse_with_passphrase`] unchanged, which is what stored material
    /// is put back together from.
    pub fn passphrase(&self) -> Option<&str> {
        match self {
            KeyMaterial::Mnemonic { passphrase, .. } => passphrase.as_deref(),
            KeyMaterial::PrivHex(_) | KeyMaterial::Wif(_) | KeyMaterial::WatchOnly(_) => None,
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
            KeyMaterial::WatchOnly(_) => Err(Error::Unsupported(
                "a watch-only wallet has no private key".into(),
            )),
        }
    }
}

/// A descriptor has a function call in it; a bare extended public key is a
/// long base58 string whose second to fourth characters spell `pub`. Nothing
/// a private key or a phrase looks like matches either.
fn looks_watch_only(s: &str) -> bool {
    if s.contains('(') {
        return true;
    }
    s.len() >= 100 && s.get(1..4) == Some("pub") && s.chars().all(|c| c.is_ascii_alphanumeric())
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
    if let KeyMaterial::WatchOnly(source) = key {
        return watch_only_address_at(source, network, address_type, 0);
    }
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
    if let KeyMaterial::WatchOnly(source) = key {
        return watch_only_descriptors(source, address_type);
    }
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

/// Public descriptors from what a watch-only user pasted.
///
/// Three shapes are accepted. A bare account xpub is wrapped in the script
/// type chosen in Setup, receive on `/0/*` and change on `/1/*` — the BIP44
/// family layout every wallet exports. A descriptor with `<0;1>` is split
/// into the two keychains. A descriptor with `/0/*` gets its change twin by
/// substitution. Anything else — a single fixed key, say — is one keychain.
/// A checksum is dropped: it would be wrong for the derived twin, and BDK
/// recomputes it anyway.
fn watch_only_descriptors(source: &str, address_type: AddressType) -> Result<Descriptors> {
    let bare = source.trim().split('#').next().unwrap_or("").to_owned();
    if !bare.contains('(') {
        let (open, close) = match address_type {
            AddressType::P2pkh => ("pkh(", ")"),
            AddressType::NestedP2wpkh => ("sh(wpkh(", "))"),
            AddressType::P2wpkh => ("wpkh(", ")"),
            AddressType::P2tr => ("tr(", ")"),
            AddressType::P2pk => {
                return Err(Error::Unsupported(
                    "p2pk has no account layout to watch; use p2pkh, np2wpkh, p2wpkh or p2tr"
                        .into(),
                ));
            }
        };
        return Ok(Descriptors::Hd {
            external: format!("{open}{bare}/0/*{close}"),
            internal: format!("{open}{bare}/1/*{close}"),
        });
    }
    if bare.contains("<0;1>") {
        return Ok(Descriptors::Hd {
            external: bare.replace("<0;1>", "0"),
            internal: bare.replace("<0;1>", "1"),
        });
    }
    if bare.contains("/0/*") {
        return Ok(Descriptors::Hd {
            internal: bare.replacen("/0/*", "/1/*", 1),
            external: bare,
        });
    }
    Ok(Descriptors::Single(bare))
}

/// Receive address at `index` of a watch-only source.
fn watch_only_address_at(
    source: &str,
    network: Network,
    address_type: AddressType,
    index: u32,
) -> Result<String> {
    let external = match watch_only_descriptors(source, address_type)? {
        Descriptors::Hd { external, .. } | Descriptors::Single(external) => external,
    };
    let (descriptor, _) = ExtendedDescriptor::parse_descriptor(&Secp256k1::new(), &external)
        .map_err(|e| Error::Descriptor(e.to_string()))?;
    descriptor
        .at_derivation_index(index)
        .map_err(|e| Error::Descriptor(e.to_string()))?
        .address(bdk_wallet::bitcoin::Network::from(network))
        .map(|a| a.to_string())
        .map_err(|e| Error::InvalidAddress(e.to_string()))
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
    if let KeyMaterial::WatchOnly(source) = key {
        // Its own id, on purpose. A watch-only copy of an account this device
        // also holds the seed for must not share a keystore entry with it:
        // "remember" would otherwise replace the words with the xpub.
        let external = match watch_only_descriptors(source, address_type)? {
            Descriptors::Hd { external, .. } | Descriptors::Single(external) => external,
        };
        let hash = hash160::Hash::hash(external.as_bytes()).to_string();
        return Ok(format!(
            "{}-{}-watch-{}",
            network.id(),
            address_type.id(),
            &hash[..16]
        ));
    }
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

    /// The passphrase is part of the wallet's identity, and it only belongs to
    /// a mnemonic: attaching one to a single key is refused rather than dropped.
    #[test]
    fn passphrase_only_attaches_to_a_mnemonic() {
        let with_pass = KeyMaterial::parse_with_passphrase(ABANDON, Some("TREZOR")).unwrap();
        assert_eq!(with_pass.secret(), ABANDON);
        assert_eq!(with_pass.passphrase(), Some("TREZOR"));
        // Same words, two wallets: different address space, different id.
        let plain = KeyMaterial::parse_with_passphrase(ABANDON, None).unwrap();
        for t in [
            AddressType::P2pkh,
            AddressType::NestedP2wpkh,
            AddressType::P2wpkh,
            AddressType::P2tr,
        ] {
            assert_ne!(
                address_for_key(&plain, Network::Signet, t).unwrap(),
                address_for_key(&with_pass, Network::Signet, t).unwrap(),
                "{t:?}"
            );
            assert_ne!(
                wallet_id(&plain, Network::Signet, t).unwrap(),
                wallet_id(&with_pass, Network::Signet, t).unwrap(),
                "{t:?}"
            );
        }
        // And two different passphrases are two different wallets again.
        let other = KeyMaterial::parse_with_passphrase(ABANDON, Some("trezor")).unwrap();
        assert_ne!(
            wallet_id(&other, Network::Signet, AddressType::P2wpkh).unwrap(),
            wallet_id(&with_pass, Network::Signet, AddressType::P2wpkh).unwrap()
        );

        // A single key has no seed to mix a passphrase into, so it is an error
        // rather than a wallet that silently ignores what the user typed.
        for secret in [SK1_HEX, "cN9..."] {
            let err = KeyMaterial::parse_with_passphrase(secret, Some("TREZOR")).unwrap_err();
            assert!(matches!(err, Error::InvalidKey(_)), "{err:?}");
            assert!(format!("{err}").contains("mnemonic"), "{err}");
        }

        // No passphrase — absent or empty — leaves the material exactly as
        // `parse` would build it, so no stored wallet moves.
        for passphrase in [None, Some("")] {
            for secret in [SK1_HEX, "cN9...", ABANDON] {
                let key = KeyMaterial::parse_with_passphrase(secret, passphrase).unwrap();
                assert_eq!(key.passphrase(), None);
                assert_eq!(
                    serde_json::to_string(&key).unwrap(),
                    serde_json::to_string(&KeyMaterial::parse(secret)).unwrap()
                );
            }
        }
        assert_eq!(
            wallet_id(
                &KeyMaterial::parse_with_passphrase(ABANDON, Some("")).unwrap(),
                Network::Signet,
                AddressType::P2wpkh
            )
            .unwrap(),
            "signet-p2wpkh-e99b862826a40a32"
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

    /// The public form of ABANDON's BIP84 regtest account, as another wallet
    /// would export it: what a watch-only user pastes.
    fn abandon_public_descriptor() -> String {
        // Straight to the public form: `descriptors_for` would hand back the
        // descriptor with the secret key substituted in, and deriving a public
        // string from that is exactly the shape a leak takes.
        let (descriptor, _) = hd_wallet_descriptor(
            &mnemonic(ABANDON),
            Network::Regtest,
            AddressType::P2wpkh,
            KeychainKind::External,
        )
        .unwrap();
        descriptor.to_string()
    }

    /// The bare account xpub inside [`abandon_public_descriptor`].
    fn abandon_xpub() -> String {
        let (public, _) =
            ExtendedDescriptor::parse_descriptor(&Secp256k1::new(), &abandon_public_descriptor())
                .unwrap();
        let mut xpub = None;
        public.for_each_key(|k| {
            if let DescriptorPublicKey::XPub(x) = k {
                xpub = Some(x.xkey.to_string());
            }
            true
        });
        xpub.expect("an account xpub")
    }

    #[test]
    fn watch_only_derives_the_same_addresses_as_the_seed() {
        let seed = mnemonic(ABANDON);
        let descriptor = abandon_public_descriptor();
        assert!(descriptor.contains("tpub") && !descriptor.contains("tprv"));

        let key = KeyMaterial::parse(&descriptor);
        assert!(key.is_watch_only() && !key.is_hd());
        assert_eq!(key.secret(), descriptor, "kept verbatim, so it round-trips");
        assert_eq!(
            address_for_key(&key, Network::Regtest, AddressType::P2wpkh).unwrap(),
            address_for_key(&seed, Network::Regtest, AddressType::P2wpkh).unwrap()
        );

        // The bare xpub inside it, wrapped by the address type, lands on the
        // same address: origin information does not change derivation.
        let xpub = abandon_xpub();
        let bare = KeyMaterial::parse(&xpub);
        assert!(bare.is_watch_only());
        assert_eq!(
            address_for_key(&bare, Network::Regtest, AddressType::P2wpkh).unwrap(),
            address_for_key(&seed, Network::Regtest, AddressType::P2wpkh).unwrap()
        );
        match descriptors_for(&bare, Network::Regtest, AddressType::P2wpkh).unwrap() {
            Descriptors::Hd { external, internal } => {
                assert_eq!(external, format!("wpkh({xpub}/0/*)"));
                assert_eq!(internal, format!("wpkh({xpub}/1/*)"));
            }
            Descriptors::Single(_) => panic!("an xpub is an account"),
        }
    }

    #[test]
    fn watch_only_shapes_and_refusals() {
        let descriptor = abandon_public_descriptor();
        let checksummed = format!("{}#deadbeef", descriptor.split('#').next().unwrap());
        match descriptors_for(
            &KeyMaterial::parse(&checksummed),
            Network::Regtest,
            AddressType::P2wpkh,
        )
        .unwrap()
        {
            Descriptors::Hd { external, internal } => {
                assert!(!external.contains('#') && external.ends_with("/0/*)"));
                assert!(internal.ends_with("/1/*)"));
            }
            Descriptors::Single(_) => panic!("a ranged descriptor is an account"),
        }
        let multipath = descriptor
            .split('#')
            .next()
            .unwrap()
            .replace("/0/*", "/<0;1>/*");
        match descriptors_for(
            &KeyMaterial::parse(&multipath),
            Network::Regtest,
            AddressType::P2wpkh,
        )
        .unwrap()
        {
            Descriptors::Hd { external, internal } => {
                assert!(external.contains("/0/*") && internal.contains("/1/*"));
            }
            Descriptors::Single(_) => panic!("a multipath descriptor is an account"),
        }
        // A single fixed key watches one address and has no change keychain.
        let single = KeyMaterial::parse(&format!("wpkh({G_HEX})"));
        assert!(matches!(
            descriptors_for(&single, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            Descriptors::Single(_)
        ));
        assert_eq!(
            address_for_key(&single, Network::Bitcoin, AddressType::P2wpkh).unwrap(),
            "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        );

        let key = KeyMaterial::parse(&descriptor);
        assert!(key.to_private_key(Network::Regtest).is_err());
        assert!(KeyMaterial::parse_with_passphrase(&descriptor, Some("x")).is_err());
        // A bare xpub needs a script type to wrap it in, and p2pk has none; a
        // full descriptor already carries its own and ignores the choice.
        assert!(
            descriptors_for(
                &KeyMaterial::parse(&abandon_xpub()),
                Network::Regtest,
                AddressType::P2pk
            )
            .is_err()
        );
        assert!(descriptors_for(&key, Network::Regtest, AddressType::P2pk).is_ok());

        // Its own id, never the full wallet's — see `wallet_id`.
        let watch_id = wallet_id(&key, Network::Regtest, AddressType::P2wpkh).unwrap();
        let seed_id = wallet_id(&mnemonic(ABANDON), Network::Regtest, AddressType::P2wpkh).unwrap();
        assert!(watch_id.starts_with("regtest-p2wpkh-watch-"));
        assert_ne!(watch_id, seed_id);

        // Neither a key nor a phrase is mistaken for one of these.
        assert!(!KeyMaterial::parse(SK1_HEX).is_watch_only());
        assert!(!KeyMaterial::parse(ABANDON).is_watch_only());
    }
}
