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

/** How often a Wallet screen syncs on its own. */
const AUTO_SYNC_MS = 60_000;

/**
 * Runs `sync` every minute while `screen` is on the page and the app is in the
 * foreground. Screens are swapped without a teardown hook, so the timer stops
 * itself once `screen` has left the document.
 */
export function autoSync(screen: HTMLElement, sync: () => void): void {
  const timer = window.setInterval(() => {
    if (!screen.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (!document.hidden) sync();
  }, AUTO_SYNC_MS);
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
 * Whether this render is still the one on screen, by route alone. Create,
 * Restore and Key use it rather than `screenGuard`: the open they await sets
 * `session.wallet` before they resume, so a wallet check taken at render
 * start would read every success as a swap.
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
 * Whether `session.wallet` is still the wallet this render opened, by wallet
 * alone: a broadcast is recorded whichever screen is on top by then, but
 * never for another wallet (`recordSent`).
 */
export function sameWalletGuard(): () => boolean {
  const openedFor = session.wallet?.wallet_id ?? "";
  return () => (session.wallet?.wallet_id ?? "") === openedFor;
}

/**
 * Whether the screen render that started a piece of async work is still on screen.
 *
 * Every `await` is a place the user can leave: a result applied once its
 * screen is gone lands in a detached DOM, or in the screen that replaced it.
 *
 * The guard is per *render*, not per route: leaving Scan and opening it
 * again rebuilds the screen on the same route, and a camera promise from the
 * abandoned render must not navigate the new one away to Send.
 *
 * This is not a substitute for disabling a button while its own work runs;
 * that is `withBusy` or `withLock`, and it answers a different question.
 *
 * Call this, like `routeGuard` and `sameWalletGuard`, once while the screen is
 * being built: a guard created later belongs to a later moment and cannot
 * speak for work already in flight.
 */
export function screenGuard(): () => boolean {
  const onRoute = routeGuard();
  const sameWallet = sameWalletGuard();
  return () => onRoute() && sameWallet();
}
