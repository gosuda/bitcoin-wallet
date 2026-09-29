# Tasks for this repository; `just --list` shows them. Each recipe is a line or
# two over a script or a plain command, so nothing here needs `just` to run —
# copy the line. See CONTRIBUTING.md for what each one is for.

# Build the wasm core into the UI package, where both apps import it from.
wasm:
    scripts/build-wasm.sh

# Lint and typecheck as CI does: Rust native and wasm32, the frontend, the version and the Tauri pairs. Not clippy on the phone targets, which needs their SDKs.
check:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets -- -D warnings
    cargo clippy -p wallet-core --no-default-features -- -D warnings
    scripts/with-wasm-cc.sh cargo clippy -p wallet-core --target wasm32-unknown-unknown --no-default-features --features backend-esplora --all-targets -- -D warnings
    scripts/with-wasm-cc.sh cargo clippy -p wallet-wasm --target wasm32-unknown-unknown --all-targets -- -D warnings
    pnpm check
    pnpm typecheck
    scripts/check-version.sh
    scripts/check-tauri-pairs.sh

# Run every test that needs no node: the core and CLI, the wasm bindings in Node, and the UI.
test:
    cargo test -p wallet-core -p wallet-cli
    scripts/with-wasm-cc.sh wasm-pack test --node crates/wallet-wasm
    scripts/with-wasm-cc.sh wasm-pack test --node crates/wallet-core --no-default-features --features backend-esplora
    pnpm test

# End to end against a real bitcoind and electrs, downloaded on the first build (x86_64 on macOS).
regtest:
    cargo test -p regtest-tests -- --test-threads=1

# An arm64 debug APK for the emulator or a phone; needs JAVA_HOME, ANDROID_HOME and NDK_HOME.
android-apk: wasm
    cd apps/native && pnpm tauri android build --debug --apk --target aarch64

# A debug build of the app for the Apple-silicon iOS Simulator.
ios-sim: wasm
    cd apps/native && pnpm tauri ios build --debug --target aarch64-sim

# Print the app's version, and fail if any copy of it disagrees.
version:
    scripts/check-version.sh

# Set the app's version everywhere, e.g. `just bump 0.2.0`.
bump next:
    scripts/bump-version.sh {{next}}

# A private signet with coins you can mine, for the phone build (docs/signet-rig).
signet:
    docs/signet-rig/start.sh
