#!/usr/bin/env bash
# Every Tauri crate and its npm half must share major.minor.
#
# The Tauri CLI refuses to build otherwise (tauri ↔ @tauri-apps/api,
# tauri-plugin-X ↔ @tauri-apps/plugin-X), which stops the release and the phone
# bundles, while nothing that runs on a pull request invokes the CLI. Dependabot
# updates the cargo and npm sides separately and cannot keep them in step, so
# this makes the CLI's check on every change. Needs `pnpm install` first.
set -euo pipefail
cd "$(dirname "$0")/.."

# The version Cargo.lock resolves for a crate, or nothing if it is not there.
locked_version() {
  awk -v want="name = \"$1\"" '
    $0 == want { found = 1; next }
    found && /^version = / { gsub(/version = |"/, ""); print; exit }
    /^\[\[package\]\]/ { found = 0 }
  ' Cargo.lock
}

# A version's major.minor, whatever prerelease or build part follows it.
major_minor() {
  if [[ "$1" =~ ^([0-9]+\.[0-9]+)\. ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}

failed=0
checked=0
for dir in apps/native/node_modules/@tauri-apps/*/; do
  pkg=$(basename "$dir")
  case "$pkg" in
    api) crate=tauri ;;
    plugin-*) crate="tauri-$pkg" ;;
    *) continue ;;
  esac
  crate_version=$(locked_version "$crate")
  [[ -n "$crate_version" ]] || continue
  npm_version=$(jq -r .version "$dir/package.json")
  checked=$((checked + 1))
  npm_line=$(major_minor "$npm_version")
  crate_line=$(major_minor "$crate_version")
  if [[ -z "$npm_line" || "$npm_line" != "$crate_line" ]]; then
    echo "::error::@tauri-apps/$pkg is $npm_version but the $crate crate is $crate_version; the Tauri CLI will not build until they share major.minor"
    failed=1
  fi
done

if [[ $checked -eq 0 ]]; then
  echo "::error::no @tauri-apps packages found; run pnpm install first"
  exit 1
fi
if [[ $failed -ne 0 ]]; then exit 1; fi
echo "$checked Tauri crate/npm pairs agree on major.minor"
