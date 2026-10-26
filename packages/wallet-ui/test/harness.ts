/*
 * Helpers for screen tests: real screens, rendered in jsdom over the real
 * `api`, `session` and route guards, so what fails is a screen's own handling
 * of secrets, errors and work that outlives it. A test file calls
 * `useScreenHarness()` once in its body.
 */

import { afterEach, beforeEach, expect, vi } from "vitest";
import { api } from "../src/api";
import { renderTransaction, showTransaction } from "../src/mobile/screens/tx";
import { type Platform, platform, setPlatform } from "../src/platform";
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

/** Renders a screen at `route`, as the shell would, and puts it on the page. */
export function mountAt(route: Route, render: () => HTMLElement): HTMLElement {
  at(route);
  return mount(render());
}

/** `mountAt`, then lets the screen's own async work settle. */
export async function showAt(route: Route, render: () => HTMLElement): Promise<HTMLElement> {
  const screen = mountAt(route, render);
  await settle();
  return screen;
}

/** The phone's detail of `txid`, opened from its row, once its own work has settled. */
export async function showPhoneTx(txid: string): Promise<HTMLElement> {
  // Already on the route, so choosing the row starts no navigation that
  // would retire the screen about to be built.
  at("tx");
  showTransaction(txid);
  const screen = mount(renderTransaction());
  await settle();
  return screen;
}

/** A preview the screen dropped: the core holds nothing to sign under `psbtId`. */
export async function expectDropped(psbtId: string): Promise<void> {
  await expect(api.signAndBroadcast(psbtId)).rejects.toMatchObject({ code: "unknown_psbt" });
}

/**
 * A device that keeps keys, with `fake.SAVED` remembered on it and, unless
 * `inSession` is false, in the session. Its key store answers through
 * `loadSecret`, which is returned.
 */
export function rememberSaved({
  loadSecret = vi.fn(async () => ({ secret: fake.PHRASE, passphrase: null })),
  inSession = true,
}: {
  loadSecret?: Platform["loadSecret"];
  inSession?: boolean;
} = {}): Platform["loadSecret"] {
  setPlatform({
    ...platform(),
    canRememberWallet: true,
    getRemembered: async () => fake.SAVED,
    loadSecret,
  });
  if (inSession) session.remembered = fake.SAVED;
  return loadSecret;
}

/** Installs a camera that runs until it reads a code or is told to stop, as the real one does. */
export function camera() {
  let read: (text: string | null) => void = () => undefined;
  const scanQr = vi.fn(
    (signal?: AbortSignal) =>
      new Promise<string | null>((resolve) => {
        read = resolve;
        signal?.addEventListener("abort", () => resolve(null), { once: true });
      }),
  );
  setPlatform({ ...platform(), scanQr });
  return { scanQr, read: (text: string) => read(text) };
}

/** Runs `work` with a page clipboard that reads through `readText`, then takes it away. */
export async function withClipboard(
  readText: () => Promise<string>,
  work: () => Promise<void>,
): Promise<void> {
  Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
  try {
    await work();
  } finally {
    Reflect.deleteProperty(navigator, "clipboard");
  }
}

/** How a webview refuses the page's own clipboard read. */
export async function refusedRead(): Promise<string> {
  throw new DOMException("denied", "NotAllowedError");
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
      // As the browser reads it; a test gives `navigator` a clipboard to read.
      readClipboard: async () => navigator.clipboard.readText(),
      openUrl: async () => undefined,
    });
    session.config = CONFIG;
  });

  afterEach(async () => {
    await api.closeWallet();
    // A test that sets it and then fails must not leave it to the next one.
    session.remembered = null;
    vi.restoreAllMocks();
    document.body.replaceChildren();
    at("setup");
  });
}
