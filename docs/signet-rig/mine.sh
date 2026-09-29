#!/usr/bin/env bash
# Mine blocks on the running rig, paying their coinbase to an address — the
# only way coins come into being there. A coinbase can be spent once 100
# blocks sit on top of it, hence the default of 101.
#
#   docs/signet-rig/mine.sh <address> [blocks]
set -euo pipefail
address=${1:?usage: mine.sh <address> [blocks]}
blocks=${2:-101}
if [[ ! "$blocks" =~ ^[0-9]+$ ]]; then
  echo "error: blocks must be a whole number, not '$blocks'" >&2
  exit 2
fi

curl -fsS --user rig:rig -H 'content-type: text/plain' \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"rig\",\"method\":\"generatetoaddress\",\"params\":[$blocks,\"$address\"]}" \
  http://127.0.0.1:38332/
echo
