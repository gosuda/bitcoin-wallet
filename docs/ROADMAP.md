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

- [x] **1.3 Every secret field is wiped on leave** · S · `packages/wallet-ui/src/ui/words.ts`
  (`wipeOnLeave`), desktop `screens/key.ts`, `screens/create.ts`, mobile `screens/create.ts`,
  `screens/restore.ts`
      why: the desktop Key screen's private key and watch-only textarea survive navigation;
      mobile Create detaches nodes without zeroing the passphrase; desktop Create duplicates the
      helper by hand · done: 2026-09-14 — `wipeOnLeave` widened to `Wipeable` (anything with a
      `.value`, so a textarea fits with no `also` workaround); desktop Key wipes the private-key
      field and the watch-only textarea; desktop Create's two hand-written listeners collapsed
      into one `wipeOnLeave` call that also covers the confirm-grid words; mobile Create zeroes
      the passphrase and confirm words before detaching; mobile Restore's watch-only textarea now
      wipes too. 4 new jsdom tests (`test/words.test.ts`); `grep hashchange` outside the shared
      router/guard/discard infrastructure finds nothing left hand-rolled; 85/85 tests,
      typecheck and biome all green

- [x] **1.4 Secret strings are zeroized and cannot be serialized by accident** · M ·
  `crates/wallet-core/src/keys.rs`, `keystore.rs`, `wallet.rs`, `SECURITY.md`
      why: the descriptor strings that carry the WIF or xprv are plain `String`, built on every
      open and dropped unwiped; `KeyMaterial` derives `Serialize` for the keystore, so
      `serde_json::to_string(&key)` compiles anywhere · done: 2026-09-14 — every descriptor
      string (`descriptor_for`, `hd_descriptor_string`, all four `watch_only_descriptors` sites)
      is `Zeroizing<String>`; `KeyMaterial` no longer derives `Serialize`/`Deserialize`, with a
      private `keystore::StoredKey` DTO (identical wire shape, so existing keychain entries
      still load — verified against the real macOS Keychain via the `#[ignore]`d
      `native_roundtrip` test, plus a relocated `stored_key_json_shape_is_stable` test pinning
      the JSON exactly); a `compile_fail` doctest on `KeyMaterial` proves
      `serde_json::to_string(&key)` no longer compiles; SECURITY.md's key-storage paragraph
      updated. 60 core tests + 1 doctest, fmt, and clippy (native + wasm32) all green;
      mobile targets (iOS/Android) were not locally cross-compiled but the change adds no
      `target_os`-specific code to the already-abstracted `backend::Entry` path

- [x] **1.5 Typed errors carry their data to the screen** · M · `error.rs`, `wallet.rs`,
  `crates/wallet-wasm/src/lib.rs`, `apps/native/src-tauri/src/error.rs`, `types.ts`
      why: `insufficient_funds` computes the shortfall and then flattens it into prose; dust,
      fee-too-low, no-utxos and a malformed txid all arrive as `build_tx`; the UI appends raw
      codes to messages · done: 2026-09-14 — six new variants (`Dust`, `FeeTooLow`, `NoUtxos`,
      `InvalidTxid`, `NotReplaceable`, `CorruptState` — the last unconstructed until 1.6) each
      with a code and, where there is more than prose, a `details()` object; a new
      `ErrorPayload` carries `{code, message, details?}`; `wallet.rs`'s `build_error` and the
      two txid-parse sites and the fee-bump error mapping all construct the new variants instead
      of `build_tx`; `crates/wallet-wasm`'s `core_err` attaches `details` to the thrown JS Error;
      the Tauri `AppError` DTO carries the same field; `errorMessage()` now falls through to the
      message unchanged for any code with no special copy, and has computed copy for
      `insufficient_funds` (the shortfall), `timeout`, `invalid_fee_rate`, `dust`, `fee_too_low`
      and `not_replaceable` — never appending `(code)`. Verified: 3 new `error.rs` tests
      (every variant → code/details shape, codes pairwise unique, `ErrorPayload` conversion);
      3 new `wallet.rs` tests exercising the real construction paths (a dust output, a malformed
      txid on both `transaction`/`build_fee_bump`, bumping an unknown txid); 10 new
      `test/errors.test.ts` tests including the literal "Need 60 more sat." computation; the
      full workspace typechecks, biome-checks, and `pnpm -r build` succeeds against a real
      `wasm-pack build` of the changed wasm crate (not just clippy); 69 core tests, fmt and
      clippy (native + wasm32) all green. Not done: a live click-through in a running browser —
      the unit tests exercise the exact same shapes the real path produces. They did not:
      `details` crossed the wasm boundary as a JS `Map`, which `details.needed_sat` cannot
      read, so every wasm build fell back to the core's own sentence. The first wasm test (3.2)
      found it on 2026-09-29 and it was fixed in its own commit. The click-through, done then,
      reads "Need 95,528 more sat." for 100,000 sat from a 4,650 sat testnet4 wallet, where
      the unfixed build said "insufficient funds: need 100178 sat, have 4650 sat"

- [x] **1.6 Persisted state carries a version** · M · `crates/wallet-core/src/persist.rs`,
  `wallet.rs`, `error.rs`
      why: the record was a bare BDK changeset with no version; a corrupt or newer record made
      the wallet unopenable with a generic `persist` error, indistinguishable from a real I/O
      failure · done: 2026-09-14 — `changeset_to_json` wraps every write in `{"v":1,"changeset":
      …}` (`STATE_FORMAT`); `changeset_from_json` reads a v1 envelope, a bare pre-envelope
      record (no `"v"` key — every wallet already on disk), or refuses as `Error::CorruptState`:
      `future_version` (with `found`/`supported`) when `v` exceeds `STATE_FORMAT`, `malformed`
      for anything else that does not parse or decode. `CorruptState` grew `found`/`supported:
      Option<u64>` fields to carry that. `wallet.rs`'s new `load_error` maps every
      `bdk_wallet::error::LoadError` variant (`Mismatch`, `MissingNetwork`, `MissingGenesis`,
      `MissingDescriptor`, `Descriptor`) to `CorruptState{reason:"mismatch"}`, replacing the
      generic `Error::Persist` those used to surface as. Verified: 5 `persist.rs` tests (a
      legacy bare record, a v1 envelope round-trip, `{"v":2}` → `future_version` with the exact
      `found`/`supported` values, five shapes of garbage all refused as `malformed`); the
      regtest `state_survives_reopen_from_persister` green; 73 core tests, fmt and clippy
      (native + wasm32) all green. Not done: the reset-UI action that consumes `corrupt_state`
      — Round 6, it needs a button.

- [x] **1.7 Desktop screens own their async results** · M · desktop `screens/dashboard.ts`,
  `screens/send.ts`, `screens/create.ts`, `screens/restore.ts`, `screens/key.ts`; mobile
  `screens/{settings,export,receive,send,scan}.ts`
      why: `screenGuard` protects five phone screens and no desktop one — a sync finishing after
      Close wallet stamps the next wallet's sync time, a slow bump navigates away from whatever
      opened next, and leaving desktop Send strands its PSBT in `api.pending` (mobile has
      `discardOnLeave`) · done: 2026-09-14 — every desktop screen now calls `screenGuard()`;
      `dashboard.ts`'s `runSync`/`rescanBtn` stop stamping `lastSyncedAt` once the wallet has
      changed underneath them, `bumpInline` and Send's Confirm still record `lastResult`
      unconditionally (the broadcast happened) but only navigate if still on-screen, and
      `openDetail`'s async paint checks both the guard and its own row-identity check; Send
      gained `discardOnLeave` (mirroring mobile) so `cancelBtn` shrinks to a bare `navigate` and
      every abandoned preview or Max build is discarded on any way off the screen, not just
      Cancel. Five mobile call sites gained the same check where none of the existing five
      screens' own guards already covered them. Verified: `pnpm -r typecheck`, `pnpm check`,
      95 frontend tests, and `pnpm -r build`, all green; then a real click-through against the
      web build (`vite dev` + a live browser) — Setup → Create → confirm grid → Dashboard →
      Send → Cancel, Setup → Key → generate → open, Setup → Restore → open, and Dashboard's New
      address — on regtest against an unreachable backend, so wallet creation exercises the
      real code path with nothing to actually sync.

      That click-through caught a real bug the type checker couldn't: `api.openWallet` sets
      `session.wallet` itself, inside `install()`, before the promise the caller awaits ever
      resolves — so the four handlers that call it (Create/Restore's `submit`, Key's `openBtn`
      and `followBtn`) had their own `onScreen()` check read a wallet-id mismatch against
      *themselves* on every single call, not just a real swap, and silently ate the navigate to
      Dashboard every time. Reordering the check earlier in the same function does not help —
      the mutation happens inside the awaited call, before any of the caller's own code runs —
      so those four call sites go back to navigating unconditionally, same as before this item,
      with a comment naming why `onScreen()` does not belong there. Every other call site was
      checked against the same failure mode (`api.newAddress` also reassigns `session.wallet`,
      but preserves `wallet_id`, so it is unaffected) before this was marked done.

      Not verified live: the mobile call sites (`apps/web` does not route to them) and the
      timing-dependent claims themselves — leaving mid-flight is exactly what a manual
      click-through cannot reliably force. Round 3 item 3.8's jsdom harness is where that gets
      an automated proof; this item's bar was the guard being present and correct, and the app
      actually working end to end, both now true.

- [x] **1.8 The CLI opens the wallet the user means** · S · `crates/wallet-cli/src/main.rs`,
  `crates/wallet-cli/Cargo.toml`, `README.md`
      why: `btcw` never applies a passphrase, so the same words silently open a different
      wallet; the stdin buffer is not zeroized; every failure exits 1 with the code discarded ·
      done: 2026-09-14 — `BackendArgs` gained `--passphrase`/`BTCW_PASSPHRASE`, wired through
      `read_key` to `KeyMaterial::parse_with_passphrase` (the stdin and env-var buffers are
      `Zeroizing`). A new `CliError` wraps either a CLI-level `String` or a `wallet_core::Error`;
      `run()` returns it instead of a bare `String`, which let every `.map_err(|e| e.to_string())`
      in the file come out — `?` converts on its own now — and `CliError::exit_code` gives each
      `Error` variant its own process exit code (10-27; 1 stays "a CLI-level problem"), which
      `main` now actually uses instead of a flat `ExitCode::FAILURE`. `--key`'s and
      `--passphrase`'s doc comments name the `ps`/shell-history exposure of passing a secret on
      argv. README's CLI section documents `BTCW_PASSPHRASE` and the exit-code convention.

      Live-testing this surfaced a real, pre-existing bug this item's own verification needed
      to get past: `Send`'s `--to` derived the short flag `-t`, already claimed globally by
      `--address-type` — clap only checks this the first time a subcommand is actually parsed,
      so `btcw send` has panicked on every real invocation since `--to` was added, on `main`,
      unrelated to anything else in this round. Fixed by dropping `to`'s short flag (`--to` only
      — `-t` stays `--address-type`'s), and `tests::every_subcommand_has_a_well_formed_arg_definition`
      now calls clap's own `Command::debug_assert()` in CI so a future version of the same
      mistake fails the test suite instead of waiting for someone to actually type the command.

      Verified: `cargo test -p wallet-cli` (5 new tests: the arg-definition check above, the
      same-words-different-passphrase address check via `address_for_key` directly, `read_key`
      applying a given vs. absent passphrase, every core error's exit code pairwise unique and
      never colliding with 1, a bare CLI error always exiting 1); `cargo test -p wallet-core`
      still 73 green; fmt and clippy clean. Manually: built and ran the real binary —
      `abandon…about` with and without `--passphrase TREZOR` printed different addresses (also
      via `BTCW_PASSPHRASE`), and `send` against a backend nothing is listening on now exits 14
      (`backend`) instead of panicking.

- [x] **1.9 Outbound HTTP is pinned to the configured backend** · M ·
  `apps/native/src-tauri/capabilities/{desktop,mobile}.json`, `src-tauri/Cargo.toml`,
  `src-tauri/src/lib.rs`, `commands.rs`, `SECURITY.md`
      why: the `http:default` scope is `https://*:*` + `http://*:*`, so the webview can make the
      Rust side fetch any host; it was widened so any user-typed Esplora URL works · done:
      2026-09-14 — the spike confirmed `add_capability`: traced both sides of it in Tauri
      2.11.5's own source, not just the doc comment — `RuntimeAuthority::add_capability_inner`
      merges into the *same* `scope_manager` the `http` plugin's `fetch` command reads via
      command-injected `CommandScope`/`GlobalScope` params on every single invocation (resolved
      fresh each call, cache invalidated on every add), so nothing about it is a frozen
      per-window snapshot taken at webview creation. Both capability files lost their
      `http:default` block outright — the webview's HTTP proxy now starts with no origin granted
      at all. `commands::grant_backend_scope` builds one `CapabilityBuilder` scoped to `window
      ("main")` with `permission_scoped("http:default", [{url: "<origin>/*"}], [])` from the
      configured Esplora URL's origin only (`backend_origin_pattern` parses it with the `url`
      crate and refuses anything that isn't plain http(s)); called from `set_config` after every
      save, and from `.setup()` against whatever `stored_config` last had, since a remembered
      wallet syncs on launch without `set_config` running again that process. `dynamic-acl` is
      now an enabled `tauri` feature — required for `add_capability` to exist at all.

      Deliberately not exact pinning: Tauri's dynamic ACL has no revoke, only grant, so an
      origin stays reachable for the rest of the *process* even after the backend is pointed
      elsewhere — narrower than "any host" by a lot, not literally "only the current one" within
      one run. A fresh launch starts from nothing again. SECURITY.md's "Known limits" names this
      precisely, so it reads as a documented tradeoff instead of a surprise.

      Verified: `cargo build`/`clippy -D warnings`/`fmt --check` all clean for
      `bitcoin-wallet-app` with `dynamic-acl` actually enabled (not just type-checked against a
      hypothetical), across the whole workspace; `pnpm tauri dev` launches the real desktop
      binary against the new empty-scope capability files without crashing. Not verified: an
      automated test exercising the *enforcement* path itself (`tauri::test::get_ipc_response`
      against the `http` plugin's `fetch` command looks like the right tool — dispatches a real
      IPC request through `on_message` the same way JS would, headless — but wiring a mock app
      through it correctly is its own investigation, out of this item's bounded scope) — nor the
      three live scenarios the original "done when" named (Setup refusing an ungranted origin,
      syncing against a LAN electrs, the Android emulator via `10.0.2.2`), none of which this
      sandbox can drive: no GUI automation reaches a native Tauri window the way a browser build
      can be driven, and there is neither a LAN electrs nor an emulator here. Whoever ships this
      should click through those three on real hardware before calling the guarantee proven, not
      just argued from source.

## Round 2 — CI and supply chain

Branch `round-2-ci-and-supply-chain`. The repository stops checking less than it says.

- [x] **2.1 `rust.yml` says what it does** · S · `.github/workflows/rust.yml`, `release.yml`,
  new `.github/actions/wasm-core`, `docs/RELEASING.md`
      why: the path filter omits `.cargo/**` and `rust-toolchain.toml` (the audit job's own
      config cannot trigger it); no job has a timeout (one run took 2 h 19 m); no concurrency
      control; wasm-pack is compiled from source in seven job legs; `regtest-tests` is never
      linted; RELEASING.md claims `cargo test --workspace` runs · done: 2026-09-28 — the slow
      runs were queue time, not build time: across the two slowest (5 h 16 m and 5 h wall
      clock) every job executed in 0.4–5.1 min and waited up to 5 h for a runner, because
      each push to a busy PR started a full matrix nobody cancelled. `concurrency` now
      cancels a superseded PR run (never a push to `main`); every job has a timeout (30 min,
      15 for the audit, 60 for the never-run release bundle); the filter adds
      `rust-toolchain.toml`, `.cargo/**`, the root `package.json` and all of `.github/**`;
      `.github/actions/wasm-core` installs a prebuilt wasm-pack (`taiki-e/install-action`) and
      builds the core for the wasm job, the apps job and all four release legs; `regtest-tests`
      is clippy'd with `--all-targets` and `wallet-core --no-default-features` with
      `-D warnings`, both clean locally before they were added; RELEASING.md lists what CI
      runs and says nothing runs `--workspace` (the only crates it would add, the app shell
      and `wallet-wasm`, have no tests). `actionlint` clean, including a shellcheck note in
      the NDK step. On this round's pull request the prebuilt wasm-pack (the v0.15.0
      release tarball) installed in about a second; `cargo install` compiled it from source
      on every cold cache — a warm one already had it in `~/.cargo/bin` — so the saving is
      on cache misses

- [x] **2.2 `cargo deny` replaces `cargo audit`** · S · `deny.toml`, `.cargo/audit.toml`
  (removed), `rust.yml` · **admin** for the alert dismissals
      why: only advisories are checked today — no licence allow-list, no duplicate or wildcard
      bans, no source restriction; the three rustls-webpki Dependabot alerts are the dev-only
      0.101.7 reached through `minreq` → `bitcoind`/`electrsd` → `bdk_testenv`, already
      explained in the ignore list but not on GitHub · done: 2026-09-28 — `deny.toml` checks
      all four: the five vulnerability ignores migrated with reasons and their GHSA ids (looked
      up, not guessed: -0104/-0099/-0098 are GHSA-82j2/-xgp8/-965h; the quick-xml pair has
      none); unmaintained and unsound notices fail for direct dependencies only, which is how
      the six unmaintained crates cargo audit only warned about (proc-macro-error and five
      `unic-*`, all through Tauri) and glib's unsoundness stay non-fatal while a direct
      dependency no longer could; a thirteen-licence allow-list, each one used (cargo deny
      warns otherwise); wildcard requirements denied, with every crate now `publish = false`
      so workspace path dependencies pass; crates.io the only source. `cargo deny check`
      green locally with and without `--all-features` (the action's default), on the same
      0.20.2 the action ships; SECURITY.md points at `deny.toml`. Alerts #39–41 dismissed as
      `not_used` with the RUSTSEC id and reason (admin OK 2026-09-28); open alerts read back
      as #42–44 (vitest, 2.4) and #18 (glib, ships on Linux)

- [x] **2.3 Dependabot** · S · `.github/dependabot.yml` · **admin** to enable security updates
      why: nothing proposes upgrades; security updates are disabled · done: 2026-09-28 —
      cargo, npm (the one pnpm workspace at the root), github-actions (the workflows and the
      `wasm-core` composite, which `/` alone does not reach), weekly, with
      minor and patch grouped per ecosystem and majors one at a time; titles follow the
      repository's Conventional Commits (`build(deps)`, `ci(deps)`). Validated against the
      published schema (`check-jsonschema --builtin-schema vendor.dependabot`). Security
      updates switched on (admin OK 2026-09-28) and read back `enabled: true`. The first
      Dependabot pull request, #12, opened within minutes: vitest 3.2.7 → 4.1.11, the same fix
      as 2.4, so it closes once this round is on `main`. Version updates start then too —
      Dependabot reads this file from `main` only. Gradle was in the first version, and
      dropped on 2026-09-29: all three of its proposals (androidx, Kotlin 2.4, Gradle 9) failed
      a local APK build, because the generated Android project's toolchain is pinned by
      Tauri's own plugin modules; the reason is in `dependabot.yml`

- [x] **2.4 vitest 3 → 4** · S · `packages/wallet-ui/package.json`, `pnpm-lock.yaml`
      why: 3.2.7 is inside CVE-2026-84373; the fix is 4.1.11 — dev-only, but three open alerts ·
      done: 2026-09-28 — `vitest ^4.1.11`; `pnpm why -r @vitest/mocker` went from 3.2.7 to
      4.1.11 with no other version left in the tree; the lockfile diff stays inside vitest's
      own graph (chai 5 → 6; `vite-node`, `tinypool`, `tinyspy` gone; vitest now shares the
      workspace's Vite 7.3.6). All 98 tests pass on v4.1.11 with no test or config change —
      nothing here used anything on 4.0's removal list. Alerts #42–44 close when this reaches
      `main`

- [x] **2.5 One Node configuration** · S · root `biome.json`, `tsconfig.base.json`, root
  `package.json`, the three package configs, `rust.yml`
      why: three near-identical `biome.json`, two identical tsconfigs, no root `test` script
      (CI changes directory instead), no `packageManager` or `engines` · done: 2026-09-28 —
      one root `biome.json`; each package's is `root: false, extends: "//"` plus its own
      `files.includes`, and a probe file in each (an `any`, a non-null assertion, single
      quotes, an over-long line) tripped all three shared rules in all three packages before
      it was deleted; one `tsconfig.base.json`, and both apps' `tsc --showConfig` output —
      every option and all 47/48 files — is byte-identical before and after; the root has
      `test`, `packageManager: pnpm@10.19.0` (which pnpm/action-setup now reads, instead of a
      second `version: 10`) and `engines.node` set to what the tools actually require (Vite
      7's `^20.19 || >=22.12`, less the 21 and 23 vitest 4 skips). CI's apps job runs `pnpm
      check`, `typecheck`, `test` and `build` from the root with no `cd` into a package, then
      `pnpm audit --audit-level=high` — all five pass locally (98/98 tests, no known
      vulnerabilities); the path filter adds the two new root files. Raised on 2026-09-29 to
      `^22.22.2 || ^24.15.0 || >=26.0.0`, the intersection again: vitest 5 dropped Node 20
      and 25, and jsdom 30 put the 22 and 24 floors where they are now

- [x] **2.6 The UI package typechecks its tests** · S · new `packages/wallet-ui/tsconfig.json`,
  `package.json`, `test/screen.test.ts`
      why: `test/**` is outside every tsconfig, so a fixture already lacks a required field
      and nothing notices · done: 2026-09-28 — the package's own tsconfig (the shared base,
      over `src`, `test` and `vitest.config.ts`) and a `typecheck` script with `typescript`
      as a dev dependency. Before the fixture fix it failed with exactly one error, the one
      named here (`test/screen.test.ts:7`, TS2741, `is_ranged` missing); after it, clean. The
      root `pnpm typecheck` now covers all three packages. Giving the package a tsconfig also
      changed how Vite and vitest compile it — each file takes its nearest tsconfig, and until
      now there was none, so wallet-ui alone had pre-ES2022 class fields — which a test caught
      (`WalletError` grew an own `details: undefined`) and which the preceding commit fixes at
      the declaration; 98/98 pass

- [x] **2.7 Lints that lock in the record** · S · root `Cargo.toml`, `clippy.toml`, every
  crate manifest
      why: the tree has zero `unwrap` in production code and nothing enforces it; release builds
      have no overflow checks in a program that multiplies fee rates · done: 2026-09-28 —
      `[workspace.lints]` forbids `unsafe_code` and denies `unwrap_used`, `expect_used`, `todo`
      and `dbg_macro`; `clippy.toml` exempts tests; all five crates inherit it. `forbid` holds:
      the tree has no `unsafe`, and the `#[no_mangle]`/`export_name` that wasm-bindgen and
      Tauri's phone entry point generate are external proc-macro expansions rustc does not
      lint — the wasm32 and iOS clippy runs pass. The record was one short: an `expect` on
      Tauri's `run()`, now an explicit panic, since an event loop that never starts is
      unrecoverable and a panic reaches a phone's crash reporting where an exit would not.
      clippy's test exemption covers `#[test]` fns and `#[cfg(test)]` modules but not helpers
      in an integration-test crate, so those four files say `#![cfg(test)]` (true of them
      anyway) instead of carrying an `#[allow]`; `--list` still finds all six tests.
      `overflow-checks = true` in release — the release `btcw` compile gets `-C
      overflow-checks=on`. Clippy clean (native all targets, wasm32 core + wasm, iOS app)
      with no new `#[allow]`; release CLI builds; core and CLI suites green. The regtest
      suite runs in CI only now: this Mac moved to macOS 27 on arm64 with no x86_64
      translation, and the harness's `bitcoind` 25.0 is an x86_64 build

- [x] **2.8 A tidy tree** · S · `.gitignore`, `bitcoin-rs-blueprint-review.html`,
  `crates/wallet-cli/Cargo.toml`, `README.md` · **decision** on the stray HTML (remove or move)
      why: `.gitignore` is still the Go template and misses `*.keystore`, `*.jks`, `.DS_Store`,
      `packages/*/dist`; a review page is tracked at the root; the CLI's crate description
      still mentions the Go TUI; README says nothing scans `reference/go/` while CodeQL does ·
      done: 2026-09-28 — `.gitignore` drops the Go template and adds the four; the template
      had not even ignored the Go reference's own build (its `/bin` is root-anchored, and
      `make build` writes `reference/go/bin/`), so that path is now named. No tracked file
      matches any new pattern. The review page is removed (decision below; it stays in
      history at `ece8550`); `btcw --help` now opens with the new description; README says
      CodeQL still scans `reference/go/`. A full build — the workspace in debug and release,
      the wasm core, both apps and the Go reference — leaves `git status` showing only these
      edits

- [x] **2.9 `main` is protected** · S · `docs/rulesets/main.json` · **admin**
      why: no branch protection, no rulesets — every green check is advisory · done: 2026-09-28
      — ruleset 24116734 (admin OK 2026-09-28, no bypass): a pull request (no approvals, since
      one maintainer cannot approve their own), the ten `rust` jobs by name and pinned to
      GitHub Actions so a hand-posted status cannot stand in, no force-push, no deletion, all
      three merge methods allowed. The ten names were checked against what `rust.yml` can
      produce, both ways. Read back from `rules/branches/main` as applied, and `main` reports
      `protected: true`. A direct push of a probe commit by an admin was refused — `GH013 …
      Changes must be made through a pull request. 10 of 10 required status checks are
      expected.` — and `main` did not move. The workflow's `pull_request` trigger lost its
      path filter, since a required check that never reports would hold a docs-only pull
      request open forever; the push filter gains `clippy.toml`. `docs/rulesets/README.md`
      has the apply, update and read-back calls, and why a renamed job must change both files

## Round 3 — Tests and drift

Branch `round-3-tests-and-drift`. Every claim in the code has a test, or is gone.

- [x] **3.1 The error table is tested** · S · `error.rs`, `wallet.rs` tests
      why: two of the codes the IPC and wasm contracts rest on are asserted; the rest are not ·
      done: 2026-09-29 — 1.5 had since put every code and details shape in a table; the
      table now also pins every variant's message (the text a UI falls back to), all three
      branches of `FeeTooLow`'s, and cannot silently fall behind the enum: a new variant fails
      to compile in an exhaustive `ordinal()` until it is numbered, then fails
      `the_table_covers_every_variant` until it has a row (proved by deleting one — the test
      named the missing ordinal). The BDK mappings are tested directly: every constructible
      `CreateTxError` a UI can act on (insufficient funds, dust, both "too low" kinds, no
      UTXOs) and the `build_tx` fallback; the fee-bump mapping, extracted from an inline
      closure into `bump_error`, over all six `BuildFeeBumpError` variants; and a round trip
      showing a minimum rate BDK reports is shown in sat/vB that `fee_rate_from_sat_vb`
      accepts unchanged. Same variant shapes in bdk_wallet 3.1 and 3.2. 75 core tests

- [x] **3.2 wasm runs in CI** · M · `crates/wallet-wasm`, `crates/wallet-core/src/backend/esplora.rs`,
  `rust.yml`
      why: 427 lines of bindings are compiled and never executed; the wasm32 deadline race is
      tested only on native · done: 2026-09-29 — `crates/wallet-wasm/tests/bindings.rs`, 8
      tests in Node against the real bindings, offline (opening a wallet never contacts its
      backend). Error shape: every thrown value is a JS `Error` with a string `code` and
      `message`; `details` is absent when an error has none, and a plain object when it
      does: an overspend's `needed_sat`/`available_sat`, a malformed record's `reason` with
      `null` for `found`, a newer build's record naming both versions. The very first run
      showed `details` arriving as a `Map`, which the UI cannot read; that is fixed in its
      own commit, just before this one. Keys: a generated key derives the address it came
      with from both its WIF and its hex, and two keys differ (the entropy is the JS host's);
      12- and 24-word phrases validate and derive their address, 13 is `invalid_key`, a bad
      checksum is `invalid_key` with no `details`, and an unknown network or type is
      `unsupported` with its own message. Open/reopen through a persister written in JS: the
      id matches `walletIdForKey`, the stored record is the `{"v":1}` envelope, and reopening
      from it reveals a third address where the same words with an empty store start over.
      The deadline tests now run on both targets from one body (`tokio::test` natively,
      `wasm_bindgen_test` in wasm32); the 1 s timeout fires in Node in 1.01 s. For
      wallet-core's tests to compile for wasm32 at all, four test-only trait impls in
      `wallet.rs` took the `?Send` form on wasm32 that production code already uses. The
      `wasm` job lints both crates' tests (`--all-targets`) and runs both suites on Node 22;
      README and RELEASING list the commands

- [x] **3.3 Regtest covers what shipped** · M · `crates/regtest-tests/tests/`
      why: drain, transaction detail, watch-only, passphrase wallets and multi-recipient sends
      are proven only against the mock · done: 2026-09-29 — `tests/flows.rs`, three tests
      against bitcoind + electrs, green in CI on their first run (29 s together). A
      two-recipient send: each recipient's own wallet (one P2WPKH, one P2TR) holds exactly its
      30,000 / 45,000 sat, and the sender's `transaction()` detail reads the reviewed fee,
      `confirmations: 1`, a block height, the net amount, inputs that are ours, both payments
      as not ours and exactly one change output of the reviewed change. A drain of two coins:
      both inputs, no change, the destination's own wallet holds exactly `total_out_sat` (the
      amount Review shows), the drained wallet is empty and its only output is not ours. A
      watch-only copy opened from the full wallet's external public descriptor (what the
      Public keys card shows), after a spend with change: the same balance, UTXOs, history and
      next address as the full wallet; it builds a payment, and `sign` answers `unsupported`.
      The passphrase case was already proven against a node: `hd.rs` has shown since
      2026-09-03 that the same words under a passphrase get a different id and BIP84 addresses
      from the passphrased seed, and see none of the words' coins. The "only against the
      mock" above was wrong for that one

- [x] **3.4 One spelling for the nested type** · S · `keys.rs` (`AddressType::parse`),
  `crates/wallet-wasm/src/lib.rs`, `packages/wallet-ui/src/wasm/index.ts`
      why: core accepts `np2wpkh` and emits `nested_p2wpkh`, so TS keeps a translation table for
      one variant · done: 2026-09-29 — `AddressType::parse` also accepts `nested_p2wpkh`, a new
      `name()` gives the serde spelling (a test checks it against serde itself for every type,
      and that both `name()` and `id()` parse back), and the wasm `address_type` getter returns
      it. `wasm/index.ts` lost `CORE_ADDRESS_TYPE` and its reverse lookup: the four free
      functions take the app's names as they are, and the getter is a cast like its `network`
      neighbour. `id()` is unchanged and documented as load-bearing. A remembered wallet is
      found by its id, and that id is pinned twice: exactly in core
      (`bitcoin-np2wpkh-751e76e8199196d4`), and in Node, where the new spelling yields the same
      `walletIdForKey` as the old one and opening a `nested_p2wpkh` config gives a `2…`
      address and that id. 9 binding tests, 76 core tests, 98 UI tests; typecheck and lint
      clean

- [x] **3.5 Dead code out** · S · `keys.rs`, `persist.rs`, `network.rs`, `wallet-wasm`,
  `wasm/index.ts`, screens
      why: `is_indexable`, `MemoryPersister::snapshot`, three wasm exports and their TS
      wrappers have no caller; nine DOM casts repeat what `el()` already types; three desktop
      screens write session state that `api.openWallet` already writes · done: 2026-09-29 —
      gone: `AddressType::is_indexable`, `MemoryPersister::snapshot`, `Network::ALL` (its one
      user, a test, now lists the networks itself), the wasm exports `address_for_key`,
      `default_esplora_url` and `Wallet.chain_height` with their TS wrappers (the core
      functions stay: the CLI and `tests/live.rs` use them). The 3.2 tests that used
      `address_for_key` as an oracle now check against an opened wallet's first address, and
      the nested one against BIP49's own test vector. The nine casts are gone; `result.ts`'s
      is not one of them (it narrows `null` inside a closure). The session writes: all six
      are gone, not just three. `api.openWallet` (create, key ×2, restore),
      `api.unlockWallet`, `api.forgetWallet` and `api.closeWallet` each set `session.wallet`
      themselves, so `api.ts` is now its only writer. The screens' copies had even been able
      to put an older open back over a newer one in the gap after `openWallet` resolved.
      Clippy (native, wasm32, all targets), typecheck and biome are clean; 76 core, 9
      binding and 98 UI tests pass; in the web app a restore reaches the dashboard and Close
      wallet returns to Key

- [x] **3.6 Drift closed** · S · `feebump.ts`, `balance.ts`, both shells · **decision** on the
  default fee target (3 or 6 blocks)
      why: `isBumpable` is exported, tested and re-implemented inline by both shells;
      `spendableSat` is unused; rescan presets are duplicated; the shells default to different
      fee targets; desktop Send hides why an address is wrong; mobile Result keeps a stale
      result; mobile Key gates watch-only on a type that cannot be opened · done: 2026-09-29 —
      each rule now has one home, and both shells import it. `isBumpable` takes any
      `{confirmations, net_sat}`, and both detail views call it in place of their inline
      copies (a test covers a detail). `spendableSat` is deleted. `types.ts` holds
      `FEE_TARGETS`, `DEFAULT_FEE_TARGET` (6, decided), `RESCAN_GAPS` (the first is the
      core's `DEFAULT_STOP_GAP`, 20) and `isOpenable`, and both Sends and both rescans build
      from them. Desktop Send shows `addressError`'s reason. Mobile Result's "Back to wallet"
      spends the result as desktop's does. The p2pk gate was more than mobile's: a config
      saved by an older build can still name p2pk, and both Key screens tailored their offer
      to it while still offering paths the core refuses. Both route guards now send an
      unopenable config to Setup, both Setups start from P2WPKH when the stored type is not
      one they offer, and both gates are gone, along with desktop's stale "or use a single
      key below". In the web app: a planted p2pk config asked for `#/key` and got Setup with
      P2WPKH checked, and Continue stored `p2wpkh`; Send starts on 6 blocks; the rescan chips
      read "gap 20", 100, 500; a mainnet address in a testnet4 wallet reads "Not a Testnet4
      address — this one is for Bitcoin mainnet." The phone shell's changes are
      typechecked, not clicked: the web app does not mount it. 98 UI tests pass

- [x] **3.7 Nothing fails silently** · S · `app.ts`, `apps/native/src/main.ts`,
  `apps/web/src/main.ts`, mobile `screens/scan.ts`, `ui/clipboard.ts`
      why: a settings store that cannot be read looks like a first run; a deep-link wiring
      failure vanishes; a web boot failure leaves a blank page; every clipboard failure reads as
      "nothing to paste" · done: 2026-09-29 — every path logs with `console.error`, and the
      ones a user can act on use the existing banner. Boot, which runs before any screen
      exists, queues its news (`queueNotice` in `ui/dom.ts`) for the first banner a screen
      creates. Checked in the web app with the real modules: a settings read made to throw
      "store locked" opens Setup saying "The saved settings could not be read (store locked).
      Choose them again."; a remembered-wallet read made to throw says the saved wallet could
      not be read and to open it again with its phrase or key. Both entry points now end in
      `showBootFailure`, which puts the error in the page (the native one too, whose start
      could fail the same way): called with an error, the page shows "The wallet could not
      start: …" in the error banner, not a blank window. A deep-link wiring failure is only
      logged; the app works without it. The phone's paste tells a refused permission
      ("Allow it and try again") from a clipboard this build cannot read, and a pasted
      non-address no longer calls itself a QR code. A failed copy still says "Failed" and
      now logs why. A jsdom test covers the queued notice (shown once, by the next banner);
      100 UI tests

- [x] **3.8 The routing and normalizing rules are tested** · M · `app.ts`, `mobile/shell.ts`,
  `wasm/index.ts` → `wasm/normalize.ts`, `test/`
      why: the route guard tables, the `Map`-versus-object normalizers and `rateForTarget` are
      the rules the screens trust, and none has a direct test; no test renders a screen · done:
      2026-09-29 — the two guard tables are now one pure `guardRoute(route, state, shell)` in
      `guards.ts`, which both shells call with their session read into a `GuardState`. Its 17
      tests include one that runs every one of 72 states, every route and both shells, and
      requires the answer to be a route the guard itself lets through. That test found a
      two-hop redirect: a key screen without usable settings went to Setup, and Setup under
      an open wallet then went on to the wallet, so the shell navigated twice. The guard now
      follows chained rules to the end, and throws on a cycle, which that test shows cannot
      happen. The redirects read the same in the live web app. The normalizers moved
      unchanged to `wasm/normalize.ts`, which imports no wasm, and 8 tests feed them what
      serde-wasm-bindgen really sends (nested `Map`s, `undefined` for `None`).
      `rateForTarget` already had 5 direct tests in `feebump.test.ts`, since 2026-09-09; the
      "none" above was wrong for it. `screens.test.ts` renders real screens in jsdom over the
      real `api`, `session` and guards, and replaces only the wasm wrapper and the IndexedDB
      persister. For 1.3, desktop Key, Restore and Create and all three modes of the phone's
      Restore drop what was typed when the route changes. For 1.7, a sync released after
      Close wallet stamps no sync time; leaving Send after Max discards the drain, whose
      PSBT then answers `unknown_psbt`; and a return to Send builds a fresh transfer. Each
      claim was mutation-checked: removing the dashboard's guard, Send's leave cleanup,
      Key's wipe or the phone Restore's wipe each fails exactly its own test. 133 UI tests.
      Not done: the optional coverage report

- [x] **3.9 Accessibility semantics** · M · `ui/dom.ts`, `mobile/ui.ts`, callers, both CSS
  files · **decision** on the number locale
      why: radiogroups and chip groups have no accessible name; a `<label for>` points at a
      `<div>`; chips are separate tab stops with no arrow keys; no `prefers-reduced-motion`;
      numbers are formatted `en-US` while dates follow the device · done: 2026-09-29 —
      `field()` now labels a form control with `for` and names anything else (a radiogroup
      `<div>`) with `aria-labelledby` to the same visible label, so Setup's two groups and
      Send's target are named by the text beside them. `radioGroup()` takes a name for a
      group that has no label (the dashboard's rescan gaps: "Address gap"), and the phone's
      two unnamed chip groups got theirs ("Network", "Word count"). A test renders every
      screen that has a group, four desktop and five phone, and requires each group to have
      its exact name. The phone's chips behave as native radios do: one tab stop on the
      chosen chip, and the arrow keys (Home and End too) move the choice and the focus. Six
      tests cover it, and removing the key handler fails the two about keys. Desktop groups
      are native radios, which the browser already runs this way. Reduced motion: one
      universal reset in `app.css`, which both shells load (`mobile.css` has no motion), with
      the `!important` lint suppressed for that block alone and the reason given. Numbers
      follow the device, as decided: `formatNumber`, `formatBtc`'s separators and the error
      copy use the device locale; amount fields still read and write plain digits with a
      `.`. The tests that pinned `en-US` now follow the locale too. No new pixels: in the
      live web app Setup's groups read "Network" and "Address type", the one remaining
      `label[for]` points at an input, and numbers look as they did on an `en`/`ko` device.
      144 UI tests

## Round 4 — Shipping

Branch `round-4-shipping`. Versions, bundles, signing, and the documents that go with them.

- [x] **4.1 One version** · S · root `Cargo.toml`, crate manifests, `tauri.conf.json`,
  `scripts/check-version.sh`, `justfile`
      why: `0.1.0` is typed by hand in ten manifests and two Apple files · done: 2026-09-29 —
      `[workspace.package] version` is the one place it is written. All five crates say
      `version.workspace = true` (cargo metadata reads 0.1.0 for each). `tauri.conf.json` now
      points at `../package.json`: tauri-build reads that file, shown by the build failing
      ("must be a semver string") when the pointer names a missing one.
      `scripts/check-version.sh` asserts every other copy (the four `package.json`, both
      `CFBundle*` keys in the checked-in `Info.plist` and `project.yml`) and that no crate
      states its own. Five mutations, one per kind of copy, each fail with an error naming
      the file. It runs in the Linux `core` leg, next to a `just --list` that proves the
      `justfile` parses (`just` is not on this Mac, so the recipes stay one-line calls into
      scripts). `just bump X.Y.Z` runs `scripts/bump-version.sh`: in a throwaway clone,
      bumping to 0.2.0 changed exactly the version lines of seven files plus the five
      workspace entries in `Cargo.lock`, then passed its own check, and `v1.2.3` or `1.2` is
      refused. `release.yml` has a `version` job that every bundle leg needs. On a tag it
      runs the check with the tag (the tag goes in through `env`, not interpolation), and
      `v0.1.1` against 0.1.0 fails. `RELEASING.md` describes it all; the push path filter
      gains `scripts/**` and `justfile`

- [x] **4.2 A changelog and honest tiers** · S · `CHANGELOG.md`, `SECURITY.md` · **admin** for
  the stale objects
      why: no changelog; SECURITY.md promises support for tagged releases that do not exist; a
      2024 draft release with a 92 MB asset and a branch from a closed PR are still on GitHub ·
      done: 2026-09-29 — `CHANGELOG.md` follows Keep a Changelog. Its first section, 0.1.0,
      says what the first version holds, with the pull request each part came from (#3–#36).
      It was drawn from the merged PR bodies and checked against the code; the fixes made
      before any release are left out, since nobody ran a version that had them.
      `RELEASING.md` adds the changelog step to a version bump. SECURITY.md says `main` is the
      only supported version until the first release is tagged. With the OK given, through
      `gh`, and read back: the 2024 draft release (id 186891304, one 92.7 MB asset named
      "kava") is deleted, and so is the branch `fix/remediation-cb472262-242d4e` from PR #9;
      the repository now reads "Bitcoin wallet for desktop, iOS, Android and the browser, on
      one Rust (BDK) core", with the topics bitcoin, bitcoin-wallet, rust, bdk, tauri, wasm and
      esplora

- [x] **4.3 Phone bundles on demand** · M · `.github/workflows/mobile-bundle.yml`
      why: CI compiles the Rust library for three mobile targets and never assembles an app ·
      done: 2026-09-29 — `mobile-bundle.yml`, `workflow_dispatch` only, as decided. The Android
      leg (ubuntu) builds an arm64 debug APK with JDK 17 pinned. The iOS leg (macOS) builds a
      Simulator app. Neither signs, and each uploads its artifact for 7 days. The iOS leg
      asserts `NSCameraUsageDescription`, `NSFaceIDUsageDescription` and the `bitcoin:` scheme
      in the *built* app's Info.plist, found in DerivedData because the Tauri CLI copies a
      Simulator build nowhere. GitHub only dispatches workflows present on the default branch,
      so the file was proven from a short-lived probe branch whose copy differed only by a
      three-line push trigger (branch deleted after). Run 36521331387 was green: both legs
      took about 8 minutes, producing a 67 MB APK and a 33 MB zipped `.app`. The downloaded APK
      installed on a fresh API 34 emulator (`versionName` 0.1.0) and opened on Setup. The
      first runs surfaced two release-path bugs, each fixed in its own commit. The Tauri CLI
      would not build at all (plugin-http crate 2.7 vs npm 2.6). And no macOS runner could build
      the wasm core (Apple's clang has no wasm32 backend), which the release workflow's macOS
      legs would have hit on the first tag

- [x] **4.4 Android release signing** · S · `gen/android/app/build.gradle.kts`, `release.yml`,
  `docs/RELEASING.md` · **credentials**
      why: no `signingConfigs`, so a release APK cannot be signed from this project · done:
      2026-09-29 — `app/build.gradle.kts` gains `signingConfigs.release`, read from a gitignored
      `gen/android/keystore.properties` or from the `ANDROID_KEYSTORE_*` environment. The
      release build type uses it only when one of them exists. It was proven with a throwaway
      key, valid for one day. Signed once through the properties file and once through the
      environment, the arm64 release APK passed `apksigner verify --print-certs` both times
      (APK Signature Scheme v2), naming "CN=Throwaway test key, O=not for release". With
      neither, the build is `app-universal-release-unsigned.apk`, which does not verify, as
      before. `release.yml` gains a `keys` job that reports which signing secrets exist, since
      a job's `if` cannot read secrets. An `android` job that needs it builds all four ABIs
      as a signed `.apk` and `.aab`, checks the APK with `apksigner`, and attaches both to
      the draft release on a tag or keeps them as artifacts on a manual run. `RELEASING.md` has
      the Android section: the four secrets, making the Play upload key, and the local recipe.
      Waiting on credentials: the real upload key, set as those four secrets. Until then
      the job is skipped, not failed

- [x] **4.5 Minification verified** · S · `gen/android/app/proguard-rules.pro` · after 4.4
      why: R8 is on for release and the rules file is all comments; the Kotlin keystore shim is
      reached over JNI · done: 2026-09-29 — the rules file keeps line numbers and nothing else,
      because the run needed no keep rule. R8's merged configuration shows why:
      `proguard-android-optimize.txt` keeps every class with a native method under its own
      name, so `io.crates.keyring.Keyring$Companion` and `initializeNdkContext` survive while
      the outer class is renamed; wry's generated rules keep the webview glue; and Tauri's and
      each plugin's consumer rules keep their `@Command` methods. A minified arm64 release APK,
      signed with the 4.4 throwaway key, replaced the debug app on an API 34 emulator. It
      restored the BIP39 test phrase with Remember ticked and fetched a fee estimate. After a
      force-stop it relaunched on Unlock, showing the remembered address, and unlocked into the
      wallet, with the biometric check running through its plugin. Updating it in place kept
      the wallet. Logcat had no crash, no missing class or method, no JNI error and no Rust
      panic. The `.aab` carries R8's mapping for Play Console. The run also found three scanner
      bugs that had nothing to do with R8; each is fixed in its own commit

- [x] **4.6 iOS release configuration** · S · `tauri.conf.json`, `release.yml`,
  `docs/RELEASING.md` · **credentials**
      why: the export method is `debugging` and there is no team · done: 2026-09-29 —
      `release.yml` gains an `ios` job, gated like the Android one by the `keys` job, which
      now also reports whether `APPLE_API_KEY_P8` exists. The job builds for devices with
      `--export-method release-testing`, which the CLI merges over the checked-in
      `ExportOptions.plist`. It then checks the signature with `codesign` and attaches the
      `.ipa` to the draft release, or keeps it as an artifact. The team comes from the
      environment: the CLI reads `APPLE_DEVELOPMENT_TEAM`, set from the `APPLE_TEAM_ID` secret
      macOS signing already uses, ahead of `bundle.iOS.developmentTeam`, so `tauri.conf.json`
      stays without one. Signing goes through an App Store Connect API key, not an exported
      certificate and profile: CLI 2.11 writes those settings outside the project's build
      settings (tauri-apps/tauri#14462). All of that was read from the CLI's 2.11.5 source.
      `RELEASING.md` has the iOS section: the four secrets, the key's Admin access, and
      registering test devices first. The workflow parses, and its run steps pass shellcheck.
      Waiting on credentials: an Apple developer team and that API key. Until they exist the
      job is skipped, not failed

- [x] **4.7 CodeQL scans what ships** · S · repository setting, `README.md` · **admin**
      why: default setup scans Go and Python — the frozen reference and a design generator ·
      done: 2026-09-29 — the default setup's API cannot do this. Its PATCH accepts no `rust`
      (only actions, c-cpp, csharp, go, java-kotlin, javascript-typescript, python, ruby and
      swift, on both API versions), so dropping Go and Python there would drop Rust too. With
      the OK given, `.github/workflows/codeql.yml` scans actions, javascript-typescript and rust
      from source (`build-mode: none`) on pull requests, on pushes to `main` and weekly, and the
      default setup is off (`not-configured`, read back). A probe branch that added itself to the
      push trigger ran it once (36528289927). Actions checked 17 rules and JavaScript/TypeScript
      87, with no results. Rust checked 26 in 8½ minutes and matched the three CLI alerts
      already dismissed (#15–#17), which stay dismissed. The README says the Go reference is not
      scanned

- [x] **4.8 `justfile` and contributor documents** · S · `justfile`, `README.md`,
  `CONTRIBUTING.md`, `apps/native/design/README.md`, `docs/signet-rig/`
      why: the wasm build command is written out in five places; there is no contributor guide;
      the design generator and the canvas republish recipe are undocumented; the phone test rig
      is three sentences of prose · done: 2026-09-29 — `just --list` shows nine recipes: wasm,
      check, test, regtest, android-apk, ios-sim, version, bump, signet. Each is a line or two
      over a script, so `just` stays optional; it is not installed on this Mac, so the recipes
      were run with its release binary from a scratch directory. The wasm build is now
      written once, in `scripts/build-wasm.sh`, which `just wasm` and CI's wasm-core action
      both run. `scripts/with-wasm-cc.sh` gives any command a wasm32-capable C compiler on
      macOS, and the composite now only makes sure the image has one. `just check` (12 s)
      and `just test` (25 s: 5 CLI, 76 core, 9 binding, 2 wasm32 deadline and 150 UI tests)
      pass here. `CONTRIBUTING.md` covers setup, what each recipe runs, and how work is tracked,
      committed and designed. The README's Tests, Apps and phone sections use the recipes, and
      its Contributing section points to `CONTRIBUTING.md`. `apps/native/design/README.md` says
      what each file is, how to run `gen.py`, and to diff against the live canvas before
      republishing over it. `docs/signet-rig/` has `bitcoin.conf` (OP_TRUE challenge, RPC on
      127.0.0.1), `start.sh` (bitcoind plus an Esplora electrs on :3002), `mine.sh` and a
      README with the emulator URL. The scripts are shellcheck-clean and their guards were
      exercised, but the rig itself was not re-run: the downloaded bitcoind is x86_64 and this
      Mac has no Rosetta

- [x] **4.9 First tag** · S · `v0.1.0` · **decision** (outward-facing) · after 4.1 and 4.2
      why: the release workflow's tag path has never run · done: 2026-09-29 — `v0.1.0` tags
      `7cf6c80`, the merge of Round 4 (#36), whose tree is the one CI passed. The tag's run
      (36532310845) passed the version check against the tag and built the four desktop legs
      in 18 minutes. The phone jobs were skipped, since no signing keys exist yet. The draft
      release `v0.1.0` holds nine unsigned installers: a `.dmg` and an `.app.tar.gz` for each
      Mac architecture, an `.msi` and a `-setup.exe` for Windows, and a `.deb`, an `.AppImage`
      and an `.rpm` for Linux. Publishing it is left to the user

## Round 5 — Bugs first

Branch `round-5-bugs-first`. What the checks around the first tag turned up, fixed before any
new feature.

- [x] **5.1 A first sync that can finish on a slow link** · M ·
  `crates/wallet-core/src/backend/esplora.rs`, `packages/wallet-ui/src/net.ts`, both shells
      why: the first sync is one full scan inside a 180 s budget, and a scan that runs out keeps
      nothing, so a wallet whose history takes longer to fetch starts over every time and never
      syncs; the BIP39 test phrase on signet did this over the emulator's ~265 ms link (4.5) ·
      done: 2026-09-29 — a scan no longer has a budget of its own; each request has one. A
      scan's length follows the history. After the scripts, BDK fetches one block hash per
      confirmation height, one after another and with no progress signal, so no fixed window
      fits every wallet. A first attempt that cut a scan off after two quiet minutes failed on
      exactly that tail. Natively, reqwest already bounds each request. On wasm32,
      `esplora-client` drops its timeout, so the shells' `fetch` now bounds each chain request
      at 30 s (`net.ts`, used by the desktop, phone and browser shells). It rejects with the
      value reqwest's wasm client reads as its own timeout, so the error stays the typed "did
      not answer within 30 s". It also hands reqwest's cancellation to Tauri's HTTP plugin,
      which never saw it before. `test/net.test.ts` has four tests, and taking away the limit
      or the abort forwarding fails them. On an API 34 emulator with the release build, the
      test phrase (281 transactions over 170 block heights) finished its first sync in about
      200 s, where the old build failed at 180 s every time. Pointed at a server that accepts
      and never answers, a sync failed after 30 s with "The backend did not answer within
      30 s."

- [x] **5.2 QR reading without Google Play Services** · S · `gen/android/app/build.gradle.kts`
  (no canvas)
      why: the scanner plugin decodes with Play Services' ML Kit model, downloaded on first use,
      so a phone without Play Services opens the camera and never reads a code, and a new
      install reads nothing until the download ends · done: 2026-09-29 — the app now depends
      on `com.google.mlkit:barcode-scanning` 17.3.0, which puts ML Kit's barcode model in the
      app (`libbarhopper_v3.so`, one per ABI). It sits on top of the Play Services artifact the
      plugin takes its API from. A dependency substitution was tried first, and it cannot
      work: the bundled artifact itself depends on that one. The release build ran on an API
      34 emulator with Google Play Services disabled. Its logcat read "Considering local module
      com.google.mlkit.dynamite.barcode:10000 and remote module …:0", then "Selected local
      version", then the decoder starting, with no wait for a download. R8 keeps the module
      descriptor that ML Kit looks up by name. The arm64 APK grows by 5.9 MB (16.8 → 22.8 MB).
      No real QR code was decoded: the emulator's virtual camera cannot be aimed at its poster
      without the emulator's window, and eight headings found nothing

- [x] **5.3 No P2PK hint on desktop Setup** · S · `packages/wallet-ui/src/screens/setup.ts`
      why: Setup's address type still says "P2PK funds are not discoverable by public indexers",
      though P2PK has not been a choice there since #7 · done: 2026-09-29 — the hint is gone.
      A jsdom test renders desktop Setup and finds no P2PK in it, matching the word on its own
      because the P2PKH choice starts the same way. With the hint put back, the test fails

## Round 6 — Product

Branch `round-6-product`. Picked on 2026-09-30: finish what exists, security, and power
features. Every screen goes to the design canvas first, in one batch (6.6). The core and CLI
items before it change no screen, so they land while that batch is reviewed.

- [x] **6.1 CLI `rescan`, `send --max`, `tx <txid>`** · S · `crates/wallet-cli/src/main.rs`
  (no canvas)
      why: the core has `rescan(stop_gap)`, `build_drain` and `transaction(txid)`, and the CLI
      reaches none of them · done: 2026-09-30 — `btcw rescan`, `btcw tx <txid>` and `btcw send
      --max --to ADDRESS` reach them. From this Mac on signet, with the BIP39 test phrase:
      `rescan --gap 30` found 281 transactions and 1,313,215 sat; `tx` printed a received
      transaction (block 324051, 53,457 sat to the wallet); `send --max --dry-run` signed a
      5-input PSBT sending 1,312,642 sat with a 573 sat fee, the whole balance, and
      `change_sat` 0. `--max` takes exactly one `--to` and no amount. The CLI's tests cover
      those rules, how the new commands parse, and a rescan gap out of range exiting with the
      core's code (21)

- [x] **6.2 A remembered wallet is reachable after Setup** · S · `guards.ts`, `api.ts`, both
  Setup screens (no canvas: routing only)
      why: Setup always continues to Key and Key never links to Unlock, so a remembered wallet
      is reachable only by restarting the app; and Unlock pairs the remembered wallet's
      network with the current config's server · done: 2026-09-30 — both Setups continue to
      Unlock when this device keeps a wallet for the network chosen there, and to Key
      otherwise. Boot and both shells' guards ask the same question (`canUnlockHere`), so
      Unlock is closed for a wallet saved on another network. Unlock itself refuses one before
      it reads the key: "The wallet saved on this device is on Testnet4. Choose Testnet4 in
      Setup to open it." (`wrong_network`). Seven jsdom tests cover both Setups, the guard's
      input, the refusal and a matching unlock; breaking the routing, the network check or
      the refusal fails four of them

- [x] **6.3 Coin control in the core** · M · `wallet.rs`, `wallet-wasm`, `wasm/index.ts`,
  `api.ts`
      why: sends choose coins on their own, and no coin can be kept out of them · done:
      2026-09-30 — `set_frozen` locks and unlocks a coin with BDK's `lock_outpoint`, saved in
      the ChangeSet: a handle reopened from the same store sees the freeze, and then sees it
      lifted. BDK's selection already leaves locked coins out of automatic sends and Max, but
      its `balance()` counts them. So the balance now has a `frozen` part of its own: out of
      spendable, still in the total. `build_transfer_from` and `build_drain_from` spend exactly
      the chosen coins (`add_utxos` + `manually_selected_only`) and refuse a frozen one. A
      chosen coin that is spent or not ours fails with the new `unknown_coin` (CLI exit 28).
      The wasm bindings, the TS wrapper and `api` carry it all (`setFrozen`, and `coins` on
      both builds), and `Utxo` and `Balance` say what is frozen. Four core tests and two UI
      tests cover it. The regtest case `chosen_coins_move_and_a_frozen_one_stays` runs in CI's
      regtest job, since this Mac cannot run bitcoind

- [x] **6.4 CPFP and cancel in the core** · M · `wallet.rs`, `wallet-wasm`, `api.ts`,
  `feebump.ts`
      why: only an outgoing transaction can be sped up, and nothing can take one back · done:
      2026-09-30 — `build_cpfp` spends our unspent, unfrozen outputs of an unconfirmed
      transaction back to us, with a fee that brings the pair to the chosen rate and never
      leaves the child under the relay minimum. It works for incoming payments too: their fee
      is known from the previous outputs Esplora reports. `build_cancel` replaces an
      unconfirmed send with one paying everything back to us. BDK checks a replacement's rate
      or its fee, never both, so the cancel pays the larger of the rate over its own size and
      the original's fee plus 1 sat/vB of that size (BIP125 rules 3 and 4). Both come back as
      an ordinary preview (`api.buildCpfp`, `api.buildCancel`), signed and broadcast like any
      send, and `canPayForParent` says when a child can help. Four core tests: the pair lands
      within 0.05 sat/vB of the target, and a cancel at 22 sat/vB of a 20 sat/vB send pays the
      original's fee plus its own size, where the rate alone would have paid less. The regtest
      cases `a_child_pays_for_a_payment_someone_else_sent` and `a_cancel_takes_a_send_back`
      run in CI's regtest job

- [x] **6.5 PSBT import in the core** · L · `wallet.rs`, `wallet-wasm`, `api.ts`
      why: a transaction made elsewhere cannot be signed or sent here, and a watch-only wallet
      cannot send what another device signed · done: 2026-09-30 — `import_psbt` reads a PSBT
      in base64 or hex. It writes this wallet's own record of every coin of ours being spent
      over whatever the PSBT claims, and finalizes signatures made elsewhere that our
      descriptors can complete. Then it describes the result: each input ours or not (by our
      own history) and final or not, the outputs, the fee, the size once known, and the net
      effect on this wallet. It also says whether the PSBT can go out and whether this wallet
      can still sign. `sign_psbt` signs our inputs and leaves anyone else's alone.
      `extract_tx`, and with it `broadcast`, now refuses a PSBT with any input not final.
      Before, `Psbt::extract_tx` handed the backend a transaction with an empty signature. A
      review carries a txid only once final, since a legacy or nested segwit signature changes
      it. Six core tests: a watch-only copy's PSBT signed by the keys and sent by the copy, for
      all four address types; partial signatures finalized on import; someone else's input
      left unsigned; an unsigned PSBT refused; hex read like base64. `api.importPsbt`,
      `signPsbt` and `broadcastPsbt` carry it to the screens. The regtest round trip
      `a_psbt_goes_from_a_watch_only_copy_to_the_keys_and_out` runs in CI's regtest job

- [x] **6.6 The Round 6 screens on the canvas** · M · `apps/native/design/`, a new Design
  canvas · **canvas review**
      why: the canvas these screens were drawn on is gone, and every screen below needs one ·
      done: 2026-09-30 — a new canvas, made from Claude's Design type, holds all 37 boards:
      the 23 existing ones, and 14 new ones for 6.7–6.15 with a note beside each. The five open
      choices sat in a brief above them. `gen.py` now writes the canvas's own index format and
      ends each board with the logic block the canvas reads. So the published files are the
      committed ones, and reading the live canvas back matched all 38 files. The user reviewed
      it and said to go ahead; the decisions are below. 3 · Wallet gave Public keys and Rescan
      to Settings, and the brief now records the answers

- [x] **6.7 Reset local history, keep the key** · M · `api.ts`, `persist/indexeddb.ts`, the
  Unlock, Key, Restore and Create screens · after 6.6
      why: a wallet whose saved state cannot be read shows `corrupt_state` and a dead end; on
      Unlock the only way out also deletes the key · done: 2026-09-30 — when the key opens but
      the history saved on this device cannot be read, Unlock, Key, Restore and Create say so
      on both shells and offer "Reset this device's history", with a second step as Forget
      has. Confirming deletes that wallet's IndexedDB record and nothing else, then opens the
      wallet the way the screen was opening it; the key, the remembered record and the
      settings stay. `api.resetHistoryAndOpen` and `resetHistoryAndUnlock` try the open first
      and delete only a record that has just failed to read, so a readable one is never
      touched. A record from a newer version asks for an update and offers no reset, as
      decided. On the phone's Unlock the reset stands where the Unlock button was, as the
      board draws it. 38 jsdom tests in `reset.test.ts` open all ten ways in on both shells:
      the first step deletes nothing, confirming deletes only that history and opens the
      wallet, and a newer version's record offers no reset. In the browser build, a wallet
      whose saved record was overwritten with broken JSON offered the reset from Key; its
      first step left the record alone, and Reset history opened the wallet over a fresh
      record, where a sync brought its signet coin back

- [x] **6.8 Desktop Settings** · M · new `screens/settings.ts`, `guards.ts`, `app.ts` · after 6.6
      why: changing network, server or address type on the desktop means Close wallet, then
      Key, then Back · done: 2026-09-30 — a gear in the top bar of the Wallet page opens
      Settings, and is lit there. It offers what the phone's Settings does. Network, server
      and address type each ask first, then close the wallet and open Setup. It also has
      where a remembered key is kept, Rescan with its gap, the public keys (shown when asked,
      with their copy buttons), Close wallet, and Forget with its second step. Rescan and
      Public keys left the Wallet page, as decided on the canvas. On both shells the guard now
      sends Setup under an open wallet to Settings. Six jsdom tests cover the screen, and one
      boots the whole desktop shell for the top bar; the guard tests follow. The browser
      build was checked against the board

- [x] **6.9 Several recipients on the phone** · M · `mobile/screens/send.ts` · after 6.6
      why: the phone sends to one address; the api and desktop take several · done: 2026-09-30 —
      Add recipient turns Send into a card per recipient, with its address, scan button, amount
      and a × that is gone while only one is left. A lone recipient keeps the To and Amount
      cards, and Max with them; adding a second leaves Max and discards its drain. One sat/BTC
      choice below the cards covers every row and converts them all. Review lists each
      recipient by both ends of its address with its amount, then the fee and the total, and
      one transaction pays them all. A row's scan button now opens the camera on Send itself,
      so the rows already filled in survive it; the code fills the last row without an address,
      or the pressed one when none is empty, as decided. The scan button is the 48px square the
      boards draw: a rule for rows of buttons had stretched it to half the row. Ten jsdom tests
      in `send-multi.test.ts` cover adding and removing, Max, the unit, both reviews, a
      prefilled payment, where a scan lands, a cancelled or unreadable scan, and leaving
      mid-scan; breaking where a scan lands, Max, the unit, the build or the review fails at
      least one of them

- [x] **6.10 Focus rings on the phone** · S · `ui/mobile.css`, `ui/app.css` · after 6.6
      why: rows, tabs and the primary button have no visible focus, and textareas none on either
      shell · done: 2026-09-30 — on keyboard focus only (`:focus-visible`), a phone row or tab
      takes the accent ring inside its edge, so the card and the tab bar cannot clip it. The
      primary button takes a ring in the text colour 2px outside its accent fill (the Scan
      screen's light text colour on that dark screen). Textareas now take the ring every other
      field has, on both shells. A test reads both stylesheets, so a control that loses its
      ring fails. On the Android emulator with a keyboard, Tab put the drawn ring on a Settings
      row (its corners turning with the card), on the Wallet tab and on the Send button, and
      taps drew none

- [x] **6.11 Lock in the background** · M · new `ui/autolock.ts`, `app.ts` · after 6.6 ·
  **decision** (how long, and what happens to a wallet that is not remembered)
      why: an open wallet stays open however long the app sits in the background · done:
      2026-09-30 — `ui/autolock.ts` starts at boot, once for both shells, and watches the
      page's visibility. Hidden, it notes the time and sets a timer, which locks at the
      deadline where timers run, as in a desktop window; on return it checks the clock too,
      since a phone suspends the page. Past the limit, the remembered wallet on a device that
      keeps keys closes to Unlock; any other wallet stays open. `whenIdle` in `api.ts` settles
      once no sync, rescan or broadcast is running, and the lock waits for it. Settings offers
      1, 5, 15 or 60 minutes or Never, 5 by default: a select in the desktop's Security card,
      chips beside Remembered on the phone, and "Not available here" where no key can be kept.
      The platform saves the choice (`lock_after` in the plugin store, or localStorage), and a
      missing or unknown value reads as 5 minutes. Eighteen jsdom tests drive it with fake
      timers and visibility events: both ways of locking, a return in time, a wallet not
      remembered, a sync and a broadcast past the deadline, Never, the saved choice and both
      Settings rows; one boots the phone shell. Breaking the timer, the check on return, the
      wait, the remembered check or the saved choice fails at least one of them. On the
      Android emulator with 1 min chosen, the wallet came back on Unlock after 87 seconds in
      the background, and stayed open after 27

- [x] **6.12 A browser keystore** · L · `apps/web/src/platform-browser.ts`, `platform/index.ts`,
  `ui/remember.ts`, desktop Unlock · after 6.6 · **decision** (key derivation, naming)
      why: the browser build cannot remember a wallet at all · done: 2026-09-30 — the browser
      build remembers a wallet behind an app password. `platform/sealed.ts` derives a key from
      it with PBKDF2-SHA256 over 600,000 rounds and a random 16-byte salt, as decided, and
      seals the key and any BIP39 passphrase with AES-256-GCM under a random 12-byte IV, all
      from WebCrypto. The record holds its format version, round count, salt, IV and
      ciphertext, never the password, in an IndexedDB database of its own
      (`bitcoin-wallet-keystore`, by wallet id). A wrong password fails GCM's check and is
      `wrong_password`, "Wrong password." under the field; a record in a format this version
      does not know is `unknown_secret_format`, refused before anything is derived. The
      platform says `needsAppPassword`; `rememberSecret`, `loadSecret` and the api's opens
      and unlocks carry the password, and an OS keystore is asked exactly what it was. On
      Key, Create and Restore a ticked Remember reveals App password and Confirm app
      password with the board's warning, and the button waits until the two match; Unlock
      asks for it as 2e draws it, and Forget deletes the sealed record too. Settings says
      "in this browser, encrypted with your app password". Fourteen Node tests in
      `sealed.test.ts` cover the round trip, a wrong password, fresh salts and IVs, a changed
      ciphertext, IV or salt, a record moved to another wallet's slot (GCM's additional data
      is the wallet id), unknown formats, the round count and its ceiling of ten times the
      default, and the key store over a map. Fifteen jsdom tests in `app-password.test.ts`
      drive the screens on a browser-like platform and on a keychain one, which shows no
      password field anywhere. Breaking the round count, its ceiling, the wallet binding, the
      format check, the gate, the wipe, where the error is said, the password's way to the
      store or Forget fails at least one of them. Tried in a browser (WebKit, the built app on
      localhost): Remember kept one record in `bitcoin-wallet-keystore`, version 1 at 600,000
      rounds with a 16-byte salt and a 12-byte IV, and the password nowhere in storage. A
      wrong password said "Wrong password." under the field, the right one opened the wallet,
      and Forget left no record. A reload landed on Setup rather than Unlock, until the route
      guard sent a wallet's page to Unlock whenever a wallet is remembered

- [x] **6.13 Coin control on screen** · M · both shells · after 6.3 and 6.6
      why: 6.3 has no way to be used · done: 2026-09-30 — the desktop's Unspent outputs card
      gives each coin a tick box and a Frozen switch, as 3b draws them. Its head counts the
      outputs, the frozen ones and the ticked ones with their sum, beside Send selected, which
      shows only while a coin is ticked. The phone has Coins (M13), from a Settings row that
      counts the coins and the frozen ones. The switch freezes or unfreezes the coin in the
      core, then the coins and the balance are read again; a frozen coin is dimmed and cannot
      be ticked. Send selected hands the ticked coins to Send through the session, and Send
      takes them as it opens. It says "Paying from 2 chosen coins · 61,234 sat", builds and
      drains with exactly those coins, and Let the wallet choose drops them; so does leaving
      Send, sending, or closing the wallet. The desktop's Balance card shows a Frozen stat
      while anything is frozen. 21 jsdom tests in `coins.test.ts` drive both shells over the
      fake core: the list, freezing and unfreezing, ticking, a payment and Max with and
      without the chosen coins, leaving Send, a watch-only wallet, and keyboard focus kept
      through a redraw. Breaking the builds, the hand-over, its release with the wallet, the
      tick or the redraw fails at least one of them. Tried on a signet coin of 29,290 sat in
      the browser build and on the Android emulator: freezing it moved it to the desktop's
      Frozen stat and the phone's "1 · 1 frozen", dimmed it and took its tick away, with focus
      kept on the switch. Send selected opened Send "Paying from 1 chosen coin · 29,290 sat",
      where Max came to 29,180 sat (a 110 sat fee) from that coin alone, and Let the wallet
      choose took Max off and the line away

- [x] **6.14 CPFP and cancel on screen** · M · both shells · after 6.4 and 6.6
      why: 6.4 has no way to be used · done: 2026-09-30 — on both shells, an unconfirmed
      payment that left us a coin offers Speed up, and our own unconfirmed send keeps Bump fee
      and adds Cancel. Confirmed transactions and watch-only wallets offer neither. Each is
      built as a preview first and sent only from its own button. Speed up runs at the
      estimate for the chosen target, raised past the parent's own rate when that is higher.
      Cancel asks first, at a rate past the original's that the core raises to the fee BIP125
      needs. 19 jsdom tests and 3 rate cases cover it. On the Android emulator against public
      signet, a 1 sat/vB payment to the phone offered Speed up at 2.1 sat/vB for the pair. The
      child it broadcast (459 sat fee) confirmed with its parent, 2.10 sat/vB for both, per
      mempool.space. A 10,000 sat send from the phone offered Cancel for 251 sat, paying 29,290
      back, and the node replaced the send with it

- [x] **6.15 PSBT import on screen** · M · both shells · after 6.5 and 6.6
      why: 6.5 has no way to be used · done: 2026-09-30 — the desktop has Import PSBT (7), from
      a PSBT card in Settings beside Public keys, with the top bar's gear; the phone has it
      (M14) from a Settings row after Coins. Both need an open wallet, watch-only included. A
      PSBT pasted, typed or taken from the clipboard is described as soon as it parses: each
      input's outpoint and value, whether it is this wallet's and whether it is signed, each
      output with change marked, and the fee with its rate once the size is known, or
      "unknown". The desktop's Load file… sends a binary `.psbt` (the magic `70 73 62 74 ff`
      first) as base64 and any other file as its trimmed text; the phone scans a PSBT that fits
      one QR code and refuses a BC-UR code as not supported yet. Text that is not a PSBT reads
      "This is not a PSBT the wallet can read." under the field; a refusal at broadcast, which
      the core gives the same code, keeps its own reason. Sign signs this wallet's inputs,
      leaves the result in the field to pass on, and says so when the wallet holds no key for
      any; a watch-only wallet has no Sign. Broadcast stays off until every input is final,
      then keeps the result and opens Result as Send does. An answer for a PSBT since replaced,
      read or signed, is dropped. 37 jsdom tests in `psbt.test.ts` drive both shells over the
      fake core; `guards.test.ts` gains two cases, `errors.test.ts` a refusal in the core's
      words and `desktop-shell.test.ts` the gear on 7. Breaking the order check, the file
      magic, the BC-UR refusal, the copy, the Broadcast gate, the result, the watch-only Sign,
      the no-key note, the field after Sign, the guard or either Settings entry fails at least
      one of them. In the browser build, a binary `.psbt` from `btcw send --dry-run`, its
      signature stripped, was described as one input of this wallet's and two outputs, 281 sat
      at 2.0 sat/vB, and Sign made a PSBT byte for byte the one the CLI had signed. On the
      Android emulator against public signet, the same PSBT pasted into the field with
      Android's own paste was described, signed and broadcast: the network took
      71cdd756…9d7037, the txid the dry run had named. The screen's own Paste was refused by
      the webview there until the apps read the clipboard through the shell; then it filled the
      field and the PSBT was described

## Round 7 — Bugs and one display standard

Branch `round-7-display`. Picked on 2026-09-30: the two wording bugs left from Round 6, and
the display text made one standard across both shells, as the owner asked. Two audits of the
screens found the same thing shown or worded differently in about forty places. The standard
below is what every screen follows from here on; where the shells disagreed, the more common,
clearer or safer variant was taken.

**The display standard**

- **Ids and addresses.** A shortened id — a txid, an outpoint's txid, an address in a list or
  a summary — shows its first 10 and last 8 characters around "…". An address is shown whole
  wherever a payment or an output is reviewed or described: Send's review, a transaction's
  detail, Import PSBT.
- **Amounts.** "1,234 sat", grouped as the device does, except under a table heading that names
  the unit; a count is grouped the same way. Money in is "+", money out "−". A fee rate has one decimal, "2.0 sat/vB"; a size
  is "141 vB".
- **Status and time.** "Pending" means not yet in a block, on both shells, in the pending
  colour. Confirmations are "N confirmations", or "N conf." where a row is tight. Recent times
  read "just now", "N min ago", "Today 14:02", then "Aug 27"; a transaction's detail says
  "Aug 27, 14:02"; syncing says "Synced 14:32". A date is written in the device's language
  (3.9), and a pending transaction is dated by when it was first seen.
- **Words.** One word for each action and each thing, the same on both shells: a "coin" is an
  unspent output, what the wallet owns is "this wallet's", "Cancel" only ever cancels a payment.
  Sentence case, no contractions, "…" and never "...".

**Checked in the running apps** on 2026-09-30, against a signet wallet: the browser build's
desktop shell and the Android emulator read the same for coins, history, a transaction's
detail, Send's review and Settings. The check found three things the tests could not: times
came out on a Korean device as "Today 오후 12:52", so times use the boards' 24-hour clock
(7.5); a history row wrapped a time between "Today" and "07:44"; and "Open in explorer" broke
in two beside "Copy transaction id" on the phone, both fixed in their own commit.

**Reviewed** on 2026-09-30 by four read-only reviews standing in for cubic, whose monthly
limit had been reached: the core's shortfall, the formats and shared sentences, both shells'
screens measured in Chrome, and the whole UI against this standard. They found a Max that
said every coin was frozen with an unfrozen coin left, a fee bump that said nothing of frozen
coins, a minimum rate named under itself, a phone review whose payees wrapped four characters
to a line, and some thirty places that still broke the standard or said a thing two ways.
Each fix is a commit of its own that says so; PR #40 lists what was declined, and why.
cubic reviewed it once its limit reset on 2026-10-01: 15 comments, all valid, each fixed in
its own commit, among them a typed rate built at 7.55 and named 7.5, and a second pass found
nothing more.

- [x] **7.1 A shortfall says what frozen coins hold** · S · `error.rs`, `wallet.rs`, `types.ts`
      why: with every coin frozen, Max said "Need 11 more sat." · done: 2026-09-30 —
      `InsufficientFunds` carries `frozen_sat` and `all_frozen`, which a transfer or a drain
      the wallet chose coins for fills with what the frozen coins hold and whether no other
      coin was left; a send held to chosen coins leaves them at 0 and false, since it names its
      coins itself. A fee bump that needs another coin fills them too, counting the confirmed
      frozen coins alone, the only ones BDK adds to a bump; `all_frozen` means every coin of
      the wallet on every path, as the screens say it. Both shells say "Every coin is frozen.
      Unfreeze one to spend it." when the core says no other coin was left, and "Need 60 more
      sat. Frozen coins hold 50,000 sat." otherwise; the core's own message adds "(50000 sat
      more is frozen)". Nothing available is not the same thing: a coin too small to pay for
      its own input is left out too, which review found the first version took for every coin
      frozen; review also found the bump saying nothing of frozen coins.
      `a_shortfall_says_what_frozen_coins_hold` covers a payment, Max with every coin frozen,
      and a send held to chosen coins, `a_coin_too_small_to_spend_is_not_a_frozen_one` the coin
      too small to spend, and `a_short_fee_bump_says_what_frozen_coins_hold` the bump; the
      error table, a message test and the copy tests pin the details and the words

- [x] **7.2 The history reset says frozen coins go with it** · S · `ui/reset.ts`, `gen.py`
      why: the reset also unfreezes every coin, and its words said only history was deleted ·
      done: 2026-09-30 — the reset's second step now reads "The key stays on this device. The
      history saved here is deleted and downloaded again on the next sync, and any coin you
      froze is unfrozen." on both shells, since which coins are frozen is saved in the same
      record and cannot be read back from a broken one. The reset tests hold the new words on
      all ten ways in, and the canvas generator carries them for the next republish

- [x] **7.3 One format for ids and addresses** · M · new `ui/format.ts`, both shells
      why: four ways to shorten an address, and the phone shortened the payee the desktop shows
      whole · done: 2026-09-30 — `ui/format.ts` holds the one rule, `shortId`, first 10 and
      last 8 characters, with `shortOutpoint` and `outputRole` moved beside it; the desktop's
      `shortTxid` and `shortAddress` and the phone's four `short` helpers are gone. The phone's
      review of a send to several lists each payee whole, one to a row; with one recipient the
      payee is the field above it, on both shells. The phone shows every output whole in a
      transaction's detail, below its actions, and in Import PSBT, through one output line both
      screens share; in a detail an output of this wallet's is "received", the desktop's word.
      The desktop's coin table and both Unlock screens shorten through `shortId`, the table
      keeping the whole address on hover. The phone's Result shows the txid in the block
      Transaction uses, and Settings shows the wallet id in mono. `format.test.ts` pins the
      helpers; `display.test.ts` renders the phone detail, the desktop table and both Unlock
      screens; the Send and PSBT tests hold the whole addresses

- [x] **7.4 One format for amounts, rates and sizes** · M · `ui/dom.ts`, `ui/format.ts`, both
      shells · done: 2026-09-30 — `formatNumber`, `formatSats` and `formatBtc` moved into
      `ui/format.ts`, `ui/dom.ts` re-exporting them, beside `formatRate` with its one decimal,
      `formatVsize` and `feeLine`: "141 sat · 1.0 sat/vB · 141 vB", which both reviews, both
      transaction details and both Import PSBT screens use, breaking only after a "·"; the
      desktop's PSBT table gives the fee's amount a column of its own and the line the rest. A
      review names the rate it was built at: the fee over the rounded-up size reads a tenth
      under it. Every hand-built "N sat" goes through `formatSats`, every count is grouped as
      the device groups numbers, the phone's history rows and PSBT lists gain their unit, and
      the error copy formats through the same helpers. The phone's Send prefills and names its
      rate as the desktop does, rounded up to a tenth once an estimate's float noise is rounded
      away, and never under 1 sat/vB (`typeableRate`, shared with the bump and with the refusal
      that names a replacement's minimum): on signet it named "0.10 sat/vB", a rate the send
      would not pay. "sats" is gone, the desktop's balance reads "—" until it is read as the
      phone's does, and the phone's detail colours money in green as both lists do.
      `format.test.ts` pins rates, sizes and fee lines, `feebump.test.ts` the rounding,
      `display.test.ts` the phone's rate note and history units; the Send, PSBT and amount
      tests hold the new text

- [x] **7.5 One way to say pending, confirmations and time** · M · both shells
      why: pending was grey on one shell and amber on the other, one screen took 0
      confirmations for pending, and three helpers formatted dates · done: 2026-09-30 —
      `ui/format.ts` gains `formatConfirmations` ("Pending", "1 confirmation", "12
      confirmations"), `formatConf` for a tight row ("31 conf."), `formatTime` on the 24-hour
      clock the boards use, without seconds, so no "오후" or "PM" lands beside the app's "Today",
      `formatWhen` ("just now", "12 min ago", "Today 14:02", then "Aug 27", the year only when
      it is not this one) and `formatDateTime` for a transaction's detail. Both history lists
      use `formatWhen`, so the phone shows relative times as the desktop did, and the desktop's
      "3 h ago" becomes "Today 11:32"; both shells say "Synced 14:32", where the desktop said
      "Last synced" and both showed seconds. Pending means no count from the core: the phone's
      list no longer takes 0 for pending. The desktop says "Pending" in the pending colour in
      both its tables and its Pending stat, as the phone does, and counts confirmations
      grouped; its local `formatWhen`, and the phone's `whenLabel`, `dateLabel` and `when`, are
      gone. A detail names a year that is not this one, as the list does, both reading years in
      the device's calendar, and a pending transaction is dated by when it was first seen, not
      last. `format.test.ts` pins the words and times against a fixed now; `display.test.ts`
      renders both shells for Pending and for the sync time

- [x] **7.6 One word for each action** · M · both shells
      why: "Confirm & broadcast" and "Confirm and send", "Edit" and "Cancel", "Use a different
      key" and "Use a different wallet", and more · done: 2026-09-30 — one label for each
      action on both shells: "Confirm and send" where the desktop said "Confirm & broadcast";
      "Edit" leaves a review, where the phone said "Cancel"; "Back" leaves the desktop's Send,
      "Keep it" calls off a chain change in both Settings, and "Stop scanning" closes the
      phone's camera, so "Cancel" only ever cancels a payment. "Use a different wallet" on both
      Unlock screens, whose Forget now asks as Settings does, a warning then Keep it or Delete
      it, where the desktop asked "Really forget?" with no warning. Both Sent screens say
      "Transaction broadcast" and "The network has it. It shows as Pending until it is in a
      block.", and one notice for a send this device could not save. "Copy transaction id" and
      "Open in explorer" everywhere; "Bump fee" on both, the phone's button no longer renaming
      itself; "for the two together" for Speed up; "Amount" and "Total" in both reviews; one
      Max note; "Create new wallet", "Restore from phrase", "Restore wallet", "Generate new
      key", "Request an amount" and "Export public keys" on both. `ui/text.ts` holds the
      sentences both shells share: the Sent lines, Forget's warning for each kind of wallet,
      and the Max note. `text.test.ts` pins them; `display.test.ts` renders both Unlock and
      both Sent screens; the screen tests use the new labels

- [x] **7.7 One name for each thing** · M · both shells
      why: "output" and "coin", "your wallet" and "this wallet", "Txid" and "Transaction id",
      four passphrase warnings (none on phone Create), "can't" and "cannot" · done: 2026-09-30
      — one name for each thing on both shells. A coin is a "coin": the desktop's Unspent
      outputs card is Coins, counts coins and says "No coins yet. Sync to look for them." as
      the phone does, and both lists head the switches "Frozen" and share one hint on what
      freezing does. What the wallet owns is "this wallet's": `whoseInputs`, moved to
      `ui/text.ts`, says "both from this wallet" in Import PSBT and in both transaction
      details, the phone's notes say "change, back to this wallet" and "another wallet's", and
      both Cancel cards pay "back to this wallet". "Transaction id" replaces "Txid"; "Esplora
      server" replaces "Esplora URL"; the recipient field is "Address" on both, its placeholder
      naming the network as the screens do ("Signet address"), and a bad address says "Not a
      valid Signet address.". One passphrase warning on all four screens, the phone's Create
      included, which had none; one Rescan heading and hint; one warning over a new single key,
      the desktop's "Kept in memory only." and "Copy it now; it is not stored anywhere." gone;
      one "Fetching the fee estimate…", a missing estimate called "Estimate unavailable" on
      both, with "floor 1.0 sat/vB", one custom-rate note, and "sync failed, retrying" on both;
      the desktop's public keys add the fingerprint and name each descriptor. The desktop's Key
      screen is "Start a wallet", as the phone's is, and the phone's watch-only door reads
      "Follow a wallet". Setup, Create, the key fields, Public keys, Receive, Unlock and Import
      PSBT say the same sentences on both, kept in `ui/text.ts`, and a banner writes any
      message as a sentence, the core's included. No "can't" is left. The Rescan chips and the
      desktop's uppercased "(optional)" stay as they are. `text.test.ts` pins `whoseInputs`;
      `display.test.ts` renders both shells for the coin hints, Rescan and all four passphrase
      warnings; the screen tests use the new names

## Round 8 — Small fixes

Branch `round-8-fixes`. Picked on 2026-10-02, after Round 7: the loose ends it noticed but did
not cause. The other loose end, two screen tests that timed out once each, did not reproduce,
and is under Not doing.

- [x] **8.1 The fee chips fit a narrow phone** · S · `ui/mobile.css`, `gen.py` · needs: canvas
      why: the phone's four fee chips need 322 px on one row, which a 390 px phone's 324 holds.
      At 360 px (294) their labels broke inside the chips, and at 320 px (254) they broke and
      the row ran 33 px past the card (measured in Chrome) · done: 2026-10-02 — the canvas drew
      it as M8e, and it was approved ("try next"). The tight row wraps now, and a chip's label
      never breaks: at 360 and 320 px Custom moves to a second row and nothing passes the card,
      and at 390 px the four stay on one row, as M8 draws them. Measured in Chrome at all three
      widths on Send's fee and on Speed up's target, with a phone's overlay scrollbars

## Round 9 — Less code

Branch `round-9-less-code`. Picked on 2026-10-02: the owner asked for the duplicated
functions and other refactoring targets to be found, planned and taken out, to bring the
code down. Nothing in this round changes what the wallet does, says or draws: every item is a
refactor, and every item has a proof.

**How the targets were found**

1. **Measured.** Code, comment and blank lines per area over the tracked sources, leaving out
   the frozen Go reference, the generated phone projects, the boards `gen.py` writes and the
   lockfiles: 27,055 code lines at `2fefe72` (34,955 lines in all).
2. **Mechanical leads.** A token clone detector, exact and with names abstracted, over the
   Rust, TypeScript, CSS, Python, YAML and shell; and a dead-code pass over TypeScript
   exports, Rust `pub` items and CSS classes. Dead code was almost nil, so the gain is in
   repetition.
3. **Read.** Seven read-only reviews, one per area: the core; the bindings, CLI and regtest
   tests; the two shells' screens; the TypeScript modules; the UI tests; the stylesheets; the
   board generator and CI. Each checked every lead against the code and looked for logic
   repeated in other words.
4. **Triage.** A target was taken when it saves lines net, keeps behaviour, text, markup and
   rendering exactly, and has a proof. Code golf, fewer tests or assertions, weaker types,
   formatter changes and anything visual were ruled out, and so were merges that would tie
   together code that only happens to look alike. The leads not taken are in the PR, each
   with its reason.

**How an item is proved.** After every commit the whole gate is green (`just check`,
`just test`, the regtest build), and the names of the tests are the same as before it, so
no test was lost. On top of that, each item names its own proof: the DOM of every screen
state the UI suite reaches (251 states, dumped with field values, checkedness, focus and the
URL) is byte-identical; Chrome computes the same style for every element of those states,
at desktop and phone widths, light and dark; the boards regenerate byte-identical; and a
path no test reaches is pinned first by a characterization test, run on the old code and
the new.

**The core and the CLI**

- [x] **9.1 The core's tests share their fixtures** · M · `wallet.rs` (tests)
      why: one recipient is written out in ten lines sixteen times, a coin id in five lines
      seven times, a persister twice under two names, and two reviewed-size tests and two
      replaceability checks are each one body written twice · done: 2026-10-02 — `pay_to`,
      `elsewhere`, `coin_at`, `frozen_ids` and `funded` stand for what the tests wrote out;
      `Recorder` gives way to `SharedPersister`, the reload test uses `open_from`, the
      replaceability checks run in one loop over both transactions, and the two reviewed-size
      tests share one body, which now also asserts each test's input count. 364 lines out, 137
      in. The same 107 test names (the core's and the CLI's) pass before and after, and every
      assertion that left a test body runs in the helper or loop that took its place
- [x] **9.2 One mock backend, shared by its clones** · S · `backend/mock.rs`, `wallet.rs`
      why: a 27-line forwarding backend exists only so a test can keep a handle on what the
      mock recorded, and the mock carries two canned answers no test sets · done: 2026-10-02 —
      the mock derives `Clone`, its clones sharing what they record behind an `Arc`, so the
      forwarder goes, and so do the canned scan and sync answers no test set. The `Failing`
      backend stays: its unreachable methods prove that nothing but broadcast talks to the
      backend. The same 107 tests pass
- [x] **9.3 The error table writes a plain sample on one line** · S · `error.rs` (tests)
      why: each message-only variant takes six lines of the table that pins codes and messages
      · done: 2026-10-02 — a `Sample` alias and `plain(variant, code, message)` write the
      message-only rows; rustfmt keeps five of them over several lines, so 28 lines go rather
      than 34. The 19 rows hold the same data and the three table tests pass
- [x] **9.4 An address, a wallet id and an account xpub, each derived one way** · S ·
  `keys.rs`, `wallet.rs`
      why: the derivation tail is written three times, the id format three times and the walk
      to the first xpub three times · done: 2026-10-02 — `address_for_key` derives every kind's
      first receive address through one tail, `wallet_id` picks a prefix and a hash per kind
      and formats once, and `first_xpub` finds the account xpub for the id,
      `public_descriptors` and a test; `watch_only_descriptors`' doc sits on it again. A test
      run on the old code and the new, then removed, printed `wallet_id` and `address_for_key`
      for 12 kinds of key on 4 networks and 5 address types, and the public descriptors and id
      of 7 opened wallets: 248 lines, byte-identical
- [x] **9.5 A transfer and a drain build through one path** · S · `wallet.rs`
      why: both lock, resolve chosen coins, set the rate and sequence, finish, name the
      shortfall, persist and summarize, in two copies · done: 2026-10-02 — `build_paying(coins,
      rate, paid)` holds the build, and `transfer` and `drain` keep their own checks and call
      it, with the builder's setters in the order each called them. Every send test passes,
      among them chosen coins, frozen coins, a shortfall, a drain with no change and a payment
      to an address of our own
- [x] **9.6 A chain position and a transaction's outputs, read in one place** · S ·
  `wallet.rs`
      why: confirmations, height and time are read from a chain position three times, and a
      transaction's outputs are described twice · done: 2026-10-02 — `chain_status` reads
      confirmations, height and time for the coins, the history and a transaction's detail, and
      `outputs_of` describes the outputs of a detail and of a PSBT review. The history's new
      sort key orders as the old one did: a test written first on the old code pinned the whole
      order of three confirmed and four pending transactions, one pair tied and one seen twice,
      and printed every summary, detail, coin and two reviews, byte-identical after the change;
      then it was removed
- [x] **9.7 The CLI's exit codes come from the core's error ordinal** · S · `error.rs`,
  `wallet-cli`
      why: the CLI's 19-arm exit-code match is the core's test-only ordinal plus ten · done:
      2026-10-02 — `Error::ordinal` is public, the core's table test uses it, and the CLI exits
      with 10 plus it. A new assertion that the 19 codes are exactly 10 to 28, in order, passed
      on the old code first and stays
- [ ] **9.8 The CLI's error derives its messages** · S · `wallet-cli`
      why: `Display` and `From<Error>` are written by hand for what `thiserror` derives, as
      the core already does · done when: the same messages, derived

**The bindings and the regtest suite**

- [x] **9.9 The regtest files share the node and wallet helpers** · M · `regtest-tests`
      why: `flows.rs` has the helpers that start a node, fund, confirm, open and send, and the
      other three files type them out again: the node start five times, the funding six times,
      a one-recipient payment seven · done: 2026-10-02 — `tests/common` holds the helpers
      `flows.rs` had (`start`, `fund`, `confirm`, `open`, `send`) and a new `build_payment`,
      and the four files use them; the three wallets made from generated words open from
      `KeyMaterial::parse`, which gives exactly the old literal for words bip39 prints. 341
      lines out, 142 in. Every changed test was read end to end, and a listing of each assert
      and expect per test, before and after, differs only by those now made once inside the
      helpers. The same 12 tests list before and after, and clippy builds all four files with
      -D warnings; they cannot run on this Mac, so CI runs them on this round's pull request
- [x] **9.10 The wasm bindings hand a core result to JS through one helper** · S ·
  `wallet-wasm`
      why: `to_js(&…map_err(core_err)?)` takes seven lines each time rustfmt breaks it · done:
      2026-10-02 — `core_to_js` passes a value through `to_js` or an error through `core_err`,
      for eleven bindings; `generate_key`, `transaction` and `estimate_fee` keep their own
      code, and no exported or js_name symbol changes. Before the change, 27 temporary wasm
      tests pinned what those bindings return on inputs that need no network, as the code,
      message and details or the value in JSON (`import_psbt`'s whole review of a foreign PSBT
      among them). All 27 passed on the old code and the new, each built in a target directory
      of its own, and were removed. The 9 binding tests pass
- [x] **9.11 The Tauri error builds `internal` where it is used** · S · `src-tauri/src/error.rs`
      why: a constructor with one caller · done: 2026-10-02 — `From<tauri::Error>` calls
      `AppError::new("internal", …)` itself: the same code, the same message, no details.
      Clippy builds the app with -D warnings

**The UI's modules**

- [x] **9.12 One builder for every transaction preview** · S · `api.ts`
      why: five builders each check the rate, take the wallet, build and keep the PSBT, and the
      `api` object restates each parameter list to forward it · done: 2026-10-02 —
      `buildPreview(rate, build)` checks the rate, takes the wallet, builds and keeps the PSBT,
      in that order, and the five builders are `api` entries that call it; sync and rescan
      share `thenBalance`, and the entries that only forwarded are written short. The explicit
      copy of the preview's fields stays, as an allow-list. A test run on the old code and the
      new, then removed, gave 135 byte-identical outcomes: the rate refused with no wallet
      open, then for every builder its exact call to the core and its preview, with sync,
      rescan and the shortened entries. `typeof api` is the same type, and the race fix is
      untouched
- [x] **9.13 The types and normalizers derive what repeats** · S · `types.ts`, `wasm/*`
      why: a transaction's detail restates its summary's seven fields, two inputs restate a
      coin id, and the input normalizer is written twice · done: 2026-10-02 — `TxDetail`
      extends `TxSummary`, `TxInput` and `PsbtInput` extend `CoinId`, `BuiltTx` extends the
      preview without its id, and one `toTxInput` reads both kinds of input, keeping the order
      of their keys. A type-equality check (with a negative control) shows all four types
      unchanged, and both normalizers give byte-identical results over the test fixtures, Map
      rows, odd values and throwing inputs, 18 cases, on the old code and the new
- [x] **9.14 The wasm core loads once for every plain call** · S · `wasm/index.ts`
      why: five wrappers each await the loader, then call · done: 2026-10-02 —
      `afterLoad(call)` awaits the loader and then calls, for the five plain calls, with the
      same names and types; the unused `address_type` getter goes, on `WalletApi` and on the
      fake. With the generated module mocked, a test run on the old code and the new showed the
      loader run before every call, the arguments passed through, `explorerTxUrl` turning
      undefined into null and a failed load retried: byte-identical logs
- [x] **9.15 A payment request reads its amount with the amount parser** · S · `bip21.ts`
      why: `bip21.ts` keeps private copies of formatting and parsing a BTC amount · done:
      2026-10-02 — it uses `parseAmount` and `formatAmount` from `amount.ts`, with one guard: a
      URI's amount is never trimmed, as `btcToSats` never trimmed. The old and new code agree
      on 991,739 amount strings (74,905 accepted), 320,020 sat values, 1,983,478 URIs parsed
      and 320,020 built; without the guard, 46,591 strings differ, so the corpus does test it
- [x] **9.16 One copy of the IndexedDB plumbing** · S · `persist/*`
      why: the wallet state and the sealed secrets open, upgrade and transact with IndexedDB in
      two copies of the same code · done: 2026-10-02 — `persist/idb.ts` has
      `objectStore(spec)`, which opens its database once, retries one that failed and runs one
      request per committed transaction; the wallet state and the sealed keys each describe
      their database in a `StoreSpec`. The twelve error messages are the same, character for
      character. A test with an in-memory IndexedDB, run on the old modules and the new and
      then removed, logged 16 scenarios (upgrade, open errors, blocked, retry, request and
      transaction errors and aborts, throws, no IndexedDB) byte-identical
- [x] **9.17 Icons named from their shapes; the unused share icon goes** · S · `ui/icons.ts`,
  `gen.py`
      why: the 21 icon names are listed twice, and no screen or board draws `share` · done:
      2026-10-02 — `IconName` is the keys of the shape table, `shapeAttrs` gives each shape its
      attributes in the old order, and `share` leaves icons.ts and gen.py. `IconName` is the
      old union less `share`, the markup of all 20 icons at three sizes and the brand mark is
      byte-identical on the old code and the new, and the boards regenerate byte-identical
- [x] **9.18 The clock, the Remember box, a field's error and a button's class, once each**
  · S · `ui/*`
      why: small blocks repeated in the shared UI modules · done: 2026-10-02 — `CLOCK` and
      `dayOf` in `format.ts`, `rememberBox` in `remember.ts`, `setFieldError` in `ui/dom.ts`
      (used by the app password and the PSBT field), and a desktop button's class built from
      its variant. Old and new `format.ts` agree on 15,552 cases (12 locales, 6 time zones),
      and every button variant and size and the Remember and app-password states render
      byte-identical
- [x] **9.19 The Tauri store read and written through two helpers** · S · `platform-tauri.ts`
      why: four store methods repeat the load, read or write, and save · done: 2026-10-02 —
      `readStore` and `writeStore` (null deletes the key) carry the four store methods, with
      the same file, keys and calls. With the Tauri plugins mocked, a run on the old file and
      the new, then removed, logged 34 steps byte-identical: each method on an empty, set and
      odd stored value, every lock choice, and a failing load or save

**The screens**

- [ ] **9.20 A held fee-bump or cancel preview is sent through one helper** · M ·
  `dashboard.ts`, `mobile/screens/tx.ts`
      why: both shells hold, drop and send a preview with the same counter and the same
      failure handling, written four times · done when: one `heldPreview`, the failure paths
      pinned by tests on the old code
- [ ] **9.21 A screen that lacks what it shows sends you on in one call** · S · 20 screens
      why: `navigate(route); return el("main")` twenty times · done when: one `redirect`,
      each screen's guard pinned by a test on the old code
- [ ] **9.22 Forget, Setup and Rescan, one way on both shells** · M · `ui/settings.ts`
      why: forgetting a wallet is written three times and its desktop card twice; Setup's
      Continue and Rescan once per shell · done when: shared helpers, the failure paths
      pinned by tests on the old code
- [ ] **9.23 One scan-in-place for the phone's Send and Import PSBT** · S · `mobile/*`
      why: 27 identical lines in both screens · done when: one helper
- [ ] **9.24 The phone Restore's opener catches and offers the reset** · S ·
  `mobile/screens/restore.ts`
      why: three identical try/catch blocks around it · done when: once, inside
- [ ] **9.25 One guard and render loop for both shells** · S · `app.ts`, `mobile/shell.ts`
      why: the same guard read, redirect and hashchange wiring in each shell · done when:
      one `listen`
- [ ] **9.26 One heading helper for the desktop's screens** · S · `screen.ts`
      why: the same `screen-head` block on nine screens · done when: one `screenHead`
- [ ] **9.27 The phone's containers, ledes and counts use the shared helpers** · S ·
  `mobile/*`
      why: the phone redoes what `el`, `lede` and `counted` already do · done when: it uses
      them
- [ ] **9.28 The unit chips and the fee targets are built once** · S · `ui/dom.ts`, `types.ts`
      why: Send rebuilds the dashboard's unit chips, and the target choices are written four
      times · done when: one of each
- [ ] **9.29 The send screens show a field's error through the shared helper** · S · both
  `send.ts`
      why: the four lines 9.18 shares are still written out on both Send screens · done when:
      they use it

**The UI tests**

- [x] **9.30 A screen is mounted at its route in one call** · M · `test/*`
      why: `at(route); mount(render())`, often with a settle, 65 times · done: 2026-10-02 — the
      harness has `mountAt(route, render)` and `showAt(route, render)`, which also settles, and
      80 sites use them. Where one `at` stood before several mounts, a temporary assertion on
      the URL before each later mount passed first. Skipped: display's three `showTransaction`
      sites, which also hand the screen its txid, and speedup-cancel, where the import would
      outgrow a line and add lines. The same 442 tests pass with the same expect count in every
      file, and the 251 screen states the suite reaches dump byte-identical to the base (field
      values, checkedness, focus and the URL with them)
- [x] **9.31 The reset and late-open tests share their openers** · S · `test/*`
      why: five openers are written in both files · done: 2026-10-02 — `test/openers.ts` holds
      the ten openers, each rendering at its route; reset runs all ten and late-open the five
      it names, choosing what to hold by whether the opener unlocks a remembered wallet. Each
      file's tests keep their names and order, the expect counts are the same, and the 251
      screen states the suite reaches dump byte-identical to the base (field values,
      checkedness, focus and the URL with them)
- [x] **9.32 The shared fixtures live in fakes** · S · `test/fakes.ts`
      why: the same remembered wallet six times, the phrase three, a summary copied out of a
      detail three, an in-memory sealed store twice · done: 2026-10-02 — `fake.PHRASE`,
      `fake.SAVED`, `fake.summaryOf(detail)` (a fresh row each call) and `fake.memoryStore()`
      (a fresh map each call). Nothing in the source or the tests writes into a remembered
      record, so one shared record is safe, and the Node-environment sealed tests load nothing
      new at run time. The same 442 tests pass, and the 251 screen states the suite reaches
      dump byte-identical to the base (field values, checkedness, focus and the URL with them)
- [x] **9.33 The wasm core and IndexedDB are mocked for every file at once** · S ·
  `vitest.config.ts`
      why: twelve files open with the same two mocks · done: 2026-10-02 — `test/setup-fakes.ts`
      makes the two mocks for every file, and says a test of either real module must
      `vi.unmock` it. Shown first on vitest 5.0.2: a file stripped of its own mocks passed and
      was the only one whose factories ran, it failed without the setup file, and only the
      twelve files reach either module. The same 442 tests pass, with the same console output,
      and the 251 screen states the suite reaches dump byte-identical to the base (field
      values, checkedness, focus and the URL with them)
- [x] **9.34 The PSBT and autolock tests open their screens through local helpers** · S
      why: the same two or three opening lines twenty times in one file and eleven in the other
      · done: 2026-10-02 — psbt's `openAnswering` and `openPasted` take 20 sites and autolock's
      `openLocking` 11; `camera()`, which only sets the platform, moves above two calls. The
      same tests pass with the same expect counts, and the 251 screen states the suite reaches
      dump byte-identical to the base (field values, checkedness, focus and the URL with them)
- [x] **9.35 The harness's cleanup is not repeated** · S
      why: six places clear what the harness already clears after every test · done: 2026-10-02
      — six resets of `session.remembered` and two `mockRestore` calls go. A temporary accessor
      saw no read of the record between each removed line and the harness's own reset, over the
      five files' 119 tests, and each removed spy had answered its one call. The same 442 tests
      pass, and the 251 screen states the suite reaches dump byte-identical to the base (field
      values, checkedness, focus and the URL with them)

**The stylesheets**

- [ ] **9.36 CSS that never applies, or repeats what applies, goes** · S · `*.css`
      why: an `h2` rule with no `<h2>`, a banner kind no code shows, two unused tokens, and
      phone declarations that repeat what app.css already gives the same element · done
      when: Chrome computes the same style for every element of every dumped state
- [ ] **9.37 What two screens draw alike is styled once** · S · `app.css`, `mobile.css`
      why: Unlock and Result build the same card, a history row is styled in two rules, a
      table heading restates the label rule · done when: the same computed styles

**The generator and CI**

- [x] **9.38 The boards' repeated parts are drawn with helpers** · S · `gen.py`
      why: eighteen phone boards open and close their frame the same way, eight desktop cards
      their heading row, and every board's file name is listed twice · done: 2026-10-02 — five
      helpers draw what the boards spelled out by hand: `m_screen` (18 phone boards),
      `card_head` (8 desktop cards), `tx_card`, `unlock_card` and `m_outputs`, and each canvas
      row now carries its board, so the second list of file names and its assert go. gen.py
      went from 1,506 lines to 1,422 (1,346 code lines to 1,259). Regenerating leaves all 38
      boards, `canvas.json` and `app-icon.svg` byte-identical, checked by sha256 against the
      base and by `git status` listing only gen.py; only the order of the list it prints
      changed
- [x] **9.39 One composite action sets up Node, pnpm and the wasm core** · S · `.github`
      why: the same three steps in six jobs across three workflows · done: 2026-10-02 —
      `.github/actions/frontend` runs pnpm's setup, Node 22 with the pnpm store cached and the
      wasm-core action, in the six jobs that wrote those three steps out (rust's apps job,
      release's bundle, Android and iOS, mobile-bundle's Android and iOS), each still followed
      by its own `pnpm install`. actionlint 1.7.12 is clean on all four workflows before and
      after, and resolves the new action. Every job keeps its id and name, so the ruleset's
      required checks are untouched. With the action expanded, every job runs the same steps
      with the same inputs; the apt-get and JDK steps now run before Node, which neither uses.
      A pull request runs the apps job; release and mobile-bundle run the same three steps, and
      are proved on their next run

## Later — not picked

Listed, not scheduled; each goes to the design canvas first unless marked otherwise.

- Localization, Korean first, with a locale-aware number formatter
- Labels and contacts (BIP21 `label` is parsed, then dropped)
- The phone shell in the browser build on narrow, coarse-pointer viewports (no canvas — the
  boards exist)
- Fiat display; a theme toggle; non-English BIP39 wordlists; a desktop auto-updater (needs the
  signing key first); animated QR (BC-UR) for PSBTs too large for one code

## Decisions

- 2026-09-14 — Rounds 1–4 scheduled; Round 5 on request.
- 2026-09-14 — vitest is upgraded to 4, not documented as accepted.
- 2026-09-14 — GitHub settings are changed through `gh`, each after an explicit OK.
- 2026-09-14 — The phone bundle workflow runs on manual dispatch only.
- 2026-09-28 — The stray review page is removed, not moved: it reviews a different project.
- 2026-09-29 — Both shells start Send on a 6-block target (3.6).
- 2026-09-29 — Numbers on screen follow the device's locale, as dates do; amount fields keep
  plain digits and a `.` (3.9).
- 2026-09-29 — The first tag is `v0.1.0`, cut from the merge of Round 4 (4.9).
- 2026-09-29 — The browser build is not hosted; 4.10 moved to Not doing.
- 2026-09-29 — CodeQL runs from `codeql.yml`, not the default setup, whose API cannot keep
  Rust while dropping Go and Python (4.7).
- 2026-09-29 — Bugs come first: the three found around the first tag are Round 5, and the
  product list moves to Round 6.
- 2026-09-30 — Round 6 takes three bundles: finish what exists, security, power features.
  Korean localization and the rest wait under "Later".
- 2026-09-30 — The v0.1.0 draft release, which predates Round 5, is left as it is for now.
- 2026-09-30 — The Round 6 canvas was reviewed and approved ("go ahead"). No choice was
  picked by name, so each of the five open choices takes the recommendation it was offered
  with. Any of them can still be overruled.
- 2026-09-30 — A reset of local history is offered only for saved data that cannot be read.
  Data saved by a newer app version asks for an update instead: a reset would lose what that
  version keeps, such as frozen coins (6.7).
- 2026-09-30 — A wallet locks after 5 minutes in the background by default. A wallet that is
  not remembered stays open, since closing it means typing the recovery phrase again (6.11).
- 2026-09-30 — The browser keystore derives its key with PBKDF2-SHA256 over 600,000 rounds and
  encrypts with AES-GCM, both from WebCrypto. The password is called the "App password", to
  keep it apart from the BIP39 passphrase (6.12).
- 2026-09-30 — Several recipients on the phone share one amount unit, and a scan fills the
  last empty row (6.9).
- 2026-09-30 — Rescan and Public keys move from the desktop Wallet page to Settings (6.8).
- 2026-09-30 — The app password has no minimum length: the owner's call. SECURITY.md already
  says a short one can be guessed offline by anyone with the browser's files (6.12).
- 2026-09-30 — The display text follows one standard on both shells (Round 7).
- 2026-10-02 — Round 9 takes refactors only. Each keeps behaviour, text, markup and rendering
  exactly, and has a proof; a lead that would change any of them, or would tie together code
  that only happens to look alike, is left as it is.

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
- `forgetWallet` deleting the keystore entry — by design; the reset in Round 6 is the other path.
- Coverage thresholds — a report may be added (3.8); no gate.
- Hosting the browser build on Pages (was 4.10) — a hosted page that handles keys is a target
  for look-alike copies and for a poisoned deploy, and anyone can build and run it locally.
- Changing the two screen tests that timed out once each during Round 7 — not reproduced in 35
  runs (five in a row, three at once, two with every core busy, 25 of the two files alone), and
  CI has never shown it. Without the failure's own output a change would be a guess; one seen
  again is kept whole.
