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
  `.cargo/audit.toml` below

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
- **Third-party advisories with no path to shipped code.** Six are recorded, each with
  the reason it cannot reach the wallet, in
  [`.cargo/audit.toml`](.cargo/audit.toml); everything else fails CI. If you can show a
  path we missed, that is in scope.

## Where the keys are

- **Native (desktop, iOS, Android).** "Remember on this device" writes the key to the
  OS credential store — macOS Keychain, Windows Credential Manager, Secret Service,
  iOS Keychain (`protected`), Android Keystore. On a phone it is reopened behind Face
  ID or the device unlock. Nothing else is persisted: the wallet's chain state is a
  BDK changeset in IndexedDB, which holds public data only.
- **Browser.** There is no key store. The tab reports `canRememberWallet: false`, so
  "Remember on this device" is not offered, no key is written anywhere, and the wallet
  lives exactly as long as the tab.
- **CLI.** `btcw` keeps state in memory for the run and persists nothing.

Key material is held in a type that zeroizes on drop and redacts its `Debug`, and the
wallet core is compiled without a chain backend into the native shell — the webview
owns the wallet, the shell owns the keychain.

## Known limits

Stated because you should know them, not because they are acceptable:

- **No third-party audit.** None of this has been reviewed by anyone outside the
  project.
- **Key material inside BDK is not zeroized.** Our own `KeyMaterial` is; the `KeyMap`
  BDK holds while a wallet is open is not, and that is upstream.
- **A compromised endpoint sees your addresses.** Requests go to the configured Esplora
  server with no privacy layer — no Tor, no address rotation across servers. It learns
  which addresses belong together.
- **Backups are your problem.** Losing a recovery phrase, or a passphrase set on one,
  loses the wallet. "Forget this wallet" deletes the stored key immediately.
- **Not audited against side channels.** Signing uses `rust-secp256k1`; nothing here
  attempts to defend a shared machine.
- **Pre-1.0.** Only the latest commit on `main` is supported. There are no maintained
  release branches, and no backports.

## Supported versions

| Version | Supported |
|---|---|
| `main` | ✅ |
| tagged releases | latest only |
| `reference/go/` | ❌ frozen |
