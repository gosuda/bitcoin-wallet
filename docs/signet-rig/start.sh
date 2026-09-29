#!/usr/bin/env bash
# Start the rig: bitcoind on the private signet in bitcoin.conf, and electrs
# serving the Esplora HTTP API over it on port 3002 — the address the phone
# build's Setup points at (http://10.0.2.2:3002 from the Android emulator).
#
# The binaries are the ones the regtest suite downloads; build it once
# (`cargo test -p regtest-tests --no-run`) or set BITCOIND and ELECTRS. Data
# lives in target/signet-rig, so `cargo clean` removes the chain too.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
data="${RIG_DIR:-$root/target/signet-rig}"

first_executable() {
  for candidate in "$@"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
}

bitcoind=${BITCOIND:-$(first_executable "$root"/target/debug/build/bitcoind-*/out/bitcoin/bitcoin-*/bin/bitcoind)}
electrs=${ELECTRS:-$(first_executable "$root"/target/debug/build/electrsd-*/out/electrs/electrs_*_esplora_*/electrs)}
if [[ ! -x "$bitcoind" || ! -x "$electrs" ]]; then
  echo "error: need an executable bitcoind and electrs (have '${bitcoind:-none}' and '${electrs:-none}');" \
    "run 'cargo test -p regtest-tests --no-run' or set BITCOIND and ELECTRS" >&2
  exit 1
fi

mkdir -p "$data/bitcoin" "$data/electrs"
cp "$here/bitcoin.conf" "$data/bitcoin/bitcoin.conf"
"$bitcoind" -datadir="$data/bitcoin" -daemon

rpc() {
  curl -fsS --user rig:rig -H 'content-type: text/plain' \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"rig\",\"method\":\"$1\",\"params\":${2:-[]}}" \
    http://127.0.0.1:38332/
}
for _ in $(seq 1 30); do
  rpc getblockchaininfo >/dev/null 2>&1 && break
  sleep 1
done
rpc getblockchaininfo >/dev/null

# electrs has no signet mode, but testnet shares signet's address encoding and
# nothing the wallet asks for depends on the chain's name; --jsonrpc-import
# fetches blocks over RPC instead of reading a testnet-named block directory.
exec "$electrs" \
  --network testnet \
  --daemon-dir "$data/bitcoin" \
  --daemon-rpc-addr 127.0.0.1:38332 \
  --cookie rig:rig \
  --jsonrpc-import \
  --db-dir "$data/electrs" \
  --http-addr 0.0.0.0:3002 \
  --electrum-rpc-addr 127.0.0.1:60401
