# Roadmap

What is still missing from this wallet, in the order it will be done. One item at a time; each
item is one Conventional Commit that also ticks its box here, so the file never claims more
than the tree holds. One branch per round, one pull request per round, merged with a merge
commit and the branch deleted.

Written 2026-09-14 against main `ea876a6`, after three audits of the tree (core and native
shell, TypeScript UI, CI and repository). Sizes: **S** an hour or less, **M** half a day,
**L** more. Tags: **admin** changes a GitHub setting (applied only after an explicit OK);
**credentials** cannot finish without a signing key or account; **canvas** is a visual change
and goes to the design canvas first; **decision** needs one product choice, recorded under
[Decisions](#decisions) when made.

Ticking: replace `[ ]` with `[x]`, append the short commit SHA, and put what proved it under
the item in place of "done when".

## Where things stand

Shipped and verified: HD (BIP39/44/49/84/86) and single-key wallets, watch-only from an xpub
or descriptor, Esplora backend with real timeouts on every platform, send with a drained
"Max", BIP125 fee bump, transaction detail, rescan with a chosen gap limit, public-key export,
BIP21 receive requests, OS keychain "remember" with biometrics on the phone, camera QR scan and
`bitcoin:` links, desktop and phone shells over one WASM core, a CLI, 57 core tests, 78
frontend tests, a regtest suite against real `bitcoind` + `electrs`, and a funded send driven
end to end on an Android build.

What follows is the residue: places where the code is right by default rather than by
construction, claims with no test behind them, a repository that checks less than it says, and
the distribution path, which does not exist yet.

## Round 1 — Money and secrets

Branch `round-1-money-and-secrets`. Core invariants first, then the UI paths that hold a secret
or a signed transaction. Nothing visual.

- [x] **1.0 This file** · S · `docs/ROADMAP.md`, `README.md`
      why: the work needs a place to be ticked · done: 2026-09-14 —
      README's second paragraph links here

- [x] **1.1 Fee rate gets a ceiling** · M · `crates/wallet-core/src/wallet.rs`
  (`fee_rate_from_sat_vb`), `error.rs`, `packages/wallet-ui/src/{api,types}.ts`, both Send
  screens, both bump fields
      why: the rate is clamped at the bottom and saturated at the top, and BDK multiplies it
      unchecked — a huge rate wraps in release and panics in debug · done: 2026-09-14 —
      `fee_rate_from_sat_vb` now returns `Result`, refusing non-finite, negative and
      >10,000 sat/vB with `invalid_fee_rate`; 5 new Rust tests + 3 new TS tests
      (`test/feerate.test.ts`) cover it; both Send screens and both bump fields share
      `feeRateError()`, disable their action and show it inline; `cargo test -p wallet-core
      -p wallet-cli`, workspace clippy (native + wasm32 target), `cargo fmt --check`,
      `pnpm -r typecheck`, `pnpm -r check`, and `pnpm test` (81/81) are all green

- [x] **1.2 RBF is set, not assumed** · S · `wallet.rs` (`build_transfer`, `build_drain`)
      why: replaceability rests on BDK's default sequence; the code claims it and nothing
      asserts it · done: 2026-09-14 — both builders call
      `set_exact_sequence(Sequence::ENABLE_RBF_NO_LOCKTIME)` (confirmed against BDK 3.1.0's
      source to be byte-identical to the default for every address type this wallet offers,
      since none carry a CSV requirement); `transfer_and_drain_signal_replaceability` asserts
      `is_rbf()` on every input of both; full suite (60 core tests), fmt and clippy
      (native + wasm32) green

- [ ] **1.3 Every secret field is wiped on leave** · S · `packages/wallet-ui/src/ui/words.ts`
  (`wipeOnLeave`), desktop `screens/key.ts`, `screens/create.ts`, mobile `screens/create.ts`,
  `screens/restore.ts`
      why: the desktop Key screen's private key and watch-only textarea survive navigation;
      mobile Create detaches nodes without zeroing the passphrase; desktop Create duplicates the
      helper by hand · done when: one helper (accepting textareas) used everywhere; a jsdom test
      types a key, changes the hash, and finds the field empty; no hand-rolled `hashchange`
      wipes remain

- [ ] **1.4 Secret strings are zeroized and cannot be serialized by accident** · M ·
  `crates/wallet-core/src/keys.rs`, `keystore.rs`, `wallet.rs`, `SECURITY.md`
      why: the descriptor strings that carry the WIF or xprv are plain `String`, built on every
      open and dropped unwiped; `KeyMaterial` derives `Serialize` for the keystore, so
      `serde_json::to_string(&key)` compiles anywhere · done when: `Zeroizing<String>` through
      `descriptors_for` into `Wallet::create`; a keystore-private DTO with the same JSON shape
      (existing keychain entries still load, checked with the native round-trip test on macOS);
      a `compile_fail` doctest for serializing `KeyMaterial`

- [ ] **1.5 Typed errors carry their data to the screen** · M · `error.rs`, `wallet.rs`,
  `crates/wallet-wasm/src/lib.rs`, `apps/native/src-tauri/src/error.rs`, `types.ts`
      why: `insufficient_funds` computes the shortfall and then flattens it into prose; dust,
      fee-too-low, no-utxos and a malformed txid all arrive as `build_tx`; the UI appends raw
      codes to messages · done when: new codes `dust`, `fee_too_low`, `no_utxos`, `invalid_txid`,
      `not_replaceable`, `invalid_fee_rate`, `corrupt_state`; a `details` object on the wasm
      error and the Tauri DTO; `errorMessage()` has copy per code and never prints a code; a
      Rust test maps every variant and asserts codes are unique; a TS test asserts copy per code;
      an over-spend in the web build reads "Need N sat more"

- [ ] **1.6 Persisted state carries a version** · M · `crates/wallet-core/src/persist.rs`,
  `wallet.rs`
      why: the record is a bare BDK changeset with no version; a corrupt or newer record makes
      the wallet unopenable with a generic `persist` error · done when: `{"v":1,"changeset":…}`
      written; bare records read as v1; `v > 1` and garbage surface as `corrupt_state` with
      details; the regtest reopen test still passes. (The "reset local history, keep the key"
      action that consumes this is in Round 5 — it needs a button.)

- [ ] **1.7 Desktop screens own their async results** · M · desktop `screens/dashboard.ts`,
  `screens/send.ts`, `screens/create.ts`, `screens/restore.ts`, `screens/key.ts`; mobile
  `screens/{settings,export,receive,send,scan}.ts`
      why: `screenGuard` protects five phone screens and no desktop one — a sync finishing after
      Close wallet stamps the next wallet's sync time, a slow bump navigates away from whatever
      opened next, and leaving desktop Send strands its PSBT in `api.pending` (mobile has
      `discardOnLeave`) · done when: every post-await write on desktop checks the guard; desktop
      Send discards on leave; on the Mac app, Max → leave → return builds a fresh Review

- [ ] **1.8 The CLI opens the wallet the user means** · S · `crates/wallet-cli/src/main.rs`,
  README CLI section
      why: `btcw` never applies a passphrase, so the same words silently open a different
      wallet; the stdin buffer is not zeroized; every failure exits 1 with the code discarded ·
      done when: `--passphrase` / `BTCW_PASSPHRASE`; `Zeroizing` buffer; exit code per error
      code; `--key` on the command line documented as unsafe; a test shows the same words with
      and without a passphrase print different addresses

- [ ] **1.9 Outbound HTTP is pinned to the configured backend** · M ·
  `apps/native/src-tauri/capabilities/{desktop,mobile}.json`, `src-tauri/src/lib.rs`,
  `commands.rs`, `SECURITY.md`
      why: the `http:default` scope is `https://*:*` + `http://*:*`, so the webview can make the
      Rust side fetch any host; it was widened so any user-typed Esplora URL works · done when:
      the wildcard entries are gone and the backend origin is granted at runtime from the stored
      config (spike first: confirm `add_capability` reaches the already-created webview; fallback
      is a `chain_fetch` command with an origin check); Setup with `https://example.invalid`
      fails with the scope error; the Mac app syncs against a LAN electrs; the emulator rig
      still syncs via `10.0.2.2`

## Round 2 — CI and supply chain

Branch `round-2-ci-and-supply-chain`. The repository stops checking less than it says.

- [ ] **2.1 `rust.yml` says what it does** · S · `.github/workflows/rust.yml`, `release.yml`,
  new `.github/actions/wasm-core`, `docs/RELEASING.md`
      why: the path filter omits `.cargo/**` and `rust-toolchain.toml` (the audit job's own
      config cannot trigger it); no job has a timeout (one run took 2 h 19 m); no concurrency
      control; wasm-pack is compiled from source in seven job legs; `regtest-tests` is never
      linted; RELEASING.md claims `cargo test --workspace` runs · done when: paths, timeouts and
      cancel-in-progress set; one composite action installs a prebuilt wasm-pack and builds the
      core; `regtest-tests` clippy'd; `--no-default-features` checked; the doc matches

- [ ] **2.2 `cargo deny` replaces `cargo audit`** · S · `deny.toml`, `.cargo/audit.toml`
  (removed), `rust.yml` · **admin** for the alert dismissals
      why: only advisories are checked today — no licence allow-list, no duplicate or wildcard
      bans, no source restriction; the three rustls-webpki Dependabot alerts are the dev-only
      0.101.7 reached through `minreq` → `bitcoind`/`electrsd` → `bdk_testenv`, already
      explained in the ignore list but not on GitHub · done when: `cargo deny check` is green
      locally and in CI with the ignores and their reasons migrated; alerts #39–41 dismissed as
      not reachable at runtime

- [ ] **2.3 Dependabot** · S · `.github/dependabot.yml` · **admin** to enable security updates
      why: nothing proposes upgrades; security updates are disabled · done when: cargo, npm,
      github-actions and gradle ecosystems, weekly, minor/patch grouped; the first Dependabot PR
      appears

- [ ] **2.4 vitest 3 → 4** · S · `packages/wallet-ui/package.json`, `pnpm-lock.yaml`
      why: 3.2.7 is inside CVE-2026-84373; the fix is 4.1.11 — dev-only, but three open alerts ·
      done when: `pnpm -F @bitcoin-wallet/ui test` passes on 4.x; `pnpm why @vitest/mocker`
      shows 4.1.x

- [ ] **2.5 One Node configuration** · S · root `biome.json`, `tsconfig.base.json`, root
  `package.json`, the three package configs, `rust.yml`
      why: three near-identical `biome.json`, two identical tsconfigs, no root `test` script
      (CI changes directory instead), no `packageManager` or `engines` · done when: the
      packages extend one root config; `pnpm check && pnpm typecheck && pnpm test` works from
      the root and CI runs exactly that; `pnpm audit --audit-level=high` in the apps job

- [ ] **2.6 The UI package typechecks its tests** · S · new `packages/wallet-ui/tsconfig.json`,
  `package.json`, `test/screen.test.ts`
      why: `test/**` is outside every tsconfig, so a fixture already lacks a required field
      and nothing notices · done when: `typecheck` fails before the fixture fix and passes after

- [ ] **2.7 Lints that lock in the record** · S · root `Cargo.toml`, `clippy.toml`, every
  crate manifest
      why: the tree has zero `unwrap` in production code and nothing enforces it; release builds
      have no overflow checks in a program that multiplies fee rates · done when: workspace
      lints deny `unwrap_used`, `expect_used`, `todo`, `dbg_macro` (tests exempt), forbid
      `unsafe_code` if none exists; `overflow-checks = true` in release; clippy clean with no
      new `#[allow]`

- [ ] **2.8 A tidy tree** · S · `.gitignore`, `bitcoin-rs-blueprint-review.html`,
  `crates/wallet-cli/Cargo.toml`, `README.md` · **decision** on the stray HTML (remove or move)
      why: `.gitignore` is still the Go template and misses `*.keystore`, `*.jks`, `.DS_Store`,
      `packages/*/dist`; a review page is tracked at the root; the CLI's crate description
      still mentions the Go TUI; README says nothing scans `reference/go/` while CodeQL does ·
      done when: each is fixed and a full build leaves `git status` clean

- [ ] **2.9 `main` is protected** · S · `docs/rulesets/main.json` · **admin**
      why: no branch protection, no rulesets — every green check is advisory · done when: a
      ruleset requires a pull request and the `rust` jobs, forbids force-push, allows merge
      commits; a direct push is refused

## Round 3 — Tests and drift

Branch `round-3-tests-and-drift`. Every claim in the code has a test, or is gone.

- [ ] **3.1 The error table is tested** · S · `error.rs`, `wallet.rs` tests
      why: two of the codes the IPC and wasm contracts rest on are asserted; the rest are not ·
      done when: every variant's code, details and message; the BDK build-error mapping over
      constructible variants

- [ ] **3.2 wasm runs in CI** · M · `crates/wallet-wasm`, `crates/wallet-core/src/backend/esplora.rs`,
  `rust.yml`
      why: 427 lines of bindings are compiled and never executed; the wasm32 deadline race is
      tested only on native · done when: `wasm-bindgen-test` covers error shape, key
      generation, mnemonic validation and open/reopen through a JS persister; the deadline test
      has a wasm32 twin; `wasm-pack test --node` runs in the `wasm` job

- [ ] **3.3 Regtest covers what shipped** · M · `crates/regtest-tests/tests/`
      why: drain, transaction detail, watch-only, passphrase wallets and multi-recipient sends
      are proven only against the mock · done when: against a real node — a drain arrives as
      exactly the reviewed amount with no change; detail shows fee, confirmations and ownership;
      a watch-only instance mirrors the full wallet; a passphrase yields a distinct wallet; a
      two-recipient send confirms

- [ ] **3.4 One spelling for the nested type** · S · `keys.rs` (`AddressType::parse`),
  `crates/wallet-wasm/src/lib.rs`, `packages/wallet-ui/src/wasm/index.ts`
      why: core accepts `np2wpkh` and emits `nested_p2wpkh`, so TS keeps a translation table for
      one variant · done when: `parse` accepts the serde spelling (`id()` untouched — wallet ids
      embed it), the getter returns it, the table is deleted; a remembered wallet still unlocks

- [ ] **3.5 Dead code out** · S · `keys.rs`, `persist.rs`, `network.rs`, `wallet-wasm`,
  `wasm/index.ts`, screens
      why: `is_indexable`, `MemoryPersister::snapshot`, three wasm exports and their TS
      wrappers have no caller; nine DOM casts repeat what `el()` already types; three desktop
      screens write session state that `api.openWallet` already writes · done when: gone, and
      clippy plus typecheck are clean

- [ ] **3.6 Drift closed** · S · `feebump.ts`, `balance.ts`, both shells · **decision** on the
  default fee target (3 or 6 blocks)
      why: `isBumpable` is exported, tested and re-implemented inline by both shells;
      `spendableSat` is unused; rescan presets are duplicated; the shells default to different
      fee targets; desktop Send hides why an address is wrong; mobile Result keeps a stale
      result; mobile Key gates watch-only on a type that cannot be opened · done when: one
      source for each rule, both shells import it, tests pass

- [ ] **3.7 Nothing fails silently** · S · `app.ts`, `apps/native/src/main.ts`,
  `apps/web/src/main.ts`, mobile `screens/scan.ts`, `ui/clipboard.ts`
      why: a settings store that cannot be read looks like a first run; a deep-link wiring
      failure vanishes; a web boot failure leaves a blank page; every clipboard failure reads as
      "nothing to paste" · done when: each path logs and, where a user can act, says so with the
      existing banner

- [ ] **3.8 The routing and normalizing rules are tested** · M · `app.ts`, `mobile/shell.ts`,
  `wasm/index.ts` → `wasm/normalize.ts`, `test/`
      why: the route guard tables, the `Map`-versus-object normalizers and `rateForTarget` are
      the rules the screens trust, and none has a direct test; no test renders a screen · done
      when: a pure `guardRoute()` with tests; normalizers importable without wasm and tested; a
      jsdom harness with the wasm module mocked proves 1.3 and 1.7

- [ ] **3.9 Accessibility semantics** · M · `ui/dom.ts`, `mobile/ui.ts`, callers, both CSS
  files · **decision** on the number locale
      why: radiogroups and chip groups have no accessible name; a `<label for>` points at a
      `<div>`; chips are separate tab stops with no arrow keys; no `prefers-reduced-motion`;
      numbers are formatted `en-US` while dates follow the device · done when: every group is
      named, arrow keys move selection (tested), motion respects the preference; no new pixels

## Round 4 — Shipping

Branch `round-4-shipping`. Versions, bundles, signing, and the documents that go with them.

- [ ] **4.1 One version** · S · root `Cargo.toml`, crate manifests, `tauri.conf.json`,
  `scripts/check-version.sh`, `justfile`
      why: `0.1.0` is typed by hand in ten manifests and two Apple files · done when: the
      workspace version is the source, a check script asserts the rest and runs in CI, `just
      bump X.Y.Z` edits them all, and `release.yml` refuses a tag that disagrees

- [ ] **4.2 A changelog and honest tiers** · S · `CHANGELOG.md`, `SECURITY.md` · **admin** for
  the stale objects
      why: no changelog; SECURITY.md promises support for tagged releases that do not exist; a
      2024 draft release with a 92 MB asset and a branch from a closed PR are still on GitHub ·
      done when: Keep-a-Changelog seeded from the merged PRs; the tier says "main only until
      the first tag"; the draft and the branch are deleted; description and topics set

- [ ] **4.3 Phone bundles on demand** · M · `.github/workflows/mobile-bundle.yml`
      why: CI compiles the Rust library for three mobile targets and never assembles an app ·
      done when: a `workflow_dispatch` builds an Android debug APK on Linux and an iOS Simulator
      app on macOS without signing, uploads both, asserts the camera and Face ID usage strings
      in the built `Info.plist`, and the APK installs on an emulator

- [ ] **4.4 Android release signing** · S · `gen/android/app/build.gradle.kts`, `release.yml`,
  `docs/RELEASING.md` · **credentials**
      why: no `signingConfigs`, so a release APK cannot be signed from this project · done when:
      a release config reads a gitignored `keystore.properties` or environment; the release
      workflow's Android leg runs when the secrets exist; `apksigner verify` on a local build

- [ ] **4.5 Minification verified** · S · `gen/android/app/proguard-rules.pro` · after 4.4
      why: R8 is on for release and the rules file is all comments; the Kotlin keystore shim is
      reached over JNI · done when: a minified release build opens, remembers, relaunches and
      unlocks on the emulator with a clean logcat, with keep rules only if that run demanded them

- [ ] **4.6 iOS release configuration** · S · `tauri.conf.json`, `release.yml`,
  `docs/RELEASING.md` · **credentials**
      why: the export method is `debugging` and there is no team · done when: the development
      team comes from the environment, the release workflow's iOS leg exports with
      `release-testing` when the secrets exist, and the mobile section of RELEASING.md exists

- [ ] **4.7 CodeQL scans what ships** · S · repository setting, `README.md` · **admin**
      why: default setup scans Go and Python — the frozen reference and a design generator ·
      done when: languages are actions, JavaScript/TypeScript and Rust; README matches

- [ ] **4.8 `justfile` and contributor documents** · S · `justfile`, `README.md`,
  `CONTRIBUTING.md`, `apps/native/design/README.md`, `docs/signet-rig/`
      why: the wasm build command is written out in five places; there is no contributor guide;
      the design generator and the canvas republish recipe are undocumented; the phone test rig
      is three sentences of prose · done when: `just --list` covers wasm, check, test, regtest,
      the phone builds, version and the signet rig; each document exists and README points at it

- [ ] **4.9 First tag** · S · `v0.1.0` · **decision** (outward-facing) · after 4.1 and 4.2
      why: the release workflow's tag path has never run · done when: the tag exists and the
      draft release built from it carries the desktop artifacts

- [ ] **4.10 Web build deployed** · S · `.github/workflows/pages.yml`, `apps/web/vite.config.ts` ·
  **admin**, and only if wanted
      why: the browser build is compiled on every push and published nowhere · done when: a
      Pages URL serves it, and the page says keys are held for the session only

## Round 5 — Product

Listed, not scheduled. Each goes to the design canvas first unless marked otherwise; the next
one starts when it is picked.

- "Reset local history, keep the key" on the Unlock, Key and Restore error banners — the
  action that consumes 1.6's `corrupt_state`
- The phone shell in the browser build on narrow, coarse-pointer viewports (no canvas — the
  boards exist)
- A desktop Settings screen (today: Close wallet, then Key → Back)
- Multi-recipient send on the phone
- UTXO list and coin control on the phone
- Focus rings in the phone stylesheet
- CLI `rescan`, `send --max`, `tx <txid>` (no canvas)
- Localization, Korean first, with a locale-aware number formatter
- A browser keystore (WebCrypto with a password) so the web build can remember a wallet
- Labels and contacts (BIP21 `label` is parsed, then dropped)
- CPFP; cancel-by-replacement; PSBT import; auto-lock on background; fiat display; a theme
  toggle; non-English BIP39 wordlists; a desktop auto-updater (needs the signing key first)

## Decisions

- 2026-09-14 — Rounds 1–4 scheduled; Round 5 on request.
- 2026-09-14 — vitest is upgraded to 4, not documented as accepted.
- 2026-09-14 — GitHub settings are changed through `gh`, each after an explicit OK.
- 2026-09-14 — The phone bundle workflow runs on manual dispatch only.
- Open: the default fee target (3.6); the number locale (3.9); the stray review page (2.8);
  the first tag (4.9); Pages (4.10).

## Not doing

- SHA-pinning action versions — Dependabot keeps the float tags current; low value.
- `#[non_exhaustive]` on `Error` — one workspace; the Tauri map delegates to `code()`.
- A wasm-specific `opt-level` — wasm-pack cannot pick a profile and `wasm-opt -O` already runs.
- Wiring `AddressType::is_indexable` into `open_with` — it answers a different question
  (discoverable versus spendable); deleted instead (3.5).
- QR colours that follow the theme — scanners want dark modules on a light quiet zone.
- "The Android manifest declares only INTERNET" — CAMERA and USE_BIOMETRIC merge in from the
  plugin libraries; verified in the merged manifest.
- "The iOS entitlements file is empty" — correct for a signed app; signing adds the identifier.
- The gradle `versionName "1.0"` default — the Tauri CLI rewrites `tauri.properties` from
  `tauri.conf.json` on every build; it only applies to a bare `./gradlew` run.
- `forgetWallet` deleting the keystore entry — by design; the reset in Round 5 is the other path.
- Coverage thresholds — a report may be added (3.8); no gate.
