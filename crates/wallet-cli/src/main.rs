//! `btcw` — thin CLI over wallet-core mirroring the Go TUI flows.
//!
//! Secrets are read from `--key`, the `BTCW_KEY` env var, or stdin (`--key -`).

use std::io::Read;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use wallet_core::{
    AddressType, BackendConfig, KeyMaterial, Network, Recipient, WalletConfig, WalletHandle,
};

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

#[derive(Args, Clone)]
struct BackendArgs {
    /// Esplora base URL (defaults to mempool.space for the network)
    #[arg(short, long)]
    url: Option<String>,
    /// SQLite wallet DB path (default: in-memory)
    #[arg(long)]
    db: Option<PathBuf>,
    /// Private key (hex or WIF); "-" reads stdin; falls back to $BTCW_KEY
    #[arg(short, long)]
    key: Option<String>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Generate a fresh key and address (Go "newAddress")
    Generate,
    /// Show the address for a key
    Address(BackendArgs),
    /// Sync and show balance + UTXOs
    Balance(BackendArgs),
    /// Show fee estimates from the backend
    Fees(BackendArgs),
    /// Build, sign and broadcast a transfer
    Send {
        #[command(flatten)]
        backend: BackendArgs,
        /// Recipients as ADDRESS:SATS (repeatable)
        #[arg(short, long = "to", required = true)]
        to: Vec<String>,
        /// Fee rate in sat/vB (default: backend estimate for 6 blocks, floor 1)
        #[arg(short, long)]
        fee_rate: Option<f64>,
        /// Build and sign only; print the PSBT and txid without broadcasting
        #[arg(long)]
        dry_run: bool,
    },
}

fn parse_network(s: &str) -> Result<Network, String> {
    Network::parse(s).ok_or_else(|| format!("unknown network '{s}'"))
}

fn parse_address_type(s: &str) -> Result<AddressType, String> {
    AddressType::parse(s).ok_or_else(|| format!("unknown address type '{s}'"))
}

fn read_key(arg: Option<String>) -> Result<KeyMaterial, String> {
    let raw = match arg {
        Some(k) if k == "-" => {
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| e.to_string())?;
            buf
        }
        Some(k) => k,
        None => std::env::var("BTCW_KEY")
            .map_err(|_| "no key: pass --key or set BTCW_KEY".to_string())?,
    };
    Ok(KeyMaterial::parse(&raw))
}

fn open(
    network: Network,
    address_type: AddressType,
    a: &BackendArgs,
) -> Result<WalletHandle, String> {
    let backend = BackendConfig::Esplora {
        url: a
            .url
            .clone()
            .unwrap_or_else(|| network.default_esplora_url().to_string()),
    };
    let cfg = WalletConfig {
        network,
        address_type,
        backend,
        db_path: a.db.clone(),
    };
    WalletHandle::open(cfg, &read_key(a.key.clone())?).map_err(|e| e.to_string())
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

async fn run(cli: Cli) -> Result<serde_json::Value, String> {
    let network = parse_network(&cli.network)?;
    let address_type = parse_address_type(&cli.address_type)?;
    match cli.cmd {
        Cmd::Generate => {
            let k = wallet_core::generate_key(network, address_type).map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "network": network.id(), "address_type": address_type.id(),
                "address": k.address, "pub_hex": k.pub_hex, "priv_hex": k.priv_hex, "wif": k.wif,
            }))
        }
        Cmd::Address(a) => {
            let key = read_key(a.key)?;
            let address = wallet_core::address_for_key(&key, network, address_type)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "address": address }))
        }
        Cmd::Balance(a) => {
            let w = open(network, address_type, &a)?;
            w.sync().await.map_err(|e| e.to_string())?;
            let balance = w.balance().map_err(|e| e.to_string())?;
            let utxos = w.list_utxos().map_err(|e| e.to_string())?;
            Ok(
                serde_json::json!({ "address": w.address().map_err(|e| e.to_string())?, "balance": balance, "spendable": balance.spendable(), "utxos": utxos }),
            )
        }
        Cmd::Fees(a) => {
            let w = open(network, address_type, &a)?;
            let fees = w.estimate_fee().await.map_err(|e| e.to_string())?;
            Ok(
                serde_json::json!({ "height": w.chain_height().await.map_err(|e| e.to_string())?, "sat_per_vb": fees.sat_per_vb_by_target }),
            )
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
            let w = open(network, address_type, &backend)?;
            w.sync().await.map_err(|e| e.to_string())?;
            let rate = match fee_rate {
                Some(r) => r,
                None => w
                    .estimate_fee()
                    .await
                    .map_err(|e| e.to_string())?
                    .for_target(wallet_core::wallet::DEFAULT_FEE_TARGET)
                    .unwrap_or(wallet_core::wallet::MIN_FEE_RATE_SAT_VB),
            };
            let built = w
                .build_transfer(&recipients, rate)
                .map_err(|e| e.to_string())?;
            let signed = w.sign(&built.psbt_base64).map_err(|e| e.to_string())?;
            let tx = WalletHandle::extract_tx(&signed).map_err(|e| e.to_string())?;
            let (txid, persist_error) = if dry_run {
                (tx.compute_txid().to_string(), None)
            } else {
                let out = w.broadcast(&signed).await.map_err(|e| e.to_string())?;
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
                "explorer": network.explorer_tx_url(&txid), "psbt": if dry_run { Some(signed) } else { None },
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

#[tokio::main]
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
            ExitCode::FAILURE
        }
    }
}
