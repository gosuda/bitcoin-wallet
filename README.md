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

## Rust wallet core (preview)

A portable Rust core is being built alongside the Go toolkit (see issues #1 and #2).
It uses [BDK](https://bitcoindevkit.org) (`bdk_wallet`, `bdk_esplora`) and
runs against any Esplora-compatible HTTP API — mempool.space, blockstream.info, electrs,
[bitcoin-rs](https://github.com/gosuda/bitcoin-rs).

```
crates/wallet-core   # wallet logic: keys, sync, balance, build → sign → broadcast (no UI)
crates/wallet-cli    # `btcw` developer CLI mirroring the TUI flows
apps/desktop         # Tauri v2 desktop app over the same core
```

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
```

Address types: `p2pk`, `p2pkh`, `p2wpkh`, `np2wpkh`, `p2tr`. Networks: `bitcoin`, `testnet3`, `testnet4`, `signet`, `regtest`.
Wallet state is kept in memory unless `--db <file.sqlite>` is given. Keys are never persisted.

### Desktop app
```bash
cd apps/desktop && pnpm install && pnpm tauri dev
```

## Contributing
Contributions are always welcome!  
If you find a bug, have a feature idea, or just want to improve the project, feel free to open an issue or submit a pull request.