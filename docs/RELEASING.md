# Releasing the desktop app

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
(Windows), `.deb`/`.AppImage`/`.rpm` (Linux). The wasm core is built first
because the frontend imports it.

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

## Version numbers

The version comes from `apps/desktop/src-tauri/tauri.conf.json`. Bump it in the
same commit as the tag so the installer and the tag agree.

## Before tagging

`cargo test --workspace`, `cargo test -p regtest-tests`, and a manual pass over
the app. CI covers the first two on every push.
