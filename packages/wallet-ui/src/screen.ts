import { currentRoute, navigate, type Route } from "./router";
import { session } from "./session";
import { el } from "./ui/dom";

/** A desktop screen's heading: its title, and the muted line under it. */
export function screenHead(title: string, line?: string): HTMLElement {
  return el("div", { className: "screen-head" }, [
    el("h1", { text: title }),
    line === undefined ? null : el("p", { className: "muted small", text: line }),
  ]);
}

/**
 * For a screen rendered without what it shows — no wallet, no settings, no
 * result: sends the user on to `route`, and hands back an empty `<main>` to
 * stand in for the screen meanwhile.
 */
export function redirect(route: Route): HTMLElement {
  navigate(route);
  return document.createElement("main");
}

/**
 * Whether this render is still the one on screen, by route alone — no
 * wallet-identity check. `screenGuard` below layers that check on top, for
 * every screen that already shows a wallet's own state.
 *
 * That check is wrong for the handful of screens whose own job is to set
 * `session.wallet` for the first time — Create, Restore, and Key's two open
 * paths. `api.openWallet` sets `session.wallet` as a side effect of the very
 * call being awaited, before the caller's own code resumes, so a
 * wallet-identity check taken at render start would read as a swap on every
 * single success, not just a real navigation away. This is the guard those
 * screens use instead.
 *
 * Call this once, while the screen is being built — see `screenGuard`'s own
 * doc comment for why: a guard created later belongs to a later moment and
 * cannot speak for work already in flight.
 */
export function routeGuard(): () => boolean {
  const route = currentRoute();
  let thisRender = true;

  // Listeners added while an event is dispatching do not receive that event,
  // and the shell builds screens from its own `hashchange` handler — so this
  // retires on the *next* navigation, never the one that created the screen.
  const retire = (): void => {
    thisRender = false;
    window.removeEventListener("hashchange", retire);
  };
  window.addEventListener("hashchange", retire);

  return () => thisRender && currentRoute() === route;
}

/**
 * Whether `session.wallet` is still the wallet this render opened — no route
 * check, the mirror image of `routeGuard`. Split out for call sites that
 * need this half alone: recording that a broadcast already happened is
 * correct no matter which screen is on top afterward, but wrong once the
 * session has moved on to a different wallet, and `screenGuard`'s combined
 * check would also suppress it on a plain navigation that never touched the
 * wallet at all.
 *
 * Call this once, while the screen is being built — see `screenGuard`'s own
 * doc comment for why.
 */
export function sameWalletGuard(): () => boolean {
  const openedFor = session.wallet?.wallet_id ?? "";
  return () => (session.wallet?.wallet_id ?? "") === openedFor;
}

/**
 * Whether the screen render that started a piece of async work is still on screen.
 *
 * Every `await` is a place the user can leave. When the result arrives the
 * screen that asked for it may be gone, and applying it then writes into a
 * detached DOM at best — at worst into the screen that replaced it, which is
 * how a sync started for one wallet repaints another's balance.
 *
 * The guard is per *render*, not per route: leaving Scan and opening it
 * again rebuilds the screen but reproduces the same route, so a camera
 * promise from the abandoned render would otherwise still read as current
 * and navigate the fresh one away to Send. `routeGuard` already retires on
 * the next render for exactly this reason; this adds the wallet check on
 * top, covering a swap that somehow arrives without a route change.
 *
 * This is not a substitute for disabling a button while its own work runs;
 * that is `withBusy`, and it answers a different question.
 */
export function screenGuard(): () => boolean {
  const onRoute = routeGuard();
  const sameWallet = sameWalletGuard();
  return () => onRoute() && sameWallet();
}
