# bitcoin-wallet
A Bitcoin wallet with your own keys, independent of custodians.

The maintained implementation is the Rust tree (`crates/`, `apps/`). The original Go
`btctxbuilder` lives under [`reference/go/`](reference/go/) as a behavioral reference
only — it is not extended; use it for parity checks and to recover intended behavior.

## Quick Start (reference Go TUI)
```bash
cd reference/go && make run
```

## Features
- Generate addresses
- Build and sign transactions
- Broadcast transactions

## Supported Transaction Types
| Account Type | Generate Account   | Send Transaction |
|--------------|--------------------|------------------|
| P2PK         | ✅                 | ✅              |
| P2PKH        | ✅                 | ✅              |
| P2WPKH       | ✅                 | ✅              |
| NP2WPKH      | ✅                 | ❌              |
| P2TR(Spend)  | ✅                 | ✅              |

## Network Support
- Bitcoin Mainnet
- Bitcoin Testnet3
- Bitcoin Testnet4
- Bitcoin Signet

## Rust wallet core

The maintained implementation. One wallet core, compiled once and reused everywhere:
natively for the CLI and tests, and as WASM in the browser and the Tauri webview.
It uses [BDK](https://bitcoindevkit.org) (`bdk_wallet`, `bdk_esplora`) and runs against
any Esplora-compatible HTTP API — mempool.space, blockstream.info, electrs,
[bitcoin-rs](https://github.com/gosuda/bitcoin-rs).

```
crates/wallet-core   # wallet logic: keys, sync, balance, build → sign → broadcast (no UI, no database)
crates/wallet-wasm   # wasm-bindgen bindings: the same core for browser and Tauri webview
crates/wallet-cli    # `btcw` developer CLI
apps/desktop         # Tauri v2 shell: window, OS keychain — no wallet logic
```

**Persistence.** The core never picks a database: it stages BDK `ChangeSet`s through a
`Persister` the platform supplies. Browser and desktop both use the same IndexedDB store
and the same JSON format; the CLI keeps state in memory. Secrets never go through that
boundary — they live behind `Keystore` (OS keychain on native).

### CLI quick start
```bash
cargo build -p wallet-cli
btcw=target/debug/btcw

$btcw generate -n signet -t p2wpkh                 # new key + address (printed once)
export BTCW_KEY=<priv_hex_or_wif>
$btcw balance -n signet                            # Esplora (mempool.space by default)
$btcw balance -n signet -u https://blockstream.info/signet/api
$btcw send -n signet --to tb1q...:10000 --dry-run  # build + sign, print PSBT
$btcw send -n signet --to tb1q...:10000            # broadcast; fee = 6-block estimate, floor 1 sat/vB
$btcw history -n signet                            # transactions, newest first
$btcw bump -n signet --txid <txid> -f 8            # re-send an unconfirmed tx at a higher fee
```

Address types: `p2pk`, `p2pkh`, `p2wpkh`, `np2wpkh`, `p2tr`. Networks: `bitcoin`, `testnet3`, `testnet4`, `signet`, `regtest`.
Every transaction the wallet builds signals replaceability, so a stuck payment can be re-sent with `bump`.
The CLI keeps wallet state in memory for the run and re-syncs each time; keys are never persisted.

### Tests

```bash
cargo test -p wallet-core          # unit tests, no network
cargo test -p regtest-tests        # end-to-end against a real bitcoind + Esplora
```

`regtest-tests` downloads `bitcoind` and `electrs` on first build (via `bdk_testenv`) and
drives the whole flow — receive, spend, fee bump, reopen from persisted state — so no
faucet or Docker is needed.

### Desktop app
```bash
cd apps/desktop && pnpm install && pnpm tauri dev
```

## Contributing
Contributions are always welcome!  
If you find a bug, have a feature idea, or just want to improve the project, feel free to open an issue or submit a pull request.