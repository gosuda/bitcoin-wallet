/**
 * Whether the screen that started a piece of async work is still the one showing.
 *
 * Every `await` is a place the user can leave. When the result arrives the
 * screen that asked for it may be gone, and applying it then writes into a
 * detached DOM at best — at worst into the screen that replaced it, which is
 * how a sync started for one wallet repaints another's balance.
 *
 * Two things end a screen's claim on its own results, and the token covers
 * both: the route changed, or the wallet underneath it did. A wallet swap
 * without a route change is the case a route check alone would miss.
 *
 * This is not a substitute for disabling a button while its own work runs —
 * that is `withBusy`, and it answers a different question.
 */

import { currentRoute } from "./router";
import { session } from "./session";

/** Opaque; compare it with `stillCurrent` rather than reading it. */
export type ScreenToken = string;

/** Capture this before awaiting. */
export function screenToken(): ScreenToken {
  // A route name is lowercase letters and a wallet id is alphanumeric with
  // hyphens, so neither can contain the separator and the join is unambiguous.
  return `${currentRoute()}|${session.wallet?.wallet_id ?? ""}`;
}

/** Check after awaiting. False means the result belongs to a screen that is gone. */
export function stillCurrent(token: ScreenToken): boolean {
  return screenToken() === token;
}
