//! `btcw` — thin CLI over wallet-core mirroring the Go TUI flows.
//!
//! Secrets are read from `--key`, the `BTCW_KEY` env var, or stdin (`--key -`).
//! A secret is a private key (hex or WIF) for a single-address wallet, or a
//! BIP39 mnemonic — anything with more than one word — for an HD wallet with a
//! separate change keychain. Quote a mnemonic so the shell keeps it in one
//! argument, or pipe it in with `--key -`. A mnemonic's optional BIP39
//! passphrase is `--passphrase` or `BTCW_PASSPHRASE`; the same words without
//! it open a different wallet, not a locked version of this one.
//!
//! On failure the process exits with a code that names the failure class —
//! see [`CliError::exit_code`] — not just 1, so a caller can branch on `$?`
//! instead of matching `stderr`.

use std::io::Read;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use wallet_core::{
    AddressType, BackendConfig, Error, KeyMaterial, MemoryPersister, Network, Recipient,
    WalletConfig, WalletHandle,
};
use zeroize::Zeroizing;

#[derive(Parser)]
#[command(name = "btcw", version, about)]
struct Cli {
    /// Network: bitcoin | testnet3 | testnet4 | signet | regtest
    #[arg(short, long, global = true, default_value = "signet")]
    network: String,
    /// Address type: p2pk | p2pkh | p2wpkh | np2wpkh | p2tr
    #[arg(short = 't', long, global = true, default_value = "p2wpkh")]
    address_type: String,
    /// Emit JSON instead of text
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

/// clap value parser for a secret argument: parsed like a plain string, but
/// zeroized on drop instead of left for the allocator to reclaim later. Does
/// not hide the value from `ps` or shell history — nothing in-process can —
/// only what lingers in memory after `read_key` has consumed it.
fn zeroizing_arg(s: &str) -> Result<Zeroizing<String>, std::convert::Infallible> {
    Ok(Zeroizing::new(s.to_owned()))
}

#[derive(Args, Clone)]
struct BackendArgs {
    /// Esplora base URL (defaults to mempool.space for the network)
    #[arg(short, long)]
    url: Option<String>,
    /// Private key (hex or WIF) or BIP39 mnemonic; "-" reads stdin; falls back to $BTCW_KEY
    ///
    /// On the command line this is visible to anyone who can run `ps` on this
    /// machine while the process is alive, and it lands in shell history
    /// unless the line is prefixed with a space (and history for it is
    /// configured to notice). Prefer `--key -` with the secret on stdin, or
    /// $BTCW_KEY in an env file that is not itself committed.
    #[arg(short, long, value_parser = zeroizing_arg)]
    key: Option<Zeroizing<String>>,
    /// BIP39 passphrase, for a mnemonic key; falls back to $BTCW_PASSPHRASE
    ///
    /// Part of the wallet's identity, not a lock on it: the same words with a
    /// different passphrase open a different wallet. Subject to the same
    /// `ps`/shell-history exposure as --key above.
    #[arg(long, value_parser = zeroizing_arg)]
    passphrase: Option<Zeroizing<String>>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Generate a fresh key, or a BIP39 mnemonic with --mnemonic (Go "newAddress")
    Generate {
        /// Generate a 12/24-word BIP39 mnemonic (HD wallet) instead of one private key
        #[arg(long)]
        mnemonic: bool,
        /// Mnemonic length with --mnemonic: 12 or 24
        #[arg(long, default_value_t = 12)]
        words: u8,
    },
    /// Show a receive address for a key
    Address {
        #[command(flatten)]
        backend: BackendArgs,
        /// Reveal a fresh receive address instead of the first one. Syncs, so
        /// used addresses are skipped. HD only: a single-key wallet has one
        /// address and returns it again.
        #[arg(long)]
        new: bool,
    },
    /// Sync and show balance + UTXOs
    Balance(BackendArgs),
    /// Sync and show transaction history, newest first
    History(BackendArgs),
    /// Re-send an unconfirmed transaction of yours at a higher fee rate
    Bump {
        #[command(flatten)]
        backend: BackendArgs,
        /// Transaction id to replace
        #[arg(long)]
        txid: String,
        /// New fee rate in sat/vB (must beat the original)
        #[arg(short, long)]
        fee_rate: f64,
        /// Build and sign only; print the txid without broadcasting
        #[arg(long)]
        dry_run: bool,
    },
    /// Show fee estimates from the backend
    Fees(BackendArgs),
    /// Show the public descriptors (and the account xpub for an HD wallet):
    /// enough to watch this wallet elsewhere, never enough to spend from it
    Export(BackendArgs),
    /// Build, sign and broadcast a transfer
    Send {
        #[command(flatten)]
        backend: BackendArgs,
        /// Recipients as ADDRESS:SATS (repeatable)
        ///
        /// No short flag: `-t` is already the global `--address-type`.
        #[arg(long = "to", required = true)]
        to: Vec<String>,
        /// Fee rate in sat/vB (default: backend estimate for 6 blocks, floor 1)
        #[arg(short, long)]
        fee_rate: Option<f64>,
        /// Build and sign only; print the PSBT and txid without broadcasting
        #[arg(long)]
        dry_run: bool,
    },
}

/// Everything that can end a run: a CLI-level complaint (bad arguments, no
/// key given) that never reached wallet-core, or an [`Error`] that did.
/// Distinct from a bare `String` so [`CliError::exit_code`] can tell the two
/// apart without re-parsing a message.
#[derive(Debug)]
enum CliError {
    Cli(String),
    Core(Error),
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::Cli(s) => write!(f, "{s}"),
            CliError::Core(e) => write!(f, "{e}"),
        }
    }
}

impl From<String> for CliError {
    fn from(s: String) -> Self {
        CliError::Cli(s)
    }
}

impl From<Error> for CliError {
    fn from(e: Error) -> Self {
        CliError::Core(e)
    }
}

impl CliError {
    /// Stable across runs, so a script can branch on `$?` instead of
    /// matching stderr text. 1 is a CLI-level failure with no code of its
    /// own; every `wallet_core::Error` variant gets its own number, in the
    /// order [`Error::code`] itself documents them.
    fn exit_code(&self) -> u8 {
        let CliError::Core(e) = self else {
            return 1;
        };
        match e {
            Error::InvalidKey(_) => 10,
            Error::InvalidAddress(_) => 11,
            Error::Descriptor(_) => 12,
            Error::Persist(_) => 13,
            Error::Backend(_) => 14,
            Error::Timeout(_) => 15,
            Error::BuildTx(_) => 16,
            Error::InsufficientFunds { .. } => 17,
            Error::InvalidFeeRate(_) => 18,
            Error::Sign(_) => 19,
            Error::Psbt(_) => 20,
            Error::Unsupported(_) => 21,
            Error::Dust { .. } => 22,
            Error::FeeTooLow { .. } => 23,
            Error::NoUtxos => 24,
            Error::InvalidTxid(_) => 25,
            Error::NotReplaceable(_) => 26,
            Error::CorruptState { .. } => 27,
        }
    }
}

fn parse_network(s: &str) -> Result<Network, String> {
    Network::parse(s).ok_or_else(|| format!("unknown network '{s}'"))
}

fn parse_address_type(s: &str) -> Result<AddressType, String> {
    AddressType::parse(s).ok_or_else(|| format!("unknown address type '{s}'"))
}

fn read_key(
    arg: Option<Zeroizing<String>>,
    passphrase: Option<&str>,
) -> Result<KeyMaterial, CliError> {
    let raw: Zeroizing<String> = match arg {
        Some(k) if k.as_str() == "-" => {
            let mut buf = Zeroizing::new(String::new());
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| e.to_string())?;
            buf
        }
        Some(k) => k,
        None => Zeroizing::new(
            std::env::var("BTCW_KEY")
                .map_err(|_| "no key: pass --key or set BTCW_KEY".to_string())?,
        ),
    };
    let env_passphrase = std::env::var("BTCW_PASSPHRASE").ok().map(Zeroizing::new);
    let passphrase = passphrase.or(env_passphrase.as_ref().map(|p| p.as_str()));
    Ok(KeyMaterial::parse_with_passphrase(&raw, passphrase)?)
}

/// The Esplora endpoint in use: the one given, else the network's default.
fn backend_url(network: Network, a: &BackendArgs) -> String {
    a.url
        .clone()
        .unwrap_or_else(|| network.default_esplora_url().to_string())
}

async fn open(
    network: Network,
    address_type: AddressType,
    a: &BackendArgs,
) -> Result<WalletHandle, CliError> {
    let backend = BackendConfig::Esplora {
        url: backend_url(network, a),
    };
    let cfg = WalletConfig {
        network,
        address_type,
        backend,
    };
    let key = read_key(a.key.clone(), a.passphrase.as_ref().map(|p| p.as_str()))?;
    // The CLI keeps wallet state in memory for the run; it re-syncs each time.
    Ok(WalletHandle::open(cfg, &key, Box::new(MemoryPersister::new())).await?)
}

fn parse_recipient(s: &str) -> Result<Recipient, String> {
    let (addr, sats) = s
        .rsplit_once(':')
        .ok_or_else(|| format!("expected ADDRESS:SATS, got '{s}'"))?;
    let amount_sat = sats
        .replace('_', "")
        .parse::<u64>()
        .map_err(|e| format!("bad amount in '{s}': {e}"))?;
    Ok(Recipient {
        address: addr.to_string(),
        amount_sat,
    })
}

async fn run(cli: Cli) -> Result<serde_json::Value, CliError> {
    let network = parse_network(&cli.network)?;
    let address_type = parse_address_type(&cli.address_type)?;
    match cli.cmd {
        Cmd::Generate { mnemonic, words } => {
            if mnemonic {
                let m = wallet_core::generate_mnemonic(network, address_type, words)?;
                return Ok(serde_json::json!({
                    "network": network.id(), "address_type": address_type.id(),
                    "address": m.address, "mnemonic": m.words,
                }));
            }
            let k = wallet_core::generate_key(network, address_type)?;
            Ok(serde_json::json!({
                "network": network.id(), "address_type": address_type.id(),
                "address": k.address, "pub_hex": k.pub_hex, "priv_hex": k.priv_hex, "wif": k.wif,
            }))
        }
        Cmd::Address { backend, new } => {
            if new {
                let w = open(network, address_type, &backend).await?;
                w.sync().await?;
                let address = w.new_address().await?;
                return Ok(serde_json::json!({ "address": address, "hd": w.is_hd() }));
            }
            let key = read_key(backend.key, backend.passphrase.as_ref().map(|p| p.as_str()))?;
            let address = wallet_core::address_for_key(&key, network, address_type)?;
            Ok(serde_json::json!({ "address": address, "hd": key.is_hd() }))
        }
        Cmd::Balance(a) => {
            let w = open(network, address_type, &a).await?;
            w.sync().await?;
            let balance = w.balance().await;
            let utxos = w.list_utxos().await;
            Ok(
                serde_json::json!({ "address": w.address().await, "balance": balance, "spendable": balance.spendable(), "utxos": utxos }),
            )
        }
        Cmd::History(a) => {
            let w = open(network, address_type, &a).await?;
            w.sync().await?;
            Ok(serde_json::json!({ "transactions": w.list_transactions().await }))
        }
        Cmd::Bump {
            backend,
            txid,
            fee_rate,
            dry_run,
        } => {
            let w = open(network, address_type, &backend).await?;
            w.sync().await?;
            let built = w.build_fee_bump(&txid, fee_rate).await?;
            let signed = w.sign(&built.psbt_base64).await?;
            let tx = WalletHandle::extract_tx(&signed)?;
            let new_txid = if dry_run {
                tx.compute_txid().to_string()
            } else {
                w.broadcast(&signed).await?.txid
            };
            Ok(serde_json::json!({
                "replaced": txid, "txid": new_txid, "broadcast": !dry_run,
                "fee_sat": built.fee_sat, "fee_rate_sat_vb": fee_rate, "vsize": tx.vsize(),
                "explorer": network.explorer_tx_url(&backend_url(network, &backend), &new_txid),
            }))
        }
        Cmd::Export(a) => {
            let w = open(network, address_type, &a).await?;
            let d = w.public_descriptors().await;
            Ok(serde_json::json!({
                "wallet_id": w.id(), "watch_only": w.is_watch_only(),
                "external": d.external, "internal": d.internal,
                "account_xpub": d.account_xpub, "fingerprint": d.fingerprint,
            }))
        }
        Cmd::Fees(a) => {
            let w = open(network, address_type, &a).await?;
            let fees = w.estimate_fee().await?;
            Ok(serde_json::json!({
                "height": w.chain_height().await?, "sat_per_vb": fees.sat_per_vb_by_target
            }))
        }
        Cmd::Send {
            backend,
            to,
            fee_rate,
            dry_run,
        } => {
            let recipients = to
                .iter()
                .map(|s| parse_recipient(s))
                .collect::<Result<Vec<_>, _>>()?;
            let w = open(network, address_type, &backend).await?;
            w.sync().await?;
            let rate = match fee_rate {
                Some(r) => r,
                None => w
                    .estimate_fee()
                    .await?
                    .for_target(wallet_core::wallet::DEFAULT_FEE_TARGET)
                    .unwrap_or(wallet_core::wallet::MIN_FEE_RATE_SAT_VB),
            };
            let built = w.build_transfer(&recipients, rate).await?;
            let signed = w.sign(&built.psbt_base64).await?;
            let tx = WalletHandle::extract_tx(&signed)?;
            let (txid, persist_error) = if dry_run {
                (tx.compute_txid().to_string(), None)
            } else {
                let out = w.broadcast(&signed).await?;
                (out.txid, out.persist_error)
            };
            if let Some(err) = &persist_error {
                eprintln!(
                    "warning: transaction was broadcast but local wallet state was not saved: {err}"
                );
            }
            Ok(serde_json::json!({
                "txid": txid, "broadcast": !dry_run, "persist_error": persist_error, "fee_sat": built.fee_sat, "fee_rate_sat_vb": rate,
                "vsize": tx.vsize(), "change_sat": built.change_sat, "inputs": built.input_count,
                "explorer": network.explorer_tx_url(&backend_url(network, &backend), &txid), "psbt": if dry_run { Some(signed) } else { None },
            }))
        }
    }
}

fn print_text(v: &serde_json::Value) {
    match v {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                match v {
                    serde_json::Value::String(s) => println!("{k:<16} {s}"),
                    serde_json::Value::Null => {}
                    other => println!("{k:<16} {other}"),
                }
            }
        }
        other => println!("{other}"),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let json = cli.json;
    match run(cli).await {
        Ok(v) if json => {
            println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            ExitCode::SUCCESS
        }
        Ok(v) => {
            print_text(&v);
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(e.exit_code())
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    use super::*;

    /// clap only checks an argument definition — like two arguments both
    /// claiming the same short flag — the first time that subcommand is
    /// actually parsed, so a broken one can sit unnoticed until someone
    /// finally runs it for real. `debug_assert` forces every subcommand's
    /// definition to be checked right here instead.
    #[test]
    fn every_subcommand_has_a_well_formed_arg_definition() {
        Cli::command().debug_assert();
    }

    const TEST_WORDS: &str = "abandon abandon abandon abandon abandon abandon abandon abandon \
        abandon abandon abandon about";

    #[test]
    fn the_same_words_with_and_without_a_passphrase_derive_different_addresses() {
        let network = Network::parse("regtest").unwrap();
        let address_type = AddressType::parse("p2wpkh").unwrap();
        let plain = KeyMaterial::parse_with_passphrase(TEST_WORDS, None).unwrap();
        let with_passphrase =
            KeyMaterial::parse_with_passphrase(TEST_WORDS, Some("TREZOR")).unwrap();
        let bare = wallet_core::address_for_key(&plain, network, address_type).unwrap();
        let passphrased =
            wallet_core::address_for_key(&with_passphrase, network, address_type).unwrap();
        assert_ne!(bare, passphrased);
    }

    #[test]
    fn read_key_applies_the_passphrase_it_is_given() {
        let plain = read_key(Some(Zeroizing::new(TEST_WORDS.to_string())), None).unwrap();
        let passphrased =
            read_key(Some(Zeroizing::new(TEST_WORDS.to_string())), Some("TREZOR")).unwrap();
        assert_eq!(plain.passphrase(), None);
        assert_eq!(passphrased.passphrase(), Some("TREZOR"));
    }

    /// One instance of every `wallet_core::Error` variant. A table, not a
    /// chain of asserts, so a new variant only needs one new row — and
    /// forgetting the row here is safe: `CliError::exit_code`'s own match is
    /// exhaustive, so the compiler catches a missing *arm* there regardless.
    /// What this table catches is two variants sharing a code by mistake,
    /// which an exhaustive match does not prevent on its own.
    fn one_of_each_core_error() -> Vec<Error> {
        vec![
            Error::InvalidKey("x".into()),
            Error::InvalidAddress("x".into()),
            Error::Descriptor("x".into()),
            Error::Persist("x".into()),
            Error::Backend("x".into()),
            Error::Timeout(30),
            Error::BuildTx("x".into()),
            Error::InsufficientFunds {
                needed_sat: 10,
                available_sat: 5,
            },
            Error::InvalidFeeRate("x".into()),
            Error::Sign("x".into()),
            Error::Psbt("x".into()),
            Error::Unsupported("x".into()),
            Error::Dust { output: 0 },
            Error::FeeTooLow {
                required_sat_vb: Some(2.0),
                required_sat: None,
            },
            Error::NoUtxos,
            Error::InvalidTxid("x".into()),
            Error::NotReplaceable("x".into()),
            Error::CorruptState {
                reason: "mismatch",
                found: None,
                supported: None,
            },
        ]
    }

    #[test]
    fn every_core_error_gets_its_own_exit_code_distinct_from_the_cli_level_one() {
        let codes: Vec<u8> = one_of_each_core_error()
            .into_iter()
            .map(|e| CliError::from(e).exit_code())
            .collect();
        assert!(
            codes.iter().all(|&c| c != 1),
            "a core error's code must not collide with the CLI-level code 1: {codes:?}"
        );
        let mut sorted = codes.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(
            sorted.len(),
            codes.len(),
            "duplicate exit code in {codes:?}"
        );
    }

    #[test]
    fn a_cli_level_error_always_exits_1() {
        assert_eq!(CliError::from("bad args".to_string()).exit_code(), 1);
    }
}
