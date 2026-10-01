/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { renderCreate as renderPhoneCreate } from "../src/mobile/screens/create";
import { renderRestore as renderPhoneRestore, setRestoreMode } from "../src/mobile/screens/restore";
import { renderUnlock as renderPhoneUnlock } from "../src/mobile/screens/unlock";
import { platform, setPlatform } from "../src/platform";
import type { Route } from "../src/router";
import { renderCreate } from "../src/screens/create";
import { renderKey } from "../src/screens/key";
import { renderRestore } from "../src/screens/restore";
import { renderUnlock } from "../src/screens/unlock";
import { session } from "../src/session";
import { historyResetFixes, type RememberedWallet, WalletError } from "../src/types";
import { fake } from "./fakes";
import { at, buttonNamed, find, mount, settle, type, useScreenHarness } from "./harness";

useScreenHarness();

/** The fake core gives every wallet this id, whatever opened it. */
const WALLET_ID = "testnet4-p2wpkh-fake";
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const WORDS = PHRASE.split(" ");

const SAVED: RememberedWallet = {
  wallet_id: WALLET_ID,
  address: fake.ADDRESS,
  network: "testnet4",
  address_type: "p2wpkh",
};

// The canvas's words (MUnlockReset and its note), and that freezing goes with the history.
const UNREADABLE = "The saved wallet data on this device cannot be read.";
const TRIGGER = "Reset this device's history";
const SECOND_STEP =
  "The key stays on this device. The history saved here is deleted and downloaded again on the next sync, and any coin you froze is unfrozen.";

type Reason = "malformed" | "mismatch" | "future_version";

function hasButton(root: ParentNode, name: string): boolean {
  return [...root.querySelectorAll("button")].some((b) => b.textContent?.trim() === name);
}

/** Types the phrase's word into every word box there is, by the position its label names. */
function typeWords(screen: HTMLElement): void {
  for (const box of screen.querySelectorAll<HTMLInputElement>('input[aria-label^="Word "]')) {
    const position = Number(box.getAttribute("aria-label")?.slice("Word ".length));
    type(box, WORDS[position - 1] ?? "");
  }
}

/** A screen that opens a wallet, by one of its ways in. */
interface Opener {
  name: string;
  route: Route;
  /** It opens the remembered wallet, with the key from the key store. */
  remembered: boolean;
  /** Renders the screen and fills it in, ready for `press`. */
  render(): Promise<HTMLElement>;
  /** The button that opens the wallet. */
  press: string;
}

const OPENERS: readonly Opener[] = [
  {
    name: "desktop Unlock",
    route: "unlock",
    remembered: true,
    press: "Unlock",
    render: async () => mount(renderUnlock()),
  },
  {
    name: "desktop Key, private key",
    route: "key",
    remembered: false,
    press: "Open wallet",
    render: async () => {
      const screen = mount(renderKey());
      type(find(screen, "input[name=secret]"), "11".repeat(32));
      return screen;
    },
  },
  {
    name: "desktop Key, watch-only",
    route: "key",
    remembered: false,
    press: "Follow this wallet",
    render: async () => {
      const screen = mount(renderKey());
      type(find(screen, "textarea[name=descriptor]"), "wpkh(tpubD6NzVbkrYhZ4X/0/*)");
      return screen;
    },
  },
  {
    name: "desktop Restore",
    route: "restore",
    remembered: false,
    press: "Restore wallet",
    render: async () => {
      const screen = mount(renderRestore());
      typeWords(screen);
      // Leaving a box checks the phrase at once instead of after a pause in typing.
      find(screen, 'input[aria-label="Word 12"]').dispatchEvent(new Event("blur"));
      await settle();
      return screen;
    },
  },
  {
    name: "desktop Create",
    route: "create",
    remembered: false,
    press: "Create wallet",
    render: async () => {
      const screen = mount(renderCreate());
      await settle();
      typeWords(screen);
      return screen;
    },
  },
  {
    name: "phone Unlock",
    route: "unlock",
    remembered: true,
    press: "Unlock",
    render: async () => mount(renderPhoneUnlock()),
  },
  {
    name: "phone Restore, recovery phrase",
    route: "restore",
    remembered: false,
    press: "Restore wallet",
    render: async () => {
      setRestoreMode("phrase");
      const screen = mount(renderPhoneRestore());
      typeWords(screen);
      return screen;
    },
  },
  {
    name: "phone Restore, single key",
    route: "restore",
    remembered: false,
    press: "Open wallet",
    render: async () => {
      setRestoreMode("key");
      const screen = mount(renderPhoneRestore());
      type(find(screen, "input[name=secret]"), "11".repeat(32));
      return screen;
    },
  },
  {
    name: "phone Restore, watch-only",
    route: "restore",
    remembered: false,
    press: "Follow this wallet",
    render: async () => {
      setRestoreMode("watch");
      const screen = mount(renderPhoneRestore());
      type(find(screen, "textarea[name=descriptor]"), "wpkh(tpubD6NzVbkrYhZ4X/0/*)");
      return screen;
    },
  },
  {
    name: "phone Create",
    route: "create",
    remembered: false,
    press: "Create wallet",
    render: async () => {
      const screen = mount(renderPhoneCreate());
      await settle();
      typeWords(screen);
      return screen;
    },
  },
];

/**
 * Opens `opener`'s screen on a device in the state it needs, with the key
 * store and the settings watched, and presses its button while the saved
 * record fails to read for `reason`.
 */
async function failToOpen(opener: Opener, reason: Reason) {
  const watched = {
    forgetSecret: vi.fn(async () => undefined),
    setRemembered: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
  };
  setPlatform({
    ...platform(),
    ...watched,
    ...(opener.remembered
      ? {
          canRememberWallet: true,
          getRemembered: async () => SAVED,
          loadSecret: async () => ({ secret: PHRASE, passphrase: null }),
        }
      : {}),
  });
  session.remembered = opener.remembered ? SAVED : null;
  at(opener.route);
  const screen = await opener.render();

  fake.state.corrupt = reason;
  buttonNamed(screen, opener.press).click();
  await settle();
  return { screen, ...watched };
}

afterEach(() => {
  session.remembered = null;
});

describe("a wallet whose saved history cannot be read offers a reset (6.7)", () => {
  it.each(OPENERS)("$name says so, and deletes nothing before the second step", async (opener) => {
    const { screen } = await failToOpen(opener, "malformed");
    expect(screen.textContent).toContain(UNREADABLE);
    expect(screen.querySelector(".banner-visible")).toBeNull();

    buttonNamed(screen, TRIGGER).click();
    expect(screen.textContent).toContain(SECOND_STEP);
    buttonNamed(screen, "Keep it").click();

    expect(screen.textContent).not.toContain(SECOND_STEP);
    expect(screen.textContent).toContain(UNREADABLE);
    expect(fake.callNames()).not.toContain("deleteWalletState");
    expect(session.wallet).toBeNull();
  });

  it.each(OPENERS)(
    "$name deletes only this device's history, then opens the wallet",
    async (opener) => {
      const { screen, forgetSecret, setRemembered, setConfig } = await failToOpen(
        opener,
        "mismatch",
      );

      buttonNamed(screen, TRIGGER).click();
      buttonNamed(screen, "Reset history").click();
      await settle();

      expect(fake.calls.filter((c) => c[0] === "deleteWalletState")).toEqual([
        ["deleteWalletState", WALLET_ID],
      ]);
      expect(forgetSecret).not.toHaveBeenCalled();
      expect(setRemembered).not.toHaveBeenCalled();
      expect(setConfig).not.toHaveBeenCalled();
      expect(session.wallet?.wallet_id).toBe(WALLET_ID);
      expect(window.location.hash).toBe("#/dashboard");
    },
  );

  it.each(OPENERS)(
    "$name asks for an update when a newer version saved the data, and offers no reset",
    async (opener) => {
      const { screen } = await failToOpen(opener, "future_version");

      const alert = find(screen, ".banner-visible");
      expect(alert.textContent).toContain("from a newer version of the app");
      expect(alert.textContent).toContain("Update the app");
      expect(hasButton(screen, TRIGGER)).toBe(false);
      expect(fake.callNames()).not.toContain("deleteWalletState");
      expect(session.wallet).toBeNull();
    },
  );

  it("the phone's Unlock gives its place to the reset, and takes it back for any other error", async () => {
    const phoneUnlock = OPENERS.find((o) => o.name === "phone Unlock");
    if (!phoneUnlock) throw new Error("no phone Unlock case");
    const { screen } = await failToOpen(phoneUnlock, "malformed");
    expect(hasButton(screen, "Unlock")).toBe(false);
    expect(hasButton(screen, "Use a different wallet")).toBe(true);

    // Saved again by a newer version before the reset is confirmed: the
    // reset leaves that record alone.
    fake.state.corrupt = "future_version";
    buttonNamed(screen, TRIGGER).click();
    buttonNamed(screen, "Reset history").click();
    await settle();

    expect(fake.callNames()).not.toContain("deleteWalletState");
    expect(find(screen, ".banner-visible").textContent).toContain("Update the app");
    expect(hasButton(screen, TRIGGER)).toBe(false);
    expect(hasButton(screen, "Unlock")).toBe(true);
  });
});

describe("the reset deletes only a record that has just failed to read (6.7)", () => {
  it.each([
    { reason: "malformed", fixes: true },
    { reason: "mismatch", fixes: true },
    { reason: "future_version", fixes: false },
  ])("a $reason record is one a reset fixes: $fixes", ({ reason, fixes }) => {
    const error = new WalletError("corrupt_state", "saved wallet data could not be read", {
      reason,
      found: null,
      supported: null,
    });
    expect(historyResetFixes(error)).toBe(fixes);
  });

  it("no other failure is", () => {
    expect(historyResetFixes(new WalletError("corrupt_state", "no details"))).toBe(false);
    expect(historyResetFixes(new WalletError("persist", "x", { reason: "malformed" }))).toBe(false);
    expect(historyResetFixes(new Error("malformed"))).toBe(false);
  });

  it("opens a wallet whose record reads, and deletes nothing", async () => {
    await api.resetHistoryAndOpen(PHRASE, "p2wpkh", false);

    expect(fake.callNames()).toEqual(["open"]);
    expect(session.wallet?.wallet_id).toBe(WALLET_ID);
  });

  it("leaves a record from a newer version alone", async () => {
    fake.state.corrupt = "future_version";

    await expect(api.resetHistoryAndOpen(PHRASE, "p2wpkh", false)).rejects.toMatchObject({
      code: "corrupt_state",
    });
    expect(fake.callNames()).toEqual(["open"]);
    expect(session.wallet).toBeNull();
  });

  it("reads a remembered key from the key store once", async () => {
    const loadSecret = vi.fn(async () => ({ secret: PHRASE, passphrase: null }));
    setPlatform({
      ...platform(),
      canRememberWallet: true,
      getRemembered: async () => SAVED,
      loadSecret,
    });
    fake.state.corrupt = "malformed";

    await api.resetHistoryAndUnlock();

    expect(loadSecret).toHaveBeenCalledTimes(1);
    expect(fake.callNames()).toEqual(["open", "deleteWalletState", "open"]);
    expect(session.wallet?.wallet_id).toBe(WALLET_ID);
  });
});
