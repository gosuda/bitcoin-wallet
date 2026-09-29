#!/usr/bin/env bash
# Every file that states the app's version must state the workspace's.
#
# The one source is `version` under `[workspace.package]` in Cargo.toml; the
# crates inherit it, and every other file here is a copy that has to agree.
# `scripts/bump-version.sh` rewrites them all together. Run from anywhere.
#
#   scripts/check-version.sh            check every copy
#   scripts/check-version.sh v1.2.3     also require a release tag to match
set -euo pipefail
cd "$(dirname "$0")/.."

workspace_version() {
  awk '/^\[workspace\.package\]/ { inside = 1; next }
       /^\[/                      { inside = 0 }
       inside && /^version[ \t]*=/ { gsub(/.*=[ \t]*"|".*/, ""); print; exit }' Cargo.toml
}

want=$(workspace_version)
if [[ -z "$want" ]]; then
  echo "::error file=Cargo.toml::no version under [workspace.package]"
  exit 1
fi

failed=0
mismatch() { # file, what, found
  echo "::error file=$1::$2 is '$3', but the workspace version is '$want'"
  failed=1
}

# The crates must not state their own.
for manifest in crates/*/Cargo.toml apps/native/src-tauri/Cargo.toml; do
  if ! grep -Eq '^version\.workspace[ \t]*=[ \t]*true' "$manifest"; then
    mismatch "$manifest" "package.version" "$(grep -E '^version' "$manifest" | head -1)"
  fi
done

for pkg in package.json packages/wallet-ui/package.json apps/web/package.json apps/native/package.json; do
  found=$(jq -r .version "$pkg")
  [[ "$found" == "$want" ]] || mismatch "$pkg" "version" "$found"
done

# Tauri reads the version from the shell's package.json; a literal here would
# be one more copy to forget.
found=$(jq -r .version apps/native/src-tauri/tauri.conf.json)
[[ "$found" == "../package.json" ]] ||
  mismatch apps/native/src-tauri/tauri.conf.json "version (should point at ../package.json)" "$found"

# The generated Xcode project is checked in; the Tauri CLI rewrites these on
# an iOS build, so between builds they must already agree.
plist=apps/native/src-tauri/gen/apple/bitcoin-wallet-app_iOS/Info.plist
for key in CFBundleShortVersionString CFBundleVersion; do
  found=$(awk -v key="<key>$key</key>" 'index($0, key) { getline; gsub(/.*<string>|<\/string>.*/, ""); print; exit }' "$plist")
  [[ "$found" == "$want" ]] || mismatch "$plist" "$key" "$found"
done
project=apps/native/src-tauri/gen/apple/project.yml
for key in CFBundleShortVersionString CFBundleVersion; do
  found=$(awk -v key="$key:" '$1 == key { v = $2; gsub(/"/, "", v); print v; exit }' "$project")
  [[ "$found" == "$want" ]] || mismatch "$project" "$key" "$found"
done

if [[ $# -gt 0 && "$1" != "v$want" ]]; then
  echo "::error::the tag is '$1', but the workspace version is '$want' (tag v$want)"
  failed=1
fi

if [[ $failed -ne 0 ]]; then exit 1; fi
echo "version $want everywhere"
