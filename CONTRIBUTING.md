# Contributing

Thanks for looking. This is a wallet, so the bar is a little higher than usual:
a change that can lose, leak or misreport money needs a test that would have
caught it. Security problems go to [SECURITY.md](SECURITY.md), not to an issue.

## Getting set up

- **Rust** at the version `rust-toolchain.toml` names, with the
  `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`).
- **wasm-pack**, which builds the core the apps import.
- **Node** within `engines` in the root `package.json`, and **pnpm** at the
  version `packageManager` names (`corepack enable` gives you that one).
- **On macOS, Homebrew's LLVM** (`brew install llvm`). The core's secp256k1 C
  sources are compiled for wasm32, and Apple's clang cannot target it.
  `scripts/with-wasm-cc.sh` finds Homebrew's LLVM for you, and the recipes below
  use it.
- **[just](https://github.com/casey/just)** is optional. Every recipe is a
  line or two over a script or a plain command, so you can copy it out of the
  `justfile` instead.

Then, from the repository root:

```bash
pnpm install
just wasm      # build the wasm core into packages/wallet-ui, where the apps import it
just check     # what CI lints and typechecks, bar clippy on the phone targets
just test      # every test that needs no node
```

The apps load the wasm core as built files, so **rebuild it (`just wasm`) after
changing anything under `crates/`**, or the app keeps running the old core.

## What runs where

| Recipe | What | Notes |
|---|---|---|
| `just check` | fmt, clippy (native, native without default features, and wasm32), Biome, TypeScript, the version copies, the Tauri pairs | the checks CI runs, except clippy on the phone targets, which needs the Android NDK and Xcode |
| `just test` | core and CLI tests, the wasm bindings and wasm-only paths in Node, the UI suite | the UI suite runs as if on a German device, so a number pinned to en-US fails |
| `just regtest` | end to end against a real `bitcoind` and `electrs` | downloads x86_64 binaries on macOS, so an Apple-silicon Mac needs Rosetta; CI runs it on every pull request either way |
| `just android-apk`, `just ios-sim` | a debug phone build | see the README's iOS and Android section for the toolchain |
| `just signet` | a private signet with coins you can mine, for the phone build | [docs/signet-rig](docs/signet-rig/README.md) |
| `just version`, `just bump X.Y.Z` | the app's version, written once | [docs/RELEASING.md](docs/RELEASING.md) |

## How work is organised

Remaining work is tracked in [docs/ROADMAP.md](docs/ROADMAP.md), in rounds of
numbered items.

- **One branch per round, one pull request per round.** It is merged with a
  merge commit, and the branch is deleted. `main` is protected: a change needs
  a pull request with the `rust` workflow's jobs green.
- **One commit per tracker item**, and the item is ticked in that same commit
  with the date and the proof, so the tracker never claims more than the tree
  holds. A bug found along the way gets its own commit.
- **Conventional Commits**: `feat`, `fix`, `refactor`, `test`, `docs`, `build`,
  `ci`, `chore`, with a scope where it helps (`fix(wasm): …`). The body says
  why, and how the change was checked.
- **Visual changes are designed first.** A new screen or a visible change goes
  to the design canvas and is reviewed there before it becomes code; see
  [apps/native/design/README.md](apps/native/design/README.md).
- **Say what was proved, and how.** "Tests pass" is the floor. The tracker's
  entries show what a good proof looks like: a failing test that passes after
  the fix, a mutation the tests catch, a run against a real node.
