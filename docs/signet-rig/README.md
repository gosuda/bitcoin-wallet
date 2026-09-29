# A funded chain for the phone build

To send from the phone build you need coins. Public faucets are slow and
rate-limited, and regtest can't be picked on the phone (it needs a node on
localhost). A private signet works: its challenge is `OP_TRUE`, so anyone can
mine a block, and this machine's electrs serves it to the app.

```bash
cargo test -p regtest-tests --no-run   # once: downloads bitcoind and electrs
just signet                            # or docs/signet-rig/start.sh; leave it running
```

In the app's Setup, choose **Signet** and set the Esplora URL to
`http://10.0.2.2:3002` (the host, as the Android emulator sees it), or
`http://<this machine's LAN address>:3002` for a phone on the same network.
Create or restore a wallet, copy its receive address, then:

```bash
docs/signet-rig/mine.sh tb1q…          # 101 blocks: the first coinbase can be spent
docs/signet-rig/mine.sh tb1q… 1        # confirm what you just sent
```

Sync in the app and the balance appears. Send, bump, drain and the rest now
run against a chain you control.

- **Data** lives in `target/signet-rig`; delete it to start a fresh chain.
  Stop the rig with Ctrl-C (electrs) and
  `target/debug/build/bitcoind-*/out/bitcoin/bitcoin-*/bin/bitcoin-cli -datadir=target/signet-rig/bitcoin stop`,
  or just kill `bitcoind`.
- **Binaries**: set `BITCOIND` and `ELECTRS` to use your own. electrs must be
  Blockstream's Esplora fork (it serves the HTTP API the wallet speaks). The
  ones `bdk_testenv` downloads on macOS are x86_64, so an Apple-silicon Mac
  needs Rosetta to run them.
- **Exposure**: electrs listens on all interfaces so an emulator or phone can
  reach it. It only serves this throwaway chain, and the node's RPC stays on
  127.0.0.1.
- Electrs has no signet mode, so it runs as `--network testnet`. The two share
  the address encoding, and nothing the wallet asks depends on the chain's
  name.
