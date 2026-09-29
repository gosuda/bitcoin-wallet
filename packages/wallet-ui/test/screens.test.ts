/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Real screens, rendered in jsdom over the real `api`, `session` and route
 * guards. Only what jsdom cannot provide is replaced: the WebAssembly wrapper
 * (a fake wallet whose `sync` can be held open) and the IndexedDB persister.
 * So what fails here is the screens' own handling of secrets and of work
 * that outlives them.
 */

const fake = vi.hoisted(() => {
  const ADDRESS = "tb1q4gp4z4utc286kcdpdsj3qwgpefcf9u4mv9a0d5";
  const built = (total: number) => ({
    psbt_base64: `psbt-${total}`,
    fee_sat: 141,
    vsize: 141,
    total_out_sat: total,
    change_sat: 0,
    input_count: 1,
  });
  let syncGate: Promise<void> = Promise.resolve();

  class FakeWallet {
    static async open(): Promise<FakeWallet> {
      return new FakeWallet();
    }
    get id(): string {
      return "testnet4-p2wpkh-fake";
    }
    get network(): string {
      return "testnet4";
    }
    get address_type(): string {
      return "p2wpkh";
    }
    get isHd(): boolean {
      return true;
    }
    get isRanged(): boolean {
      return true;
    }
    get isWatchOnly(): boolean {
      return false;
    }
    async address(): Promise<string> {
      return ADDRESS;
    }
    async newAddress(): Promise<string> {
      return ADDRESS;
    }
    async sync(): Promise<void> {
      await syncGate;
    }
    async rescan(): Promise<void> {}
    async public_descriptors() {
      return { external: "wpkh(fake/0/*)", internal: null, account_xpub: null, fingerprint: null };
    }
    async transaction(): Promise<null> {
      return null;
    }
    async balance() {
      return { confirmed: 50_000, trusted_pending: 0, untrusted_pending: 0, immature: 0 };
    }
    async list_utxos(): Promise<never[]> {
      return [];
    }
    async list_transactions(): Promise<never[]> {
      return [];
    }
    async estimate_fee() {
      return { sat_per_vb_by_target: { "6": 2 } };
    }
    async build_transfer(recipients: { amount_sat: number }[]) {
      return built(recipients.reduce((sum, r) => sum + r.amount_sat, 0));
    }
    async build_drain() {
      return built(49_859);
    }
    free(): void {}
  }

  return {
    ADDRESS,
    FakeWallet,
    /** Holds every `sync` open until `release` is called. */
    holdSync(): () => void {
      let release = (): void => {};
      syncGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
});

vi.mock("../src/wasm", () => ({
  WalletApi: fake.FakeWallet,
  walletIdForKey: async () => "testnet4-p2wpkh-fake",
  explorerTxUrl: async () => null,
  generateKey: async () => {
    throw new Error("not used here");
  },
  generateMnemonic: async () => ({
    words:
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    address: fake.ADDRESS,
  }),
  validateMnemonic: async () => undefined,
}));

vi.mock("../src/persist/indexeddb", () => ({
  makePersister: () => ({ initialize: async () => null, persist: async () => undefined }),
  deleteWalletState: async () => undefined,
}));

import { api } from "../src/api";
import { renderRestore as renderPhoneRestore, setRestoreMode } from "../src/mobile/screens/restore";
import { setPlatform } from "../src/platform";
import type { Route } from "../src/router";
import { renderCreate } from "../src/screens/create";
import { renderDashboard } from "../src/screens/dashboard";
import { renderKey } from "../src/screens/key";
import { renderRestore } from "../src/screens/restore";
import { renderSend } from "../src/screens/send";
import { session } from "../src/session";
import type { AppConfig } from "../src/types";

// jsdom does no layout, so it has nothing to scroll; the preview asks it to.
Element.prototype.scrollIntoView = vi.fn();

const CONFIG: AppConfig = {
  network: "testnet4",
  address_type: "p2wpkh",
  backend: { kind: "esplora", url: "https://mempool.space/testnet4/api" },
};

/** Where the shell would be when it renders a screen: no event, just the URL. */
function at(route: Route): void {
  window.history.replaceState(null, "", `#/${route}`);
}

/** The user moves on: the URL changes and the one `hashchange` fires. */
function leaveTo(route: Route): void {
  at(route);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function mount(screen: HTMLElement): HTMLElement {
  document.body.replaceChildren(screen);
  return screen;
}

function find<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Lets every promise already queued settle, the async screen work included. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  setPlatform({
    canRememberWallet: false,
    getConfig: async () => CONFIG,
    setConfig: async () => undefined,
    getRemembered: async () => null,
    setRemembered: async () => undefined,
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

describe("secrets do not outlive their screen (1.3)", () => {
  it("Key clears a typed private key and a pasted descriptor", () => {
    at("key");
    const screen = mount(renderKey());
    const secret = find<HTMLInputElement>(screen, "input[name=secret]");
    const descriptor = find<HTMLTextAreaElement>(screen, "textarea[name=descriptor]");
    type(secret, "11".repeat(32));
    type(descriptor, "wpkh(tpubD6NzVbkrYhZ4X/0/*)");

    leaveTo("setup");

    expect(secret.value).toBe("");
    expect(descriptor.value).toBe("");
  });

  it("Restore clears every word and the passphrase", () => {
    at("restore");
    const screen = mount(renderRestore());
    const words = [...screen.querySelectorAll<HTMLInputElement>('input[aria-label^="Word "]')];
    const passphrase = find<HTMLInputElement>(screen, "input[name=passphrase]");
    expect(words).toHaveLength(12);
    for (const word of words) type(word, "abandon");
    type(passphrase, "TREZOR");

    leaveTo("setup");

    expect(words.map((w) => w.value)).toEqual(Array(12).fill(""));
    expect(passphrase.value).toBe("");
  });

  it("Create clears the passphrase and every word typed back", async () => {
    at("create");
    const screen = mount(renderCreate());
    await settle();
    const answers = [...screen.querySelectorAll<HTMLInputElement>('input[aria-label^="Word "]')];
    const passphrase = find<HTMLInputElement>(screen, "input[name=passphrase]");
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) type(answer, "abandon");
    type(passphrase, "TREZOR");

    leaveTo("setup");

    expect(answers.every((a) => a.value === "")).toBe(true);
    expect(passphrase.value).toBe("");
  });

  it.each(["phrase", "key", "watch"] as const)(
    "the phone's Restore clears what was typed in %s mode",
    (mode) => {
      setRestoreMode(mode);
      at("restore");
      const screen = mount(renderPhoneRestore());
      const fields = [
        ...screen.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input:not([type=radio]):not([type=checkbox]), textarea",
        ),
      ];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) type(field, "secret material");

      leaveTo("setup");

      expect(fields.map((f) => f.value)).toEqual(fields.map(() => ""));
    },
  );
});

describe("work that outlives its screen changes nothing (1.7)", () => {
  it("a sync that finishes after Close wallet stamps no sync time", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    const screen = mount(renderDashboard());
    await settle();
    const release = fake.holdSync();

    buttonNamed(screen, "Sync").click();
    await settle();
    buttonNamed(screen, "Close wallet").click();
    await settle();
    expect(session.wallet).toBeNull();
    release();
    await settle();

    expect(session.lastSyncedAt).toBeNull();
  });

  it("leaving Send after Max discards the drain it built, and a return builds fresh", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const buildDrain = vi.spyOn(api, "buildDrain");
    const buildTransfer = vi.spyOn(api, "buildTransfer");
    const discardTx = vi.spyOn(api, "discardTx");

    at("send");
    let screen = mount(renderSend());
    await settle();
    type(find<HTMLInputElement>(screen, 'input[placeholder^="Recipient address"]'), fake.ADDRESS);
    buttonNamed(screen, "Max").click();
    await settle();
    const drain = await buildDrain.mock.results[0]?.value;
    expect(drain?.total_out_sat).toBe(49_859);

    leaveTo("dashboard");

    expect(discardTx).toHaveBeenCalledWith(drain.psbt_id);
    await expect(api.signAndBroadcast(drain.psbt_id)).rejects.toMatchObject({
      code: "unknown_psbt",
    });

    at("send");
    screen = mount(renderSend());
    await settle();
    type(find<HTMLInputElement>(screen, 'input[placeholder^="Recipient address"]'), fake.ADDRESS);
    type(find<HTMLInputElement>(screen, 'input[placeholder="0"]'), "1000");
    buttonNamed(screen, "Review").click();
    await settle();

    expect(buildTransfer).toHaveBeenCalledTimes(1);
    expect(buildDrain).toHaveBeenCalledTimes(1);
    expect(screen.querySelector(".banner-visible")).toBeNull();
    expect(buttonNamed(screen, "Confirm & broadcast")).toBeTruthy();
    expect(screen.textContent).toContain("1,000");
  });
});
