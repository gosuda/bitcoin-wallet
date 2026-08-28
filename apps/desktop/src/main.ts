import { api } from "./api";
import { currentRoute, navigate, type Route } from "./router";
import { renderDashboard } from "./screens/dashboard";
import { renderKey } from "./screens/key";
import { renderResult } from "./screens/result";
import { renderSend } from "./screens/send";
import { renderSetup } from "./screens/setup";
import { session } from "./session";
import { ADDRESS_TYPE_LABELS, backendHost, NETWORK_LABELS } from "./types";
import { clear, el } from "./ui/dom";

const appRoot = document.getElementById("app");
if (!appRoot) throw new Error("missing #app root");
const root: HTMLElement = appRoot;

function topbar(): HTMLElement {
  const meta = el("div", { className: "topbar-meta" });
  const cfg = session.config;
  if (cfg) {
    meta.appendChild(el("span", { text: NETWORK_LABELS[cfg.network] }));
    meta.appendChild(el("span", { text: backendHost(cfg.backend) }));
  }
  if (session.wallet) {
    meta.appendChild(el("span", { text: ADDRESS_TYPE_LABELS[session.wallet.address_type] }));
  }
  return el("header", { className: "topbar" }, [
    el("span", { className: "topbar-title", text: "Bitcoin Wallet" }),
    meta,
  ]);
}

const SCREENS: Record<Route, () => HTMLElement> = {
  setup: renderSetup,
  key: renderKey,
  dashboard: renderDashboard,
  send: renderSend,
  result: renderResult,
};

/** Route guards: wallet screens need an open wallet, key screen needs config. */
function guard(route: Route): Route {
  if ((route === "dashboard" || route === "send") && !session.wallet) return "setup";
  if (route === "result" && !session.lastResult) return session.wallet ? "dashboard" : "setup";
  if (route === "key" && !session.config) return "setup";
  return route;
}

function render(): void {
  const wanted = currentRoute();
  const route = guard(wanted);
  if (route !== wanted) {
    navigate(route);
    return;
  }
  clear(root);
  root.appendChild(topbar());
  root.appendChild(SCREENS[route]());
}

async function boot(): Promise<void> {
  try {
    session.config = await api.getConfig();
  } catch {
    session.config = null;
  }
  window.addEventListener("hashchange", render);
  render();
}

void boot();
