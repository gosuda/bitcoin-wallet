/**
 * Which screen a route may show, for both shells.
 *
 * Pure: each shell reads the session and the platform into a `GuardState`
 * and navigates to the answer, so the rules can be tested without a DOM, a
 * wallet or a platform. The two shells share every rule here except the
 * handful marked, which is why they are one function rather than two tables
 * that could drift apart.
 */

import { ROUTES, type Route } from "./router";
import { type AddressType, isOpenable } from "./types";

export type Shell = "desktop" | "phone";

export interface GuardState {
  /** The open wallet, or null when none is. */
  wallet: { watchOnly: boolean } | null;
  /** The address type the saved settings name; null before Setup has been done. */
  configType: AddressType | null;
  /** A remembered wallet, on a device that can remember one. */
  unlockable: boolean;
  /** A broadcast result is waiting to be shown. */
  hasResult: boolean;
  /** Phone only: a transaction row was chosen for the detail screen. */
  hasTxid: boolean;
}

/** The screens that start a wallet; they need settings to start one with. */
export const KEY_ROUTES: ReadonlySet<Route> = new Set<Route>([
  "key",
  "create",
  "restore",
  "unlock",
]);

/** Destinations only the phone shell has; the desktop sends them to the wallet. */
export const PHONE_ONLY: ReadonlySet<Route> = new Set<Route>([
  "receive",
  "scan",
  "settings",
  "tx",
  "export",
]);

/** Screens with nothing to show, configure or scan into without an open wallet. */
const NEEDS_WALLET: Record<Shell, ReadonlySet<Route>> = {
  desktop: new Set<Route>(["dashboard", "send"]),
  phone: new Set<Route>(["dashboard", "send", ...PHONE_ONLY]),
};

/**
 * Where `route` actually goes: a route the rules let through, so a shell
 * lands on it with one navigation. Rules can chain — a key screen without
 * usable settings goes to Setup, and Setup under an open wallet goes to the
 * wallet — so this follows them. A chain longer than there are routes would be
 * a cycle; the tests show there is none, for every state.
 */
export function guardRoute(route: Route, s: GuardState, shell: Shell): Route {
  let current = route;
  for (let hops = 0; hops < ROUTES.length; hops++) {
    const next = step(current, s, shell);
    if (next === current) return current;
    current = next;
  }
  throw new Error(`the route guard cycles from '${route}'`);
}

/** One rule's answer: another route, or `route` itself when no rule applies. */
function step(route: Route, s: GuardState, shell: Shell): Route {
  if (shell === "desktop" && PHONE_ONLY.has(route)) return s.wallet ? "dashboard" : "setup";
  if (NEEDS_WALLET[shell].has(route) && !s.wallet) return "setup";
  // Setup rewrites the network under a live wallet handle. The desktop closes
  // the wallet from the dashboard; the phone does it from Settings.
  if (route === "setup" && s.wallet) return shell === "desktop" ? "dashboard" : "settings";
  // A watch-only wallet has nothing to sign with; the screen is not offered.
  if (route === "send" && s.wallet?.watchOnly) return "dashboard";
  // The transaction screen is reached from a row, never typed; without one
  // chosen there is nothing to show.
  if (route === "tx" && !s.hasTxid) return "dashboard";
  if (route === "result" && !s.hasResult) return s.wallet ? "dashboard" : "setup";
  // A config saved before P2PK stopped being openable can still name it, and
  // Setup, which never offers it, is where a type is chosen again.
  if (KEY_ROUTES.has(route) && (s.configType === null || !isOpenable(s.configType))) {
    return "setup";
  }
  // Unlock exists only where a key can outlive the session; in a browser there
  // is nothing to unlock, so the route is unreachable rather than empty.
  if (route === "unlock" && !s.unlockable) return "key";
  return route;
}
