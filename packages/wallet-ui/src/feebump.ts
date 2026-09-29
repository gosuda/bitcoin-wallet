/**
 * Speeding a transaction up, or taking it back, as far as a screen needs to
 * know it.
 *
 * Every transaction the core builds signals replaceability, so the only
 * questions here are which rows can be replaced or given a child, and what
 * rate to start from.
 */

import { type FeeEstimate, rateForTarget, type TxSummary, type Utxo } from "./types";

/**
 * Only our own unconfirmed sends can be replaced, sped up or cancelled;
 * everything else is settled. Takes a list row or a detail alike. Whether
 * this wallet can sign the replacement is the caller's other question.
 */
export function isBumpable(tx: Pick<TxSummary, "confirmations" | "net_sat">): boolean {
  return tx.confirmations === null && tx.net_sat < 0;
}

/**
 * Whether a child can speed this transaction up: it is unconfirmed and left
 * an unspent, unfrozen coin of ours to spend. A payment someone else sent
 * qualifies too, which is the case replacement cannot reach.
 */
export function canPayForParent(
  tx: Pick<TxSummary, "txid" | "confirmations">,
  coins: readonly Utxo[],
): boolean {
  return tx.confirmations === null && coins.some((c) => c.txid === tx.txid && !c.frozen);
}

/**
 * The margin a replacement has to clear on top of the original's own rate.
 *
 * BIP125 rule 4 makes a replacement pay for its own bandwidth in addition to a
 * higher absolute fee, so the original's rate is a floor, not a target. One
 * sat/vB is Bitcoin Core's default incremental relay fee.
 *
 * It is a default, not a reading: a node configured above it can still refuse.
 * The Esplora API exposes no incremental relay fee, so there is nothing to ask
 * — this is a starting point rather than a guarantee, and the field is
 * editable.
 *
 * The other half of BIP125, that a replacement pay a higher *absolute* fee, is
 * not a separate hazard here even though a bump can come out smaller than what
 * it replaces. A replacement shrinks by dropping a change output that has
 * fallen below dust, and that output's value becomes fee, so the absolute fee
 * rises rather than falls. The rate floor is enforced before signing, by the
 * builder rather than the node: it derives the requirement from the original's
 * *effective* rate, so a transaction that absorbed its own change demands more
 * than its nominal rate suggests, and says which rate would do.
 */
const REPLACEMENT_MARGIN_SAT_VB = 1;

/**
 * What to prefill the bump field with.
 *
 * Outbidding is two comparisons, not one: the 1-block rate is what the market
 * currently asks, but the transaction being replaced sets its own floor. When
 * fees have fallen since the original send the market rate is *below* that
 * floor, and offering it produces a replacement the node rejects before it
 * reaches the network — the bump button fails on its first press.
 *
 * `originalRateSatVb` is optional so a caller that has not loaded the detail
 * yet still gets a sane starting point; pass it whenever it is known.
 */
export function suggestBumpRate(
  estimate: FeeEstimate | null,
  originalRateSatVb?: number | null,
): number {
  return outbid(estimate ? rateForTarget(estimate, 1) : null, originalRateSatVb);
}

/**
 * The rate Speed up offers for `target` blocks: what the child and the
 * transaction it spends are built to pay together.
 *
 * A child helps only when the pair pays more than the parent already does on
 * its own. At or under that rate the core still builds one, at the relay
 * minimum, and the parent is no nearer a block. So the parent's rate is a
 * floor here as the original's is for a bump, with the same margin, and a
 * target whose estimate falls under it is offered the floor instead.
 */
export function suggestPackageRate(
  estimate: FeeEstimate | null,
  target: number,
  parentRateSatVb?: number | null,
): number {
  return outbid(estimate ? rateForTarget(estimate, target) : null, parentRateSatVb);
}

/** The market rate, or the one to beat plus the margin when that is higher. */
function outbid(market: number | null, toBeatSatVb?: number | null): number {
  const mustBeat =
    toBeatSatVb != null && Number.isFinite(toBeatSatVb) && toBeatSatVb > 0
      ? toBeatSatVb + REPLACEMENT_MARGIN_SAT_VB
      : 0;
  const rate = Math.max(market ?? 1, mustBeat);
  // Rounded up to a tenth so the value is typeable, floored at the relay minimum.
  return Math.max(1, Math.ceil(rate * 10) / 10);
}
