/**
 * How values are written on screen, the same on both shells: the display
 * standard of Round 7 (docs/ROADMAP.md). Screens format through here, so a
 * rule is changed in one place and cannot drift between the shells again.
 */

import type { CoinId } from "../types";

/**
 * An id shortened for a list or a summary: its first 10 and last 8
 * characters around "…", enough to tell two apart at a glance. Used for a
 * txid, an outpoint's txid, and an address in a list or a summary.
 *
 * An address is written whole wherever a payment or an output is reviewed or
 * described — Send's review, a transaction's detail, Import PSBT — so it is
 * never shortened there.
 */
export function shortId(id: string): string {
  // Anything this short would come out no shorter.
  return id.length <= 19 ? id : `${id.slice(0, 10)}…${id.slice(-8)}`;
}

/** An outpoint for a list: its txid shortened, then the output's index. */
export function shortOutpoint(coin: CoinId): string {
  return `${shortId(coin.txid)}:${coin.vout}`;
}

/**
 * What an output is to this wallet: someone else's, change on a spend of this
 * wallet's, or a payment to it. `owner` is the transaction or PSBT the output
 * belongs to, whose net effect tells change from a receipt.
 */
export function outputRole(
  owner: { net_sat: number },
  output: { ours: boolean },
): "recipient" | "change" | "ours" {
  if (!output.ours) return "recipient";
  return owner.net_sat < 0 ? "change" : "ours";
}
