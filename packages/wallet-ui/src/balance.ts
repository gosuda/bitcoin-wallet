/**
 * The one balance rule.
 *
 * Both shells read it from here so the same wallet never shows two different
 * headline numbers — which it did, when one counted pending and immature sats
 * and the other did not.
 */

import type { Balance } from "./types";

/** Everything the wallet is tracking, pending and immature included. */
export function headlineSat(b: Balance): number {
  return b.confirmed + b.trusted_pending + b.untrusted_pending + b.immature;
}

/** What is still waiting on a confirmation. */
export function pendingSat(b: Balance): number {
  return b.trusted_pending + b.untrusted_pending;
}

/** What a send can use right now (BDK "trusted spendable"). */
export function spendableSat(b: Balance): number {
  return b.confirmed + b.trusted_pending;
}
