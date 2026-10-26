/**
 * The one balance rule.
 *
 * Both shells read it from here, so the same wallet never shows two different
 * headline numbers.
 */

import type { Balance } from "./types";

/** Everything the wallet is tracking, pending, immature and frozen included. */
export function headlineSat(b: Balance): number {
  return b.confirmed + b.trusted_pending + b.untrusted_pending + b.immature + b.frozen;
}

/** What is still waiting on a confirmation. */
export function pendingSat(b: Balance): number {
  return b.trusted_pending + b.untrusted_pending;
}
