/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api, canUnlockHere } from "../src/api";
import { renderReceive as renderPhoneReceive } from "../src/mobile/screens/receive";
import { renderRestore as renderPhoneRestore, setRestoreMode } from "../src/mobile/screens/restore";
import { renderScan as renderPhoneScan } from "../src/mobile/screens/scan";
import { renderSend as renderPhoneSend } from "../src/mobile/screens/send";
import { renderSettings as renderPhoneSettings } from "../src/mobile/screens/settings";
import { renderSetup as renderPhoneSetup } from "../src/mobile/screens/setup";
import { platform, setPlatform } from "../src/platform";
import { renderCreate } from "../src/screens/create";
import { renderDashboard } from "../src/screens/dashboard";
import { renderKey } from "../src/screens/key";
import { renderRestore } from "../src/screens/restore";
import { renderSend } from "../src/screens/send";
import { renderSettings } from "../src/screens/settings";
import { renderSetup } from "../src/screens/setup";
import { session } from "../src/session";
import { NETWORK_LABELS, type Network, type RememberedWallet } from "../src/types";
import { fake } from "./fakes";
import {
  at,
  buttonNamed,
  CONFIG,
  find,
  leaveTo,
  mount,
  settle,
  type,
  useScreenHarness,
} from "./harness";

useScreenHarness();

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
    type(find<HTMLInputElement>(screen, "#recipient-address-0"), fake.ADDRESS);
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
    type(find<HTMLInputElement>(screen, "#recipient-address-0"), fake.ADDRESS);
    type(find<HTMLInputElement>(screen, 'input[placeholder="0"]'), "1000");
    buttonNamed(screen, "Review").click();
    await settle();

    expect(buildTransfer).toHaveBeenCalledTimes(1);
    expect(buildDrain).toHaveBeenCalledTimes(1);
    expect(screen.querySelector(".banner-visible")).toBeNull();
    expect(buttonNamed(screen, "Confirm and send")).toBeTruthy();
    expect(screen.textContent).toContain((1000).toLocaleString());
  });

  it("leaving Scan stops the camera it opened, and the page is solid again", async () => {
    // A camera that runs until it is told to stop, as the real one does.
    let signal: AbortSignal | undefined;
    const scanQr = vi.fn(
      (given?: AbortSignal) =>
        new Promise<string | null>((resolve) => {
          signal = given;
          given?.addEventListener("abort", () => resolve(null), { once: true });
        }),
    );
    setPlatform({ ...platform(), scanQr });
    const root = document.documentElement;

    at("scan");
    mount(renderPhoneScan());
    await settle();
    expect(scanQr).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    expect(root.dataset.scanning).toBeDefined();

    leaveTo("dashboard");

    expect(signal?.aborted).toBe(true);
    expect(root.dataset.scanning).toBeUndefined();
    await settle();
    expect(root.dataset.scanning).toBeUndefined();
  });

  it("a Scan screen replaced by another leaves the new one's camera showing", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const scanQr = vi.fn(
      (given?: AbortSignal) =>
        new Promise<string | null>((resolve) => {
          signals.push(given);
          given?.addEventListener("abort", () => resolve(null), { once: true });
        }),
    );
    setPlatform({ ...platform(), scanQr });
    const root = document.documentElement;
    // The shell listens from before any screen, so on a hashchange it renders
    // the new screen first, and the old screen hears that it has left after.
    const shell = (): void => void mount(renderPhoneScan());
    window.addEventListener("hashchange", shell);

    at("scan");
    mount(renderPhoneScan());
    await settle();
    // Tapping the Scan tab while on Scan: same route, one hashchange.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    window.removeEventListener("hashchange", shell);

    expect(scanQr).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(root.dataset.scanning).toBeDefined();

    leaveTo("dashboard");
    expect(root.dataset.scanning).toBeUndefined();
  });
});

/** What a screen reader announces a group as: its `aria-labelledby` text, else its `aria-label`. */
function nameOf(group: Element): string {
  const ids = group.getAttribute("aria-labelledby");
  if (ids) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  return group.getAttribute("aria-label")?.trim() ?? "";
}

/** Every choice group on `screen`, with the name each one has. */
function groupNames(screen: HTMLElement): string[] {
  return [...screen.querySelectorAll("[role=radiogroup]")].map(nameOf);
}

describe("Setup names only what it offers (5.3)", () => {
  it("the desktop says nothing of P2PK, which cannot be chosen", () => {
    at("setup");
    const screen = mount(renderSetup());
    // Word-bounded, since the P2PKH label that is offered starts the same way.
    expect(screen.textContent).not.toMatch(/\bP2PK\b/i);
    expect(screen.textContent).toContain("P2PKH");
  });
});

describe("every choice group has a name (3.9)", () => {
  it("on the desktop", async () => {
    at("setup");
    expect(groupNames(mount(renderSetup()))).toEqual(["Network", "Address type"]);
    at("restore");
    expect(groupNames(mount(renderRestore()))).toEqual(["Word count"]);

    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("send");
    const send = mount(renderSend());
    await settle();
    expect(groupNames(send)).toEqual(["Amount unit", "Target"]);
    at("dashboard");
    const dashboard = mount(renderDashboard());
    await settle();
    expect(groupNames(dashboard)).toEqual(["Amount unit"]);
    at("settings");
    expect(groupNames(mount(renderSettings()))).toEqual(["Address gap"]);
  });

  it("on the phone", async () => {
    at("setup");
    expect(groupNames(mount(renderPhoneSetup()))).toEqual(["Network", "Address type"]);
    setRestoreMode("phrase");
    at("restore");
    expect(groupNames(mount(renderPhoneRestore()))).toEqual(["Word count"]);

    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("send");
    const send = mount(renderPhoneSend());
    await settle();
    expect(groupNames(send)).toEqual(["Amount unit", "Fee target"]);
    at("settings");
    expect(groupNames(mount(renderPhoneSettings()))).toEqual(["Address gap"]);
    at("receive");
    expect(groupNames(mount(renderPhoneReceive()))).toEqual(["Amount unit"]);
  });
});

describe("a remembered wallet is reachable after Setup (6.2)", () => {
  const SAVED: RememberedWallet = {
    wallet_id: "testnet4-p2wpkh-fake",
    address: fake.ADDRESS,
    network: "testnet4",
    address_type: "p2wpkh",
  };

  /** A device that keeps keys, with SAVED remembered on it; returns the key loader. */
  function rememberSaved() {
    const loadSecret = vi.fn(async () => ({ secret: "abandon abandon abandon", passphrase: null }));
    setPlatform({
      ...platform(),
      canRememberWallet: true,
      getRemembered: async () => SAVED,
      loadSecret,
    });
    session.remembered = SAVED;
    return loadSecret;
  }

  afterEach(() => {
    session.remembered = null;
  });

  const SHELL_SETUPS = [
    {
      shell: "desktop",
      render: renderSetup,
      choose: (screen: HTMLElement, network: Network) =>
        find<HTMLInputElement>(screen, `input[type=radio][value=${network}]`).click(),
    },
    {
      shell: "phone",
      render: renderPhoneSetup,
      choose: (screen: HTMLElement, network: Network) =>
        buttonNamed(
          find(screen, "[role=radiogroup][aria-label=Network]"),
          NETWORK_LABELS[network],
        ).click(),
    },
  ] as const;

  /** Chooses a network on Setup, presses Continue, and says where it went. */
  async function continueOn(
    setup: (typeof SHELL_SETUPS)[number],
    network: Network,
  ): Promise<string> {
    at("setup");
    const screen = mount(setup.render());
    setup.choose(screen, network);
    buttonNamed(screen, "Continue").click();
    await settle();
    return window.location.hash;
  }

  it.each(SHELL_SETUPS)(
    "$shell Setup continues to Unlock on the wallet's own network",
    async (setup) => {
      rememberSaved();
      expect(await continueOn(setup, "testnet4")).toBe("#/unlock");
    },
  );

  it.each(SHELL_SETUPS)("$shell Setup continues to Key on any other network", async (setup) => {
    rememberSaved();
    expect(await continueOn(setup, "signet")).toBe("#/key");
  });

  it("Unlock is open only for a wallet saved on the chosen network, on a device that keeps keys", () => {
    expect(canUnlockHere()).toBe(false);
    rememberSaved();
    expect(canUnlockHere()).toBe(true);
    session.config = { ...CONFIG, network: "signet" };
    expect(canUnlockHere()).toBe(false);
    session.config = CONFIG;
    setPlatform({ ...platform(), canRememberWallet: false });
    expect(canUnlockHere()).toBe(false);
  });

  it("Unlock refuses a wallet saved on another network before it reads the key", async () => {
    const loadSecret = rememberSaved();
    session.config = {
      ...CONFIG,
      network: "signet",
      backend: { kind: "esplora", url: "https://mempool.space/signet/api" },
    };
    await expect(api.unlockWallet()).rejects.toMatchObject({
      code: "wrong_network",
      message:
        "The wallet saved on this device is on Testnet4. Choose Testnet4 in Setup to open it.",
    });
    expect(loadSecret).not.toHaveBeenCalled();
    expect(session.wallet).toBeNull();
  });

  it("Unlock opens a wallet saved on the chosen network", async () => {
    const loadSecret = rememberSaved();
    const info = await api.unlockWallet();
    expect(loadSecret).toHaveBeenCalledWith(SAVED.wallet_id);
    expect(info.network).toBe("testnet4");
    expect(session.wallet?.network).toBe("testnet4");
  });
});

describe("coin control reaches the core (6.3)", () => {
  it("a build with chosen coins takes the coin-control path, and one without does not", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    fake.calls.length = 0;
    const coin = { txid: "ab".repeat(32), vout: 1 };
    const pay = [{ address: fake.ADDRESS, amount_sat: 1000 }];

    await api.buildTransfer(pay, 2, [coin]);
    await api.buildDrain(fake.ADDRESS, 2, [coin]);
    await api.buildTransfer(pay, 2);
    await api.buildDrain(fake.ADDRESS, 2);
    await api.setFrozen(coin, true);

    const coinControl = new Set(["build_transfer_from", "build_drain_from", "set_frozen"]);
    const coinCalls = fake.calls
      .filter((c) => coinControl.has(String(c[0])))
      .map((c) => (c[0] === "set_frozen" ? c : c.slice(0, 2)));
    expect(coinCalls).toEqual([
      ["build_transfer_from", [coin]],
      ["build_drain_from", [coin]],
      ["set_frozen", coin, true],
    ]);
  });
});
