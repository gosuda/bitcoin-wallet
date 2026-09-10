# bitcoin-wallet
A Bitcoin wallet with your own keys, independent of custodians. It runs on the
desktop, on iOS and Android, and in a browser tab, from one wallet core and one
frontend.

The maintained implementation is the Rust tree (`crates/`, `apps/`). The original Go
`btctxbuilder` lives under [`reference/go/`](reference/go/) as a behavioral reference
only — it is not extended; use it for parity checks and to recover intended behavior.

Found a security problem? [SECURITY.md](SECURITY.md) says how to report it, and what
this wallet does and does not protect you from.

## What it does

**Open a wallet** three ways: a BIP39 recovery phrase (an HD account, with a
passphrase if you want one), a single private key (hex or WIF), or an xpub or public
descriptor to follow a wallet you cannot spend from. On a phone, a wallet can be
remembered in the OS keychain and reopened with Face ID or the device unlock.

**Receive** on a fresh address each time (single-key wallets have the one address, and
say so). The QR encodes a `bitcoin:` link, with an amount if you ask for one.

**Send** to one recipient on a phone or several on the desktop, with the address and
amount checked as you type, a fee rate from the chain's own estimates or one you pick,
and a review of the exact amount, fee and change before anything is signed. **Max**
asks the core to drain the wallet, so the amount shown is what arrives rather than a
guess. Every transaction signals replaceability, so a stuck payment can be **re-sent at
a higher fee** from either shell.

**Read the chain**: balance with pending broken out, history, and a per-transaction
screen — fee, rate, size, confirmations, inputs and outputs, and a link to an explorer
where one exists. A **rescan** with a wider gap recovers a restored wallet that shows
less than it should, and **public keys** can be exported to pair a watch-only copy
elsewhere.

| | Wallet | Receive | Send | Fee bump |
|---|---|---|---|---|
| P2PKH | ✅ | ✅ | ✅ | ✅ |
| P2WPKH | ✅ | ✅ | ✅ | ✅ |
| NP2WPKH | ✅ | ✅ | ✅ | ✅ |
| P2TR (key path) | ✅ | ✅ | ✅ | ✅ |
| P2PK | ❌ | — | — | — |

P2PK can be generated and printed (`btcw generate -t p2pk`) but cannot back a wallet:
its descriptor is a bare script with no signing context, so the core refuses to open
one. Networks: `bitcoin`, `testnet3`, `testnet4`, `signet`, `regtest` — the phone
offers Signet, Testnet4 and Bitcoin, since regtest wants a node you can reach.

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

**One frontend, two layouts.** The shell picks by viewport, not by build, and both
layouts import the same screens' logic. Desktop is a single dashboard with the wallet,
receive, history and the panels for rescan and public keys, plus its own Send page.
The phone is a tab bar — Wallet, Scan, Settings — over full-screen routes: Wallet,
Receive, Send, Transaction, Export, Settings, and the Setup / Key / Create / Restore /
Unlock flow before a wallet is open. Both bundles are built from the same source and
the desktop bundle contains no phone chunks.

**What the phone shell adds.** Four things need a device and are wired through Tauri
plugins, each behind a capability in `apps/native/src-tauri/capabilities/mobile.json`:

- **Camera** — the Scan tab reads a QR into the Send form (`barcode-scanner`).
- **Biometrics** — a remembered wallet reopens with Face ID or the device unlock
  (`biometric`); the key itself lives in the iOS Keychain or the Android Keystore.
- **`bitcoin:` links** — a payment URI from another app opens Send filled in
  (`deep-link`).
- **Chain requests through Rust** — the webview's `fetch` is replaced so cross-origin
  http(s) goes out through the native HTTP stack (`http`), which is why any
  Esplora endpoint works rather than only the ones that happen to send CORS headers.

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
pnpm --filter @bitcoin-wallet/ui test   # the frontend's pure modules, under vitest
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

The same shell builds for phones. Export the Android toolchain first — any JDK 17+ will
do (Android Studio's bundled JBR and Homebrew's `openjdk@21` both work):

```bash
export JAVA_HOME="$(/usr/libexec/java_home)"   # or Android Studio's bundled JBR
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | tail -1)"

cd apps/native
pnpm tauri ios dev --target aarch64-sim       # iOS Simulator
pnpm tauri android dev                        # Android emulator or device
pnpm tauri ios dev --host                     # a physical iPhone on your network

pnpm tauri android build --debug --apk --target aarch64   # an APK to install by hand
```

The wallet core is WASM inside the webview, not a Tauri command, so a change to
`crates/` needs `wasm-pack` re-run (the command under [Apps](#apps)) before the app
picks it up.

To exercise a funded wallet without a faucet, point Setup at a node you run and mine
into it. `regtest` is not offered on the phone — it wants a node on localhost — but a
private signet is: `bitcoind -signet` with `signetchallenge=51` makes blocks anyone can
mine with `generatetoaddress`, and the emulator reaches the host at `10.0.2.2`.

## The Go reference

`reference/go/` is the original `btctxbuilder` — a transaction-building library and a
TUI, frozen. It is where behaviour came from and what parity is checked against; it is
not built or shipped by anything here, and its own supported-type table does not
describe the Rust wallet.

```bash
cd reference/go && make run
```

## Contributing
Contributions are always welcome!  
If you find a bug, have a feature idea, or just want to improve the project, feel free to open an issue or submit a pull request.