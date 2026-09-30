/**
 * The phone shell.
 *
 * Everything below the chrome is shared with desktop — `api`, `session`, the
 * WASM core, the persister. What differs is the shape: one screen at a time,
 * a fixed bottom tab bar, and no three-step progress indicator, because a
 * wallet you have already opened is not a wizard.
 */

import { canUnlockHere } from "../api";
import { guardRoute } from "../guards";
import { platform } from "../platform";
import { currentRoute, navigate, type Route } from "../router";
import { session } from "../session";
import { clear, el } from "../ui/dom";
import { type IconName, icon } from "../ui/icons";
import "../ui/mobile.css";
import { renderCoins } from "./screens/coins";
import { renderCreate } from "./screens/create";
import { renderExport } from "./screens/export";
import { renderKey } from "./screens/key";
import { renderPsbt } from "./screens/psbt";
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
  coins: renderCoins,
  psbt: renderPsbt,
};

/** Routes that are places rather than steps, and so carry the tab bar. */
const TABS: readonly { route: Route; label: string; icon: IconName }[] = [
  { route: "dashboard", label: "Wallet", icon: "wallet" },
  { route: "scan", label: "Scan", icon: "scan" },
  { route: "settings", label: "Settings", icon: "gear" },
];

/** The rules live in `guards.ts`, shared with the desktop; this reads the state. */
function guard(route: Route): Route {
  return guardRoute(
    route,
    {
      wallet: session.wallet ? { watchOnly: session.wallet.is_watch_only } : null,
      configType: session.config?.address_type ?? null,
      unlockable: canUnlockHere(),
      hasResult: session.lastResult !== null,
      hasTxid: currentTxid() !== null,
    },
    "phone",
  );
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
  if (canUnlockHere() && currentRoute() === "setup") navigate("unlock");
  else render();
}
