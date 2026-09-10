/**
 * The phone shell.
 *
 * Everything below the chrome is shared with desktop — `api`, `session`, the
 * WASM core, the persister. What differs is the shape: one screen at a time,
 * a fixed bottom tab bar, and no three-step progress indicator, because a
 * wallet you have already opened is not a wizard.
 */

import { platform } from "../platform";
import { currentRoute, navigate, type Route } from "../router";
import { session } from "../session";
import { clear, el } from "../ui/dom";
import { type IconName, icon } from "../ui/icons";
import "../ui/mobile.css";
import { renderCreate } from "./screens/create";
import { renderExport } from "./screens/export";
import { renderKey } from "./screens/key";
import { renderReceive } from "./screens/receive";
import { renderRestore } from "./screens/restore";
import { renderResult } from "./screens/result";
import { renderScan } from "./screens/scan";
import { renderSend } from "./screens/send";
import { renderSettings } from "./screens/settings";
import { renderSetup } from "./screens/setup";
import { currentTxid, renderTransaction } from "./screens/tx";
import { renderUnlock } from "./screens/unlock";
import { renderWallet } from "./screens/wallet";

const SCREENS: Record<Route, () => HTMLElement> = {
  setup: renderSetup,
  key: renderKey,
  create: renderCreate,
  restore: renderRestore,
  unlock: renderUnlock,
  dashboard: renderWallet,
  send: renderSend,
  result: renderResult,
  receive: renderReceive,
  scan: renderScan,
  settings: renderSettings,
  tx: renderTransaction,
  export: renderExport,
};

/** Routes that are places rather than steps, and so carry the tab bar. */
const TABS: readonly { route: Route; label: string; icon: IconName }[] = [
  { route: "dashboard", label: "Wallet", icon: "wallet" },
  { route: "scan", label: "Scan", icon: "scan" },
  { route: "settings", label: "Settings", icon: "gear" },
];

const KEY_ROUTES: ReadonlySet<Route> = new Set<Route>(["key", "create", "restore", "unlock"]);
const NEEDS_WALLET: ReadonlySet<Route> = new Set<Route>([
  "dashboard",
  "send",
  "receive",
  "scan",
  "settings",
  "tx",
  "export",
]);

/**
 * Same rules as the desktop shell, extended to the routes only this shell has.
 * Settings and Scan need an open wallet for the same reason the dashboard
 * does: there is nothing to configure or scan into otherwise.
 */
function guard(route: Route): Route {
  if (NEEDS_WALLET.has(route) && !session.wallet) return "setup";
  // Setup rewrites the network under a live wallet handle; Settings is where
  // that change is made, through a close.
  if (route === "setup" && session.wallet) return "settings";
  // A watch-only wallet has nothing to sign with; the screen is not offered.
  if (route === "send" && session.wallet?.is_watch_only) return "dashboard";
  // The transaction screen is reached from a row, never typed; without one
  // stashed there is nothing to show.
  if (route === "tx" && !currentTxid()) return "dashboard";
  if (route === "result" && !session.lastResult) return session.wallet ? "dashboard" : "setup";
  if (KEY_ROUTES.has(route) && !session.config) return "setup";
  if (route === "unlock" && (!platform().canRememberWallet || !session.remembered)) return "key";
  return route;
}

/** The tabs this build can honour: Scan needs a camera to point at anything. */
function tabs(): readonly (typeof TABS)[number][] {
  return TABS.filter((tab) => tab.route !== "scan" || platform().scanQr !== undefined);
}

function tabBar(active: Route): HTMLElement {
  const bar = el("nav", { className: "m-tabs", attrs: { "aria-label": "Sections" } });
  for (const tab of tabs()) {
    const btn = el("button", {
      className: "m-tab",
      attrs: {
        type: "button",
        ...(tab.route === active ? { "aria-current": "page" } : {}),
      },
      on: { click: () => navigate(tab.route) },
    });
    btn.appendChild(icon(tab.icon, 24));
    btn.appendChild(el("span", { text: tab.label }));
    bar.appendChild(btn);
  }
  return bar;
}

function render(): void {
  const wanted = currentRoute();
  const route = guard(wanted);
  if (route !== wanted) {
    navigate(route);
    return;
  }
  const root = document.getElementById("app");
  if (!root) throw new Error("missing #app root");
  clear(root);
  root.appendChild(SCREENS[route]());
  if (tabs().some((t) => t.route === route)) root.appendChild(tabBar(route));
}

export function mount(): void {
  window.addEventListener("hashchange", render);
  if (session.remembered && currentRoute() === "setup") navigate("unlock");
  else render();
}
