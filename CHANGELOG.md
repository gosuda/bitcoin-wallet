# Changelog

Notable changes to the wallet, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Numbers in brackets are the
pull requests a change arrived in.

## [Unreleased]

### Added

- `btcw rescan` looks further past the last used address, `btcw tx <txid>` shows one
  transaction in full, and `btcw send --max` sends everything to one address with no change
  left over. (#39)
- The desktop app has a Settings page, opened from the gear in the top bar. It changes the
  network, server or address type (asking first, since that closes the wallet), rescans,
  shows the public keys, and closes or forgets the wallet. Rescan and the public keys moved
  there from the Wallet page. (#39)
- The phone sends to several recipients in one transaction, as the desktop does. Add
  recipient gives each a card of its own, one sat/BTC choice covers them all, and the review
  lists every recipient before the fee and the total. Scanning from Send opens the camera
  there, so the recipients already filled in stay; a scan fills the last empty row. (#39)
- A wallet remembered on this device closes to Unlock after five minutes in the background,
  never in the middle of a sync or a send. Settings changes the time to 1 or 15 minutes, an
  hour, or never. A wallet that is not remembered stays open. (#39)
- A payment stuck in the mempool can be sped up from its detail, with a transaction that
  pays for both, and an unconfirmed send of yours can be cancelled, paying everything back
  to your wallet. Each shows what it will cost before anything is signed. (#39)
- Coins can be frozen, and chosen for a send. The desktop's Unspent outputs card has a tick
  box and a Frozen switch for each coin, and the phone has a Coins screen, opened from
  Settings. A frozen coin stays out of every send, of Max and of the spendable balance until
  it is unfrozen. Send selected opens Send paying from the ticked coins alone, Max included,
  until Let the wallet choose hands the choice back. (#39)
- The browser build can remember a wallet too, behind an app password of your choosing. The
  password encrypts the key (PBKDF2-SHA256 over 600,000 rounds, then AES-GCM, both from
  WebCrypto), and only the encrypted key is kept, in the browser's IndexedDB. Unlock asks
  for the password and says so under the field when it is wrong. The desktop and phone apps
  keep the OS key store and ask for no password. (#39)
- A PSBT made by another wallet or device can be imported from Settings, on the desktop and
  the phone: pasted, loaded from a `.psbt` file on the desktop, or scanned on the phone when
  it fits one QR code. It is described before anything is signed: whose each input is and
  whether it is signed, where each output goes, and the fee. Sign signs the inputs this
  wallet holds keys for, and Broadcast waits until every input is signed; a watch-only
  wallet can broadcast a PSBT signed elsewhere. (#39)

### Fixed

- The phone shows where keyboard focus is on every control: rows and tabs are ringed inside
  their edge, and the primary button in a colour its fill does not hide. Textareas show
  the ring on both shells. (#39)
- The phone's Send shows the Custom fee rate field only when Custom is chosen. (#39)
- A wallet remembered on this device can be opened again after Setup: Setup now continues to
  Unlock when the network chosen there is the wallet's own. Unlock refuses a wallet saved on
  another network, which it used to open against the wrong chain's server. (#39)
- A wallet whose history saved on this device cannot be read can be opened again. Unlock,
  Key, Restore and Create offer to reset this device's history, which deletes only that
  history and keeps the key and the settings; the next sync downloads it back. On Unlock the
  only way out used to be Forget, which deletes the key too. History saved by a newer version
  of the app asks for an update instead. (#39)
- A wallet with a long history can finish its first sync on a slow connection. A scan is no
  longer cut off after 180 s; each request to the server has 30 s instead, so a server that
  stops answering is still caught, and sooner. (#38)
- Reading QR codes on Android no longer needs Google Play Services, or a download before the
  first scan: the barcode model now ships inside the app. (#38)
- Desktop Setup no longer warns about P2PK, which it does not offer. (#38)

## [0.1.0] - 2026-09-29

The first version.

### Added

- **Apps.** A desktop app for macOS, Windows and Linux; an app for iOS 14 and Android 8.0
  (API 26) and later, with a layout of its own; a browser build that holds the key for
  the tab only; and `btcw`, a command-line wallet. (#3, #6, #7)
- **Wallets.** BIP39 recovery phrases of 12 or 24 words, with an optional passphrase and
  a backup check when a wallet is created; single keys, as hex or WIF; and watch-only
  wallets from an xpub or a public descriptor. The address types are P2PKH, P2SH-P2WPKH,
  P2WPKH and P2TR (key path), derived along BIP44, 49, 84 and 86. (#3, #5, #7)
- **Networks.** Bitcoin, testnet4, signet, testnet3 and regtest. The phone offers the
  first three. (#3, #7)
- **Chain data** from an Esplora server of your choice. The desktop and phone apps make
  those requests from Rust, so a server that sends no CORS headers still works there; the
  browser build needs them. (#3, #7)
- **Send.** Several recipients at once (one on the phone); a fee from a 1-, 3- or 6-block
  estimate or a rate of your own; a review of amount, fee, change and size before
  anything is signed; and Max, which spends everything with no change output. Every
  transaction signals replace-by-fee, and one that is stuck can be bumped from the app or
  with `btcw bump`. (#3, #5, #7)
- **Receive.** A fresh address for each request from an HD wallet, as a QR code with an
  optional BIP21 amount. (#5, #7)
- **History.** Transactions with a detail view and an explorer link, a UTXO table on the
  desktop, rescans with a gap of 20, 100 or 500 addresses, and an export of the public
  descriptors and account xpub. (#3, #5, #7)
- **Remember on this device.** The key can be kept in the OS key store — the macOS
  Keychain, Windows Credential Manager, the Secret Service, the iOS Keychain or the
  Android Keystore — and the phone asks for biometrics before reading it back, where the
  device has them. The option is not offered where the key store fails its self-check.
  (#5, #7)
- **On the phone,** QR codes read with the camera, and `bitcoin:` links that open Send
  already filled in. (#7, #36)
- **Accessibility.** Named choice groups that move with the arrow keys, less motion when
  the system asks for it, and numbers and dates in the device's own format. (#35)
- **For developers.** A regtest suite against a real `bitcoind` and `electrs`; a
  `justfile` for the common tasks; and a release workflow that builds every desktop
  installer from a `v*` tag, and signs the macOS, Android and iOS builds once their keys
  are set as repository secrets. (#5, #6, #7, #35, #36)

[Unreleased]: https://github.com/gosuda/bitcoin-wallet/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gosuda/bitcoin-wallet/releases/tag/v0.1.0
