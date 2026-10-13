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
block_regex='^[[:space:]]*(-[[:space:]]+)?[A-Za-z_][A-Za-z0-9_-]*:[[:space:]]*[|>][-+]?'

for path in "${paths[@]}"; do
  block_indent=-1
  while IFS= read -r line; do
    # Text within a YAML literal/folded block is not a workflow key.
    if [[ "$line" =~ ^[[:space:]]*$ ]]; then
      continue
    fi
    indentation="${line%%[![:space:]]*}"
    indent=${#indentation}
    if (( block_indent >= 0 )); then
      if (( indent > block_indent )); then
        continue
      fi
      block_indent=-1
    fi
    if [[ "$line" =~ $block_regex ]]; then
      block_indent=$indent
      continue
    fi
    if [[ ! "$line" =~ ^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]+([^[:space:]#]+) ]]; then
      continue
    fi
    ref="${BASH_REMATCH[2]}"
    case "$ref" in
      ./.github/actions/frontend|./.github/actions/wasm-core)
        continue
        ;;
      ./*)
        printf '::error file=%s::Unreviewed local action: %s\n' "$path" "$ref"
        failed=1
        continue
        ;;
    esac
    if [[ ! "$ref" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$ ]]; then
      printf '::error file=%s::Unpinned external action: %s\n' "$path" "$ref"
      failed=1
    fi
  done < "$path"
done

exit "$failed"
