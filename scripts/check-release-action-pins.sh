#!/usr/bin/env bash
set -euo pipefail

# This release's transitive action dependency boundary. Read-only CI actions
# outside this set cannot access signing secrets or a release-write token.
paths=(
  .github/workflows/release.yml
  .github/actions/frontend/action.yml
  .github/actions/wasm-core/action.yml
)
failed=0

for path in "${paths[@]}"; do
  while IFS= read -r line; do
    if [[ ! "$line" =~ ^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]+([^[:space:]#]+) ]]; then
      continue
    fi
    ref="${BASH_REMATCH[2]}"
    if [[ "$ref" == ./* ]]; then
      continue
    fi
    if [[ ! "$ref" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$ ]]; then
      printf '::error file=%s::Unpinned external action: %s\n' "$path" "$ref"
      failed=1
    fi
  done < "$path"
done

exit "$failed"
