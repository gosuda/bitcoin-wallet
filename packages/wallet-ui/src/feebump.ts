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
 * higher absolute fee, and the default incremental relay fee is 1 sat/vB. So
 * the original's rate is a floor, not a target.
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
