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
      — Round 5, it needs a button.

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

- [ ] **4.2 A changelog and honest tiers** · S · `CHANGELOG.md`, `SECURITY.md` · **admin** for
  the stale objects
      why: no changelog; SECURITY.md promises support for tagged releases that do not exist; a
      2024 draft release with a 92 MB asset and a branch from a closed PR are still on GitHub ·
      done when: Keep-a-Changelog seeded from the merged PRs; the tier says "main only until
      the first tag"; the draft and the branch are deleted; description and topics set

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

- [ ] **4.7 CodeQL scans what ships** · S · repository setting, `README.md` · **admin**
      why: default setup scans Go and Python — the frozen reference and a design generator ·
      done when: languages are actions, JavaScript/TypeScript and Rust; README matches

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
- A first sync that can finish on a slow link. The first sync is one full scan inside the
  180 s scan budget, and a scan that runs out keeps nothing, so a wallet whose history takes
  longer to fetch starts over every time and never syncs. The BIP39 test phrase on signet did
  this over the emulator's ~265 ms link (4.5). Keeping what each pass found, or a longer
  budget with progress, needs a decision first.
- QR reading without Google Play Services. The Android scanner plugin uses Play Services'
  ML Kit model (`play-services-mlkit-barcode-scanning`), downloaded on first use, so on a
  phone without Play Services the camera opens and never reads a code. Bundling the model
  means changing the plugin (no canvas)

## Decisions

- 2026-09-14 — Rounds 1–4 scheduled; Round 5 on request.
- 2026-09-14 — vitest is upgraded to 4, not documented as accepted.
- 2026-09-14 — GitHub settings are changed through `gh`, each after an explicit OK.
- 2026-09-14 — The phone bundle workflow runs on manual dispatch only.
- 2026-09-28 — The stray review page is removed, not moved: it reviews a different project.
- 2026-09-29 — Both shells start Send on a 6-block target (3.6).
- 2026-09-29 — Numbers on screen follow the device's locale, as dates do; amount fields keep
  plain digits and a `.` (3.9).
- Open: the first tag (4.9); Pages (4.10).

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
