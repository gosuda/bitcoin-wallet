/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { platform, setPlatform } from "../src/platform";
import { type SealedStore, sealedKeystore, unseal } from "../src/platform/sealed";
import type { Route } from "../src/router";
import { renderCreate } from "../src/screens/create";
import { renderKey } from "../src/screens/key";
import { renderRestore } from "../src/screens/restore";
import { renderSettings } from "../src/screens/settings";
import { renderUnlock } from "../src/screens/unlock";
import { session } from "../src/session";
import type { RememberedWallet } from "../src/types";
import { fake } from "./fakes";
import { buttonNamed, find, leaveTo, mountAt, settle, type, useScreenHarness } from "./harness";
import { typeWords } from "./openers";

useScreenHarness();

/** The fake core gives every wallet this id, whatever opened it. */
const WALLET_ID = "testnet4-p2wpkh-fake";
const KEY = "11".repeat(32);
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PASSWORD = "correct horse battery staple";
/** Few rounds, so a test does not wait on the real count; a record carries its own. */
const ROUNDS = 1_000;

const SAVED: RememberedWallet = {
  wallet_id: WALLET_ID,
  address: fake.ADDRESS,
  network: "testnet4",
  address_type: "p2wpkh",
};

// The canvas's words (2e, 2f).
const BROWSER_HINT = "· encrypted with an app password and kept in this browser";
const WARNING =
  "Anyone with this browser's files and this password can spend. It cannot be recovered.";
const FORGOTTEN =
  "Forgotten it? It cannot be reset. Forget this wallet here, and open it again with what you opened it with — a recovery phrase and any passphrase you set, a private key, or an xpub or descriptor.";
const MISMATCH = "The passwords do not match.";

/**
 * The browser's platform, as far as keys go: an app password seals them, and
 * the sealed records sit in a map where IndexedDB would keep them.
 */
function inTheBrowser() {
  const records = new Map<string, unknown>();
  let remembered: RememberedWallet | null = null;
  const store: SealedStore = {
    get: async (walletId) => records.get(walletId),
    put: async (walletId, record) => {
      records.set(walletId, record);
    },
    delete: async (walletId) => {
      records.delete(walletId);
    },
  };
  setPlatform({
    ...platform(),
    canRememberWallet: true,
    needsAppPassword: true,
    getRemembered: async () => remembered,
    setRemembered: async (record) => {
      remembered = record;
    },
    ...sealedKeystore(store, ROUNDS),
  });
  return { records, remembered: () => remembered };
}

/** A wallet remembered in this browser under PASSWORD, as Key leaves one. */
async function savedInTheBrowser() {
  const browser = inTheBrowser();
  await platform().rememberSecret(WALLET_ID, KEY, undefined, PASSWORD);
  await platform().setRemembered(SAVED);
  session.remembered = SAVED;
  return browser;
}

function passwordPair(root: ParentNode): [HTMLInputElement, HTMLInputElement] {
  const [password, confirm] = root.querySelectorAll<HTMLInputElement>("input[name^=app_password]");
  if (!password || !confirm) throw new Error("no app password fields");
  return [password, confirm];
}

/** The error line under `input`'s field. */
function errorUnder(input: HTMLInputElement): string {
  return find(input.closest(".field") ?? document, ".field-error").textContent ?? "";
}

async function landsOn(route: Route): Promise<void> {
  await vi.waitFor(() => expect(window.location.hash).toBe(`#/${route}`));
}

/** Key's single-key panel, where the board draws it (2f). */
function singleKey(): HTMLElement {
  return find(mountAt("key", renderKey), ".disclosure-body");
}

afterEach(() => {
  session.remembered = null;
});

describe("remembering in the browser takes an app password (6.12)", () => {
  it("Key reveals App password and Confirm app password under a ticked Remember", () => {
    inTheBrowser();
    const panel = singleKey();
    expect(panel.textContent).toContain(BROWSER_HINT);
    const fields = find<HTMLElement>(panel, ".remember-password");
    expect(fields.hidden).toBe(true);

    find<HTMLInputElement>(panel, "input[name=remember]").click();

    expect(fields.hidden).toBe(false);
    expect([...fields.querySelectorAll("label")].map((l) => l.textContent)).toEqual([
      "App password",
      "Confirm app password",
    ]);
    expect(passwordPair(fields).map((f) => f.type)).toEqual(["password", "password"]);
    expect(fields.textContent).toContain(WARNING);
  });

  it("Open wallet waits until the two match, and says so when they part", async () => {
    const browser = inTheBrowser();
    const panel = singleKey();
    type(find(panel, "input[name=secret]"), KEY);
    find<HTMLInputElement>(panel, "input[name=remember]").click();
    const open = buttonNamed(panel, "Open wallet");
    const [password, confirm] = passwordPair(panel);
    expect(open.disabled).toBe(true);

    type(password, PASSWORD);
    type(confirm, "correct horse");
    // Still being typed, and right so far: not wrong yet.
    expect(open.disabled).toBe(true);
    expect(errorUnder(confirm)).toBe("");

    type(confirm, "correct horse battery stable");
    expect(open.disabled).toBe(true);
    expect(errorUnder(confirm)).toBe(MISMATCH);
    expect(confirm.getAttribute("aria-invalid")).toBe("true");
    open.click();
    await settle();
    expect(browser.records.size).toBe(0);
    expect(session.wallet).toBeNull();

    type(confirm, PASSWORD);
    expect(errorUnder(confirm)).toBe("");
    expect(open.disabled).toBe(false);
  });

  it("Open wallet seals the key under the password and remembers the wallet", async () => {
    const browser = inTheBrowser();
    const panel = singleKey();
    type(find(panel, "input[name=secret]"), KEY);
    find<HTMLInputElement>(panel, "input[name=remember]").click();
    const [password, confirm] = passwordPair(panel);
    type(password, PASSWORD);
    type(confirm, PASSWORD);

    buttonNamed(panel, "Open wallet").click();
    await landsOn("dashboard");

    const record = browser.records.get(WALLET_ID);
    expect(JSON.stringify(record)).not.toContain(KEY);
    expect(JSON.stringify(record)).not.toContain(PASSWORD);
    expect(await unseal(WALLET_ID, record, PASSWORD)).toEqual({ secret: KEY, passphrase: null });
    expect(browser.remembered()?.wallet_id).toBe(WALLET_ID);
    expect(session.remembered?.wallet_id).toBe(WALLET_ID);
  });

  // No minimum length: the owner's call (docs/ROADMAP.md, Decisions). The
  // warning under the fields and SECURITY.md say what a short one risks.
  it("takes an app password of any length, a single character included", async () => {
    const browser = inTheBrowser();
    const panel = singleKey();
    type(find(panel, "input[name=secret]"), KEY);
    find<HTMLInputElement>(panel, "input[name=remember]").click();
    const [password, confirm] = passwordPair(panel);
    type(password, "x");
    type(confirm, "x");
    const open = buttonNamed(panel, "Open wallet");
    expect(open.disabled).toBe(false);
    expect(errorUnder(confirm)).toBe("");

    open.click();
    await landsOn("dashboard");

    expect(await unseal(WALLET_ID, browser.records.get(WALLET_ID), "x")).toEqual({
      secret: KEY,
      passphrase: null,
    });
  });

  it("nothing is kept when Remember is left unticked", async () => {
    const browser = inTheBrowser();
    const panel = singleKey();
    type(find(panel, "input[name=secret]"), KEY);

    buttonNamed(panel, "Open wallet").click();
    await landsOn("dashboard");

    expect(browser.records.size).toBe(0);
    expect(browser.remembered()).toBeNull();
  });

  it.each([
    {
      name: "Create",
      route: "create" as const,
      render: renderCreate,
      press: "Create wallet",
      fill: async (screen: HTMLElement) => {
        await settle();
        typeWords(screen);
      },
    },
    {
      name: "Restore",
      route: "restore" as const,
      render: renderRestore,
      press: "Restore wallet",
      fill: async (screen: HTMLElement) => {
        typeWords(screen);
        // Leaving a box checks the phrase at once instead of after a pause in typing.
        find(screen, 'input[aria-label="Word 12"]').dispatchEvent(new Event("blur"));
        await settle();
      },
    },
  ])("$name asks the same, right below the BIP39 passphrase", async (screenCase) => {
    const browser = inTheBrowser();
    const screen = mountAt(screenCase.route, screenCase.render);
    await screenCase.fill(screen);
    type(find(screen, "input[name=passphrase]"), "TREZOR");
    const go = buttonNamed(screen, screenCase.press);
    expect(go.disabled).toBe(false);

    find<HTMLInputElement>(screen, "input[name=remember]").click();
    expect(go.disabled).toBe(true);
    const order = [
      ...screen.querySelectorAll<HTMLInputElement>(
        "input[name=passphrase], input[name=remember], input[name^=app_password]",
      ),
    ].map((f) => f.name);
    expect(order).toEqual(["passphrase", "remember", "app_password", "app_password_confirm"]);

    const [password, confirm] = passwordPair(screen);
    type(password, PASSWORD);
    type(confirm, PASSWORD);
    expect(go.disabled).toBe(false);
    go.click();
    await landsOn("dashboard");

    expect(await unseal(WALLET_ID, browser.records.get(WALLET_ID), PASSWORD)).toEqual({
      secret: PHRASE,
      passphrase: "TREZOR",
    });
  });

  it("Settings says the key is kept in this browser", async () => {
    inTheBrowser();
    session.remembered = await api.openWallet(PHRASE, "p2wpkh", true, undefined, PASSWORD);
    const screen = mountAt("settings", renderSettings);
    expect(screen.textContent).toContain("Yes · in this browser, encrypted with your app password");
  });
});

describe("Unlock in the browser asks for the app password (6.12)", () => {
  it("says where the key is, and opens with the right password", async () => {
    await savedInTheBrowser();
    const screen = mountAt("unlock", renderUnlock);
    expect(screen.textContent).toContain("Wallet saved in this browser");
    expect(screen.textContent).toContain(
      "Its key is encrypted with your app password and kept in this browser's storage.",
    );
    expect(screen.textContent).toContain(FORGOTTEN);
    const password = find<HTMLInputElement>(screen, "input[name=app_password]");
    const unlock = buttonNamed(screen, "Unlock");
    expect(password.type).toBe("password");
    expect(unlock.disabled).toBe(true);

    type(password, PASSWORD);
    expect(unlock.disabled).toBe(false);
    unlock.click();
    await landsOn("dashboard");

    expect(session.wallet?.wallet_id).toBe(WALLET_ID);
  });

  it("says a wrong password under the field, and opens nothing", async () => {
    const browser = await savedInTheBrowser();
    const screen = mountAt("unlock", renderUnlock);
    const password = find<HTMLInputElement>(screen, "input[name=app_password]");
    type(password, "correct horse battery stable");

    buttonNamed(screen, "Unlock").click();
    await vi.waitFor(() => expect(errorUnder(password)).toBe("Wrong password."));

    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(screen.querySelector(".banner-visible")).toBeNull();
    expect(fake.callNames()).not.toContain("open");
    expect(session.wallet).toBeNull();
    expect(window.location.hash).toBe("#/unlock");
    expect(browser.records.has(WALLET_ID)).toBe(true);

    // Typing again takes the error away; the right password then opens it.
    type(password, PASSWORD);
    expect(errorUnder(password)).toBe("");
    buttonNamed(screen, "Unlock").click();
    await landsOn("dashboard");
  });

  it("the api refuses a wrong password before the core is asked anything", async () => {
    await savedInTheBrowser();
    await expect(api.unlockWallet("hunter2")).rejects.toMatchObject({ code: "wrong_password" });
    await expect(api.unlockWallet()).rejects.toMatchObject({ code: "wrong_password" });
    expect(fake.callNames()).toEqual([]);

    const info = await api.unlockWallet(PASSWORD);
    expect(info.wallet_id).toBe(WALLET_ID);
  });

  it("a history reset opens the wallet with the password typed", async () => {
    await savedInTheBrowser();
    const screen = mountAt("unlock", renderUnlock);
    type(find(screen, "input[name=app_password]"), PASSWORD);
    fake.state.corrupt = "malformed";

    buttonNamed(screen, "Unlock").click();
    (await vi.waitFor(() => buttonNamed(screen, "Reset this device's history"))).click();
    buttonNamed(screen, "Reset history").click();
    await landsOn("dashboard");

    expect(fake.calls.filter((c) => c[0] === "deleteWalletState")).toEqual([
      ["deleteWalletState", WALLET_ID],
    ]);
  });

  it("Forget this wallet deletes the sealed key as well", async () => {
    const browser = await savedInTheBrowser();
    const screen = mountAt("unlock", renderUnlock);

    buttonNamed(screen, "Forget this wallet").click();
    buttonNamed(screen, "Delete it").click();
    await landsOn("key");

    expect(browser.records.size).toBe(0);
    expect(browser.remembered()).toBeNull();
    expect(session.remembered).toBeNull();
  });

  it("the eye shows the password, and hides it again", async () => {
    await savedInTheBrowser();
    const screen = mountAt("unlock", renderUnlock);
    const password = find<HTMLInputElement>(screen, "input[name=app_password]");
    const eye = find<HTMLButtonElement>(screen, "button[aria-label='Show password']");

    eye.click();
    expect(password.type).toBe("text");
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    eye.click();
    expect(password.type).toBe("password");
    expect(eye.getAttribute("aria-pressed")).toBe("false");
  });

  it("no app password outlives its screen", async () => {
    await savedInTheBrowser();
    const screen = mountAt("unlock", renderUnlock);
    const unlockField = find<HTMLInputElement>(screen, "input[name=app_password]");
    type(unlockField, PASSWORD);
    leaveTo("key");
    expect(unlockField.value).toBe("");

    const panel = singleKey();
    find<HTMLInputElement>(panel, "input[name=remember]").click();
    const pair = passwordPair(panel);
    for (const field of pair) type(field, PASSWORD);
    leaveTo("setup");
    expect(pair.map((f) => f.value)).toEqual(["", ""]);
  });
});

describe("where the OS keystore keeps the key, nothing asks for an app password (6.12)", () => {
  it("Key, Create, Restore and Unlock show no password field, and Unlock opens at once", async () => {
    const loadSecret = vi.fn(async () => ({ secret: KEY, passphrase: null }));
    setPlatform({
      ...platform(),
      canRememberWallet: true,
      getRemembered: async () => SAVED,
      loadSecret,
    });

    for (const [route, render] of [
      ["key", renderKey],
      ["create", renderCreate],
      ["restore", renderRestore],
    ] as const) {
      const screen = mountAt(route, render);
      for (const box of screen.querySelectorAll<HTMLInputElement>("input[name=remember]")) {
        box.click();
      }
      expect(screen.textContent).toContain("unlocked with your login");
      expect(screen.querySelectorAll("input[name^=app_password]")).toHaveLength(0);
      expect(screen.textContent).not.toMatch(/app password/i);
    }

    session.remembered = SAVED;
    const screen = mountAt("unlock", renderUnlock);
    expect(screen.textContent).toContain("Wallet saved on this device");
    expect(screen.textContent).not.toMatch(/app password/i);
    expect(screen.textContent).not.toContain(FORGOTTEN);
    expect(screen.querySelectorAll("input")).toHaveLength(0);

    buttonNamed(screen, "Unlock").click();
    await landsOn("dashboard");
    // Asked by wallet id alone, as it always was.
    expect(loadSecret).toHaveBeenCalledWith(WALLET_ID);
  });
});
