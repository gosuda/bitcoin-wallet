/**
 * Whether the screen render that started a piece of async work is still on screen.
 *
 * Every `await` is a place the user can leave. When the result arrives the
 * screen that asked for it may be gone, and applying it then writes into a
 * detached DOM at best — at worst into the screen that replaced it, which is
 * how a sync started for one wallet repaints another's balance.
 *
 * The guard is per *render*, not per route. Comparing route and wallet alone
 * looked sufficient and was not: leaving Scan and opening it again rebuilds the
 * screen but reproduces the same route and wallet, so a camera promise from the
 * abandoned render still read as current and navigated the fresh one away to
 * Send. Screens are rebuilt on every navigation, so each render retires its own
 * guard on the next one.
 *
 * Call this once, while the screen is being built — a guard created later
 * belongs to a later moment and cannot speak for work already in flight.
 *
 * This is not a substitute for disabling a button while its own work runs;
 * that is `withBusy`, and it answers a different question.
 */

import { currentRoute } from "./router";
import { session } from "./session";

export function screenGuard(): () => boolean {
  const route = currentRoute();
  const openedFor = session.wallet?.wallet_id ?? "";
  let thisRender = true;

  // Listeners added while an event is dispatching do not receive that event,
  // and the shell builds screens from its own `hashchange` handler — so this
  // retires on the *next* navigation, never the one that created the screen.
  const retire = (): void => {
    thisRender = false;
    window.removeEventListener("hashchange", retire);
  };
  window.addEventListener("hashchange", retire);

  // The wallet check covers a swap that somehow arrives without navigation;
  // the render check is what makes a return to the same screen a new screen.
  return () =>
    thisRender && currentRoute() === route && (session.wallet?.wallet_id ?? "") === openedFor;
}
