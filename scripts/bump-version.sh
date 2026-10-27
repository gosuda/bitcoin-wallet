#!/usr/bin/env bash
# Set the app's version everywhere it is written, then prove it with
# check-version.sh. `just bump X.Y.Z` runs this.
#
#   scripts/bump-version.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/version-files.sh

next=${1:-}
if [[ ! "$next" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "usage: $0 X.Y.Z (plain semver: no leading v, no leading zeroes)" >&2
  exit 2
fi

# Each edit is anchored to the one line that holds the version, so nothing
# else in these files is touched or reformatted.
perl -0pi -e 's/(\[workspace\.package\]\n(?:[^\[\n][^\n]*\n)*?version = ")[^"]*(")/${1}'"$next"'${2}/' Cargo.toml
for pkg in "${packages[@]}"; do
  perl -pi -e 's/^(  "version": ")[^"]*(",)$/${1}'"$next"'${2}/' "$pkg"
done
perl -0pi -e 's/(<key>CFBundle(?:ShortVersionString|Version)<\/key>\n\s*<string>)[^<]*(<\/string>)/${1}'"$next"'${2}/g' \
  "$plist"
perl -pi -e 's/^(\s*CFBundleShortVersionString: )\S+$/${1}'"$next"'/; s/^(\s*CFBundleVersion: )"[^"]*"$/${1}"'"$next"'"/' \
  "$project"

# The workspace crates' own entries in the lockfile follow the manifest.
cargo update --workspace --quiet

scripts/check-version.sh
