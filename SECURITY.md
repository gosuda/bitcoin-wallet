# Security

This is a wallet: a bug here can cost someone their money. Please report problems
rather than opening them as public issues.

## Reporting a vulnerability

Use GitHub's private reporting — **Security → Advisories → Report a vulnerability** on
[this repository](https://github.com/gosuda/bitcoin-wallet/security/advisories/new).
It is private to the maintainers until an advisory is published.

Please include what an attacker gets, the steps to reproduce, and the commit or release
you saw it on. A failing test or a transcript against `regtest` is worth more than a
description.

Expect an acknowledgement within a few days. There is no bounty, and no fixed
disclosure deadline: we would rather agree one with you than promise a number we cannot
keep. If a fix is going to take a while, we will say so.

If GitHub advisories are not an option for you, open an issue saying only that you have
a security report and how to reach you — no details.

## What is in scope

Anything that could lose or expose funds, or make the wallet lie about them:

- key material read, written, logged or transmitted anywhere it should not be
- a transaction that spends more, or somewhere other, than the review screen said
- balances, history or confirmations reported wrongly in a way that changes a decision
- a remembered wallet unlocked by someone who should not be able to
- an Esplora endpoint, a `bitcoin:` link, a scanned QR or a pasted descriptor that can
  drive the app into a state the user did not ask for
- dependency advisories that actually reach shipped code — see the note on
  `deny.toml` below

## What is not

- **The Go reference.** `reference/go/` is frozen and ships in nothing. Parity bugs
  there are ordinary issues.
- **The chain backend you point it at.** The wallet trusts the Esplora endpoint in
  Setup for chain data; a hostile one can lie about balances and history. That is the
  trust model, not a flaw. Run your own if it matters
  ([bitcoin-rs](https://github.com/gosuda/bitcoin-rs), electrs, mempool.space's own
  source).
- **Anything requiring an attacker who already has the device unlocked**, or root, or
  the keychain.
- **Third-party advisories with no path to shipped code.** The exceptions are in
  [`deny.toml`](deny.toml), each with the reason it cannot be exploited through the
  wallet. Any other vulnerability anywhere in the dependency graph fails CI, as does an
  unmaintained or unsound notice on a crate this workspace depends on directly. If you
  can show a path we missed, that is in scope.

## Where the keys are

- **Native (desktop, iOS, Android).** "Remember on this device" writes the key to the
  OS credential store — macOS Keychain, Windows Credential Manager, Secret Service,
  iOS Keychain (`protected`), Android Keystore. On a phone it is reopened behind Face
  ID or the device unlock. Nothing else is persisted: the wallet's chain state is a
  BDK changeset in IndexedDB, which holds public data only.
- **Browser.** There is no OS keychain, so "Remember on this device" asks for an app
  password — not the BIP39 passphrase — and keeps the key only under it. The key, with
  any BIP39 passphrase, is encrypted with AES-256-GCM under a key derived from the app
  password by PBKDF2-HMAC-SHA256 over 600,000 rounds, both from WebCrypto, with a random
  16-byte salt and 12-byte IV of its own. The record (format version, round count, salt,
  IV and ciphertext; never the password) is kept in the browser's IndexedDB, in a
  database of its own, `bitcoin-wallet-keystore`; the wallet's public record (address,
  network, id) sits in `localStorage`. A wrong password fails GCM's check and is
  reported as such. The password cannot be reset: forgetting it means restoring the
  wallet from its recovery phrase. Without "Remember" no key is written anywhere and the
  wallet lives exactly as long as the tab, and a page served from anywhere but https or
  localhost, which has no WebCrypto, does not offer it.
- **CLI.** `btcw` keeps state in memory for the run and persists nothing.

The type a wallet is opened and operated with zeroizes on drop, redacts its `Debug`,
and does not implement `Serialize`/`Deserialize` — a JSON wire form of it exists only
inside the keystore module that writes to the OS credential store, so nothing else
in the code base can serialize a key by accident. The BDK descriptor strings built
from it (the ones that actually carry a WIF or an extended private key) are held the
same way. The one deliberate exception is the "shown once" result of generating a
new key or recovery phrase — that type does derive `Serialize` on purpose, since
crossing the wasm/IPC boundary once to actually display it is the entire point.
The wallet core is compiled without a chain backend into the native shell — the
webview owns the wallet, the shell owns the keychain.

## Known limits

Stated because you should know them, not because they are acceptable:

- **No third-party audit.** None of this has been reviewed by anyone outside the
  project.
- **Signing keys are not zeroized while a wallet is open.** Our own `KeyMaterial` is. The
  keys an open wallet signs with sit in BDK's signer types, held by wallet-core — BDK's
  `Wallet` itself is only ever given public descriptors — and those types do not zeroize
  on drop; that is upstream.
- **A compromised endpoint sees your addresses.** Requests go to the configured Esplora
  server with no privacy layer — no Tor, no address rotation across servers. It learns
  which addresses belong together.
- **The native shell's outbound HTTP scope only grows, within one run.** The webview's
  proxied `fetch` (desktop, iOS, Android) starts with no origin granted at all; opening
  a wallet or changing the backend in Setup grants exactly that origin at runtime, in
  place of the wildcard `https://*:*` this used to be. Tauri's dynamic capability grant
  has no matching revoke, so an origin stays reachable for the rest of the process even
  after the backend is pointed elsewhere — narrower than "any host" by a lot, but not the
  same as "only the current one." A fresh launch starts from nothing again.
- **A key remembered in the browser is as strong as its app password.** Anyone with a
  copy of the browser profile can try passwords against it offline, as fast as their
  hardware allows and with no limit on attempts; the 600,000 rounds slow each guess, but
  a short or common password still falls. Nor does the password stand between the key
  and anything running in the page — an extension with access to it, or a tampered
  build — which sees the password as it is typed and the key once it is opened.
- **Backups are your problem.** Losing a recovery phrase, or a passphrase set on one,
  loses the wallet. "Forget this wallet" deletes the stored key immediately.
- **Not audited against side channels.** Signing uses `rust-secp256k1`; nothing here
  attempts to defend a shared machine.
- **Pre-1.0.** Only the latest commit on `main` is supported. There are no maintained
  release branches, and no backports.

## Supported versions

| Version | Supported |
|---|---|
| `main` | ✅ — the only supported version until the first release is tagged |
| tagged releases | none yet; once there are, the latest only |
| `reference/go/` | ❌ frozen |
