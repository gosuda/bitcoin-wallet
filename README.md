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
packages/wallet-ui   # the whole frontend: screens, router, wasm glue, IndexedDB — no platform APIs
apps/native          # Tauri v2 shell: desktop window, iOS and Android — no wallet logic
apps/web             # browser shell: static bundle, keys in memory for the tab
```

**One frontend, two shells.** `packages/wallet-ui` is the app; each shell supplies a
`Platform` (config, remembered-wallet record, key store, clipboard, open-url) and calls
`boot()`. The native shell answers with Tauri IPC and the OS keychain; the browser shell
answers with `localStorage` and reports `canRememberWallet: false`, so "Remember on this
device" is not offered, no key is written anywhere, and the wallet lives only as long as
the tab.

**Persistence.** The core never picks a database: it stages BDK `ChangeSet`s through a
`Persister` the platform supplies. Browser and desktop both use the same IndexedDB store
and the same JSON format; the CLI keeps state in memory. Secrets never go through that
boundary — they live behind `Keystore` (OS keychain on native).

**Single-key or HD.** A private key (hex or WIF) opens a single-address wallet: one key,
one address, and change comes straight back to it. A BIP39 mnemonic opens an HD wallet
instead — a BIP32 account with separate receive and change keychains, so every payment can
be received on a fresh address and change never reuses one. The script type picks the
account layout: BIP44 for `p2pkh`, BIP49 for `np2wpkh`, BIP84 for `p2wpkh`, BIP86 for
`p2tr`, with the coin type following the network (`p2pk` has no HD layout). Both kinds use
the same `WalletHandle`; `is_hd` says which one you have.

### CLI quick start
```bash
cargo build -p wallet-cli
btcw=target/debug/btcw

$btcw generate -n signet -t p2wpkh                 # new key + address (printed once)
$btcw generate -n signet -t p2wpkh --mnemonic      # 12-word BIP39 seed + first address
$btcw generate -n signet --mnemonic --words 24     # 24 words instead
export BTCW_KEY=<priv_hex_or_wif_or_mnemonic>      # quote a mnemonic; `--key -` reads stdin
$btcw address -n signet                            # first receive address, offline
$btcw address -n signet --new                      # HD: sync, then reveal a fresh one
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
Because of that, `address --new` reveals the address after the last one the sync found used.

### Tests

```bash
cargo test -p wallet-core          # unit tests, no network
cargo test -p regtest-tests        # end-to-end against a real bitcoind + Esplora
```

`regtest-tests` downloads `bitcoind` and `electrs` on first build (via `bdk_testenv`) and
drives the whole flow — receive, spend, fee bump, reopen from persisted state, and the HD
account with its separate change keychain — so no faucet or Docker is needed.

### Releases

Installers are built by `.github/workflows/release.yml` — run it by hand to
check the bundles, or push a `v*` tag to attach them to a draft release. Signing
is a matter of adding secrets; see [docs/RELEASING.md](docs/RELEASING.md).

### Apps

Both shells share one pnpm workspace and one lockfile, and both import the WASM core, so
build it first:

```bash
wasm-pack build crates/wallet-wasm --target web --release --out-dir ../../packages/wallet-ui/src/wasm/pkg
pnpm install                                  # from the repo root

cd apps/native && pnpm tauri dev              # desktop, on :14200
cd apps/web    && pnpm dev                    # browser, on :14400
cd apps/web    && pnpm build                  # static bundle in apps/web/dist
```

### iOS and Android

The same shell builds for phones. Export the Android toolchain first — note `JAVA_HOME`
must be Android Studio's bundled JBR, not a system JDK:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | tail -1)"

cd apps/native
pnpm tauri ios dev --target aarch64-sim       # iOS Simulator
pnpm tauri android dev                        # Android emulator or device
pnpm tauri ios dev --host                     # a physical iPhone on your network
```

## Contributing
Contributions are always welcome!  
If you find a bug, have a feature idea, or just want to improve the project, feel free to open an issue or submit a pull request.