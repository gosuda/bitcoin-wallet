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
 * Replacing means outbidding the original, so the 1-block rate is the ask —
 * floored at the relay minimum and rounded up to a tenth so it is typeable.
 */
export function suggestBumpRate(estimate: FeeEstimate | null): number {
  const rate = estimate ? rateForTarget(estimate, 1) : null;
  return Math.max(1, Math.ceil((rate ?? 1) * 10) / 10);
}
