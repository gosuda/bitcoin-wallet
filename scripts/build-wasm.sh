#!/usr/bin/env bash
# Build the wasm core into packages/wallet-ui, where both apps import it from.
#
# The one place this command is written: `just wasm` and CI's wasm-core action
# both run this script. Rebuild after changing anything under crates/, or the
# apps keep running the old core.
set -euo pipefail
cd "$(dirname "$0")/.."
exec scripts/with-wasm-cc.sh wasm-pack build crates/wallet-wasm --target web --release \
  --out-dir ../../packages/wallet-ui/src/wasm/pkg
