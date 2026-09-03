import { api } from "./api";
import { currentRoute, navigate, type Route } from "./router";
import { renderCreate } from "./screens/create";
import { renderDashboard } from "./screens/dashboard";
import { renderKey } from "./screens/key";
import { renderRestore } from "./screens/restore";
import { renderResult } from "./screens/result";
import { renderSend } from "./screens/send";
import { renderSetup } from "./screens/setup";
import { renderUnlock } from "./screens/unlock";
import { session } from "./session";
import { backendHost, NETWORK_LABELS } from "./types";
import { clear, el } from "./ui/dom";
import { brandMark, icon } from "./ui/icons";

const appRoot = document.getElementById("app");
if (!appRoot) throw new Error("missing #app root");
const root: HTMLElement = appRoot;

const STEPS = ["Setup", "Key", "Wallet"] as const;

/** Every way of getting a key sits on step 1. */
const KEY_ROUTES: ReadonlySet<Route> = new Set<Route>(["key", "create", "restore", "unlock"]);

function stepIndex(route: Route): number {
  if (route === "setup") return 0;
  return KEY_ROUTES.has(route) ? 1 : 2;
}

function stepIndicator(active: number): HTMLElement {
  const nav = el("nav", { className: "steps", attrs: { "aria-label": "Progress" } });
  STEPS.forEach((name, i) => {
    const state = i === active ? "step-active" : i < active ? "step-done" : "";
    nav.appendChild(
      el("span", {
        className: `step ${state}`.trim(),
        text: name,
        attrs: i === active ? { "aria-current": "step" } : {},
      }),
    );
    if (i < STEPS.length - 1) {
      const chev = icon("chevron", 12);
      chev.classList.add("step-chevron");
      nav.appendChild(chev);
    }
  });
  return nav;
}

function topbar(route: Route): HTMLElement {
  const meta = el("div", { className: "topbar-meta" });
  const cfg = session.config;
  if (cfg) {
    meta.appendChild(
      el("span", { className: "pill" }, [
        el("span", { className: "pill-dot" }),
        `${NETWORK_LABELS[cfg.network]} · ${backendHost(cfg.backend)}`,
      ]),
    );
  }
  return el("header", { className: "topbar" }, [
    el("div", { className: "topbar-brand" }, [
      el("span", { className: "topbar-mark" }, [brandMark()]),
      el("span", { className: "topbar-title", text: "Bitcoin Wallet" }),
    ]),
    stepIndicator(stepIndex(route)),
    meta,
  ]);
}

const SCREENS: Record<Route, () => HTMLElement> = {
  setup: renderSetup,
  key: renderKey,
  create: renderCreate,
  restore: renderRestore,
  unlock: renderUnlock,
  dashboard: renderDashboard,
  send: renderSend,
  result: renderResult,
};

/** Route guards: wallet screens need an open wallet, key screen needs config. */
function guard(route: Route): Route {
  if ((route === "dashboard" || route === "send") && !session.wallet) return "setup";
  if (route === "result" && !session.lastResult) return session.wallet ? "dashboard" : "setup";
  if (KEY_ROUTES.has(route) && !session.config) return "setup";
  if (route === "unlock" && !session.remembered) return "key";
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
  root.appendChild(topbar(route));
  root.appendChild(SCREENS[route]());
}

async function boot(): Promise<void> {
  try {
    session.config = await api.getConfig();
  } catch {
    session.config = null;
  }
  if (session.config) {
    try {
      session.remembered = await api.getRemembered();
    } catch {
      session.remembered = null;
    }
  }
  window.addEventListener("hashchange", render);
  if (session.remembered && currentRoute() === "setup") navigate("unlock");
  else render();
}

void boot();
