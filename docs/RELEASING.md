# Releasing the apps

`.github/workflows/release.yml` builds the installers. It runs in two modes:

- **Manual** (`workflow_dispatch`) — builds every bundle and uploads them as
  workflow artifacts for 7 days. Nothing is published. Use it to check that the
  bundles still build.
- **Tagged** (`push` of `v*`) — builds the same bundles and attaches them to a
  **draft** GitHub release named after the tag. Review it, then publish.

```bash
# cut a release
git tag v0.1.0
git push origin v0.1.0
```

Bundles produced: `.dmg` (macOS, one per architecture), `.msi`/`.exe`
(Windows), `.deb`/`.AppImage`/`.rpm` (Linux). With the store keys set as secrets,
also a signed `.apk` and `.aab` (see [Android](#android)) and an `.ipa` for the
team's registered devices (see [iOS](#ios)). Phone builds for testing are the
separate `mobile bundles` workflow. The wasm core is built first because the
frontend imports it.

## Signing

Without secrets the build still succeeds, and produces **unsigned** bundles:
macOS shows a Gatekeeper warning, Windows shows SmartScreen. Add the secrets
below and the same workflow signs and notarises — no workflow edits.

### macOS

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the "Developer ID Application" `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Example (TEAMID)` |
| `APPLE_ID` | Apple ID used for notarisation |
| `APPLE_PASSWORD` | an **app-specific** password, not the account password |
| `APPLE_TEAM_ID` | the 10-character team id |

Export the certificate from Keychain Access as `.p12`, then:

```bash
base64 -i certificate.p12 | pbcopy   # paste into APPLE_CERTIFICATE
```

Notarisation happens during the build; the ticket is stapled to the `.dmg`, so
a downloaded build opens without a warning.

### Windows

Not wired up. Tauri signs with `signtool` when
`bundle.windows.certificateThumbprint` is set in `tauri.conf.json` and the
certificate is installed on the runner — add that when a code-signing
certificate exists.

### Android

The `android` job runs only when `ANDROID_KEYSTORE_BASE64` exists; without it the job is
skipped, not failed. With it, the job builds a signed `.apk` and `.aab` for all four ABIs,
checks the APK's signature with `apksigner`, and attaches both to the draft release (or
keeps them as artifacts on a manual run).

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of the upload keystore |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore's password |
| `ANDROID_KEY_ALIAS` | the key's alias inside it |
| `ANDROID_KEY_PASSWORD` | the key's own password |

For Google Play this is the **upload** key; Play App Signing keeps the key that signs
what users install. Make one once and keep it somewhere safer than this repository:

```bash
keytool -genkeypair -v -keystore upload.keystore -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -i upload.keystore | pbcopy   # paste into ANDROID_KEYSTORE_BASE64
```

To sign a build locally, put the same four values in
`apps/native/src-tauri/gen/android/keystore.properties` (gitignored) as `storeFile`
(an absolute path), `storePassword`, `keyAlias` and `keyPassword`, then
`pnpm tauri android build --apk --aab` from `apps/native`. `app/build.gradle.kts`
reads that file, or the `ANDROID_KEYSTORE_*` environment the workflow sets, and leaves
a release build unsigned when neither exists.

### iOS

The `ios` job runs only when `APPLE_API_KEY_P8` exists; without it the job is skipped, not
failed. With it, the job builds the app for devices and exports it with
`--export-method release-testing`, an ad hoc `.ipa` that installs on the devices registered
to the team. It checks the signature with `codesign`, then attaches the `.ipa` to the draft
release (or keeps it as an artifact on a manual run).

Signing goes through an App Store Connect API key. Xcode uses it to fetch or create the
distribution certificate and the ad hoc profile, so no certificate is exported or imported
anywhere.

| Secret | What it is |
| --- | --- |
| `APPLE_TEAM_ID` | the team id — the same secret as for macOS |
| `APPLE_API_ISSUER` | the Issuer ID, shown above the keys table in App Store Connect |
| `APPLE_API_KEY` | the key's Key ID |
| `APPLE_API_KEY_P8` | the contents of the `AuthKey_<Key ID>.p8` file that comes with it |

Create the key in App Store Connect under Users and Access → Integrations, with Admin
access, which Xcode needs to create certificates and profiles. The `.p8` can be downloaded
only once. Register each test device under Certificates, Identifiers & Profiles → Devices
before building: an export does not register devices, and the profile covers only the
ones already registered.

The Tauri CLI can also sign with a certificate and profile passed as `IOS_CERTIFICATE`,
`IOS_CERTIFICATE_PASSWORD` and `IOS_MOBILE_PROVISION`. The workflow does not use that route:
in CLI 2.11 it writes the signing settings outside the Xcode project's build settings
(tauri-apps/tauri#14462).

## Version numbers

The version is written once, as `version` under `[workspace.package]` in the
root `Cargo.toml`. The crates inherit it, and `tauri.conf.json` reads it from the
shell's `package.json`. Every other copy — the four `package.json` files and the
checked-in Xcode project's `Info.plist` and `project.yml` — is held in line by
`scripts/check-version.sh`, which CI runs on every change.

To release a new version, bump it in a pull request, then tag the merge:

```bash
just bump 0.2.0      # or scripts/bump-version.sh 0.2.0: rewrites every copy, then checks
# … pull request, merged …
git tag v0.2.0 && git push origin v0.2.0
```

The release workflow checks the tag against the workspace before it builds
anything, and stops on a mismatch.

## Before tagging

A manual pass over the app. Everything else is what `.github/workflows/rust.yml`
already runs on each pull request and push to `main` that touches code:
formatting, clippy and `cargo test -p wallet-core -p wallet-cli` on Linux, macOS
and Windows; the regtest suite (`cargo test -p regtest-tests`); the wasm build,
and the wasm32 tests in Node (`wasm-pack test --node` for `wallet-wasm` and for
`wallet-core`'s wasm-only paths); clippy for the app shell on the desktop, iOS and
Android targets; and the frontend's lint, typecheck, tests and builds. Nothing runs
`cargo test --workspace`: the only crates it would add are the Tauri shell, which has
no tests of its own, and `wallet-wasm`, whose tests exist only on wasm32 and run
through `wasm-pack` instead. It would also pull in the shell's system libraries for
nothing.
