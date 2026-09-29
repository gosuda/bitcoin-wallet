/*
 * Helpers for screen tests: real screens, rendered in jsdom over the real
 * `api`, `session` and route guards, with only the WebAssembly wrapper and
 * the IndexedDB persister replaced (`fakes.ts`). So what fails is a screen's
 * own handling of secrets, errors and work that outlives it.
 *
 * A test file mocks both modules at its top, as `fakes.ts` shows, and calls
 * `useScreenHarness()` once in its body.
 */

import { afterEach, beforeEach, vi } from "vitest";
import { api } from "../src/api";
import { setPlatform } from "../src/platform";
import type { Route } from "../src/router";
import { session } from "../src/session";
import { type AppConfig, DEFAULT_LOCK_AFTER } from "../src/types";
import { fake } from "./fakes";

export const CONFIG: AppConfig = {
  network: "testnet4",
  address_type: "p2wpkh",
  backend: { kind: "esplora", url: "https://mempool.space/testnet4/api" },
};

/** Where the shell would be when it renders a screen: no event, just the URL. */
export function at(route: Route): void {
  window.history.replaceState(null, "", `#/${route}`);
}

/** The user moves on: the URL changes and the one `hashchange` fires. */
export function leaveTo(route: Route): void {
  at(route);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function mount(screen: HTMLElement): HTMLElement {
  document.body.replaceChildren(screen);
  return screen;
}

export function find<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

export function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

export function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Lets every promise already queued settle, the async screen work included. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Every test starts configured for testnet4 on a device that keeps no keys,
 * with an empty fake wallet, and ends with the wallet closed and the page
 * cleared.
 */
export function useScreenHarness(): void {
  // jsdom does no layout, so it has nothing to scroll; the preview asks it to.
  Element.prototype.scrollIntoView = vi.fn();

  beforeEach(() => {
    fake.reset();
    setPlatform({
      canRememberWallet: false,
      getConfig: async () => CONFIG,
      setConfig: async () => undefined,
      getRemembered: async () => null,
      setRemembered: async () => undefined,
      getLockAfter: async () => DEFAULT_LOCK_AFTER,
      setLockAfter: async () => undefined,
      rememberSecret: async () => undefined,
      loadSecret: async () => null,
      forgetSecret: async () => undefined,
      writeClipboard: async () => undefined,
      openUrl: async () => undefined,
    });
    session.config = CONFIG;
  });

  afterEach(async () => {
    await api.closeWallet();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    at("setup");
  });
}
