/**
 * Replace-by-fee, as far as a screen needs to know it.
 *
 * Every transaction the core builds signals replaceability, so the only
 * questions here are which rows can be bumped and what rate to start from.
 */

import { type FeeEstimate, rateForTarget, type TxSummary } from "./types";

/** Only our own unconfirmed sends can be replaced; everything else is settled. */
export function isBumpable(tx: TxSummary): boolean {
  return tx.confirmations === null && tx.net_sat < 0;
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
  const market = estimate ? rateForTarget(estimate, 1) : null;
  const mustBeatOriginal =
    originalRateSatVb != null && Number.isFinite(originalRateSatVb) && originalRateSatVb > 0
      ? originalRateSatVb + REPLACEMENT_MARGIN_SAT_VB
      : 0;
  const rate = Math.max(market ?? 1, mustBeatOriginal);
  // Rounded up to a tenth so the value is typeable, floored at the relay minimum.
  return Math.max(1, Math.ceil(rate * 10) / 10);
}
