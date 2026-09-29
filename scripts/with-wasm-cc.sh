#!/usr/bin/env bash
# Run a command with a C compiler that can target wasm32.
#
# secp256k1's C sources are compiled for wasm32 along with the Rust, and
# Apple's clang has no wasm32 backend ("No available targets are compatible
# with triple"). Homebrew's LLVM has one, so on macOS this points the wasm32
# build at it, whichever version is installed. Elsewhere the system clang
# already works and the command runs as it is. A compiler set in the
# environment already wins.
#
#   scripts/with-wasm-cc.sh wasm-pack build crates/wallet-wasm …
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" && -z "${CC_wasm32_unknown_unknown:-}" ]]; then
  llvm=""
  for dir in "$(brew --prefix)"/opt/llvm*/; do
    [[ -x "${dir}bin/clang" ]] && llvm=$dir
  done
  if [[ -z "$llvm" ]]; then
    echo "error: building for wasm32 on macOS needs Homebrew's LLVM: brew install llvm" >&2
    exit 1
  fi
  export CC_wasm32_unknown_unknown="${llvm}bin/clang"
  export AR_wasm32_unknown_unknown="${llvm}bin/llvm-ar"
fi

exec "$@"
