import "./ui/tokens.css";
import "./ui/app.css";
import { api, canUnlockHere } from "./api";
import { guardRoute, KEY_ROUTES } from "./guards";
import { currentRoute, navigate, type Route } from "./router";
import { renderCreate } from "./screens/create";
import { renderDashboard } from "./screens/dashboard";
import { renderKey } from "./screens/key";
import { renderPsbt } from "./screens/psbt";
import { renderRestore } from "./screens/restore";
import { renderResult } from "./screens/result";
import { renderSend } from "./screens/send";
import { renderSettings } from "./screens/settings";
import { renderSetup } from "./screens/setup";
import { renderUnlock } from "./screens/unlock";
import { session } from "./session";
import { backendHost, errorMessage, NETWORK_LABELS } from "./types";
import { startAutolock } from "./ui/autolock";
import { banner, clear, el, queueNotice } from "./ui/dom";
import { brandMark, icon } from "./ui/icons";
import { OPENED_WITH } from "./ui/text";

const STEPS = ["Setup", "Key", "Wallet"] as const;

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

/** The wallet's own pages, which link to Settings from the top bar; 7 carries the gear too. */
const SETTINGS_LINKED: ReadonlySet<Route> = new Set<Route>(["dashboard", "settings", "psbt"]);

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
  if (session.wallet && SETTINGS_LINKED.has(route)) {
    meta.appendChild(
      el(
        "a",
        {
          className: "topbar-link",
          attrs: {
            href: "#/settings",
            ...(route === "settings" ? { "aria-current": "page" } : {}),
          },
        },
        [icon("gear", 16), "Settings"],
      ),
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

const SCREENS: Partial<Record<Route, () => HTMLElement>> = {
  setup: renderSetup,
  key: renderKey,
  create: renderCreate,
  restore: renderRestore,
  unlock: renderUnlock,
  dashboard: renderDashboard,
  send: renderSend,
  result: renderResult,
  settings: renderSettings,
  psbt: renderPsbt,
};

/** The rules live in `guards.ts`; this is where the desktop reads its state. */
function guard(route: Route): Route {
  return guardRoute(
    route,
    {
      wallet: session.wallet ? { watchOnly: session.wallet.is_watch_only } : null,
      configType: session.config?.address_type ?? null,
      unlockable: canUnlockHere(),
      hasResult: session.lastResult !== null,
      hasTxid: false,
    },
    "desktop",
  );
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
  root.appendChild(topbar(route));
  root.appendChild((SCREENS[route] ?? renderSetup)());
}

export interface BootOptions {
  /**
   * An alternative chrome to mount once config is loaded.
   *
   * The entry point passes the phone shell here rather than naming it, so a
   * desktop build never imports it and the bundler drops it entirely — a
   * dynamic import inside this module would still emit the chunk. The phone
   * shell is a different shape rather than a narrower one, which is why this
   * is chosen by platform at the entry point and not by viewport.
   */
  mount?: () => void;
}

/**
 * Starts the shared app. The entry point installs a `Platform` first; from here
 * on nothing knows whether it is running in a Tauri window or a browser tab.
 */
export async function boot(options: BootOptions = {}): Promise<void> {
  // A store that cannot be read is not a first run, though it lands on the
  // same screen: that screen says why, rather than pass for a fresh start.
  try {
    session.config = await api.getConfig();
  } catch (e) {
    console.error("could not read the saved settings:", e);
    queueNotice(
      "error",
      `The saved settings could not be read (${errorMessage(e)}). Choose them again.`,
    );
    session.config = null;
  }
  if (session.config) {
    try {
      session.remembered = await api.getRemembered();
    } catch (e) {
      console.error("could not read the remembered wallet:", e);
      queueNotice(
        "error",
        `The wallet saved on this device could not be read (${errorMessage(e)}). Open it again with ${OPENED_WITH}.`,
      );
      session.remembered = null;
    }
  }
  // Once, for both shells, before either mounts: Settings shows the saved
  // lock time from the first screen on.
  await startAutolock();
  if (options.mount) {
    options.mount();
    return;
  }
  window.addEventListener("hashchange", render);
  if (canUnlockHere() && currentRoute() === "setup") navigate("unlock");
  else render();
}

/**
 * For an entry point whose start failed before any screen could come up:
 * says so in the page, which would otherwise stay blank, and logs the cause.
 */
export function showBootFailure(e: unknown): void {
  console.error("the wallet could not start:", e);
  const alert = banner();
  alert.show("error", `The wallet could not start: ${errorMessage(e)}`);
  (document.getElementById("app") ?? document.body).replaceChildren(alert.node);
}
