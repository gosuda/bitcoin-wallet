/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { boot } from "../src/app";
import { renderSettings as renderPhoneSettings } from "../src/mobile/screens/settings";
import { mount as mountPhone } from "../src/mobile/shell";
import { platform, setPlatform } from "../src/platform";
import { renderSettings } from "../src/screens/settings";
import { session } from "../src/session";
import { DEFAULT_LOCK_AFTER, lockAfterFrom } from "../src/types";
import { chooseLockAfter, lockAfter, startAutolock } from "../src/ui/autolock";
import { fake } from "./fakes";
import { at, buttonNamed, find, mountAt, useScreenHarness } from "./harness";

useScreenHarness();

const MINUTE = 60_000;
const TXID = "f".repeat(64);

/*
 * jsdom's page is always in view. These put it out of sight and back, as
 * minimizing a window or switching away from an app does.
 */
let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => visibility === "hidden",
});

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A phone suspends the page in the background: the clock moves on, no timer runs. */
function sleepFor(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

/** Lets the lock's own awaits finish without moving the clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** What the device has saved as the lock time; nothing, to begin with. */
let saved: unknown;

/** A device that keeps keys, and saves the lock time where a test can read it. */
function keepKeys(): void {
  setPlatform({
    ...platform(),
    canRememberWallet: true,
    getLockAfter: async () => lockAfterFrom(saved),
    setLockAfter: async (choice) => {
      saved = choice;
    },
  });
}

/** Opens a wallet and remembers it, as Key does with the box ticked. */
async function openRemembered(): Promise<void> {
  keepKeys();
  session.remembered = await api.openWallet("abandon abandon abandon", "p2wpkh", true);
}

let stop: (() => void) | undefined;

/** Opens a remembered wallet and starts the lock, which `afterEach` stops. */
async function openLocking(): Promise<void> {
  await openRemembered();
  stop = await startAutolock();
}

beforeEach(() => {
  vi.useFakeTimers();
  saved = undefined;
  at("dashboard");
});

afterEach(() => {
  stop?.();
  stop = undefined;
  visibility = "visible";
  session.remembered = null;
  vi.useRealTimers();
});

describe("a remembered wallet locks in the background (6.11)", () => {
  it("closes to Unlock at the deadline where timers run, as a desktop window's do", async () => {
    await openLocking();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(session.wallet).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(session.wallet).toBeNull();
    expect(window.location.hash).toBe("#/unlock");
  });

  it("closes to Unlock on return where no timer ran, as on a phone", async () => {
    await openLocking();

    setVisibility("hidden");
    sleepFor(6 * MINUTE);
    await flush();
    expect(session.wallet).not.toBeNull();
    setVisibility("visible");
    await flush();

    expect(session.wallet).toBeNull();
    expect(window.location.hash).toBe("#/unlock");
  });

  it("counts from when the page first went out of sight", async () => {
    await openLocking();

    setVisibility("hidden");
    sleepFor(3 * MINUTE);
    // Hidden again with no return in between: the deadline stays where it was.
    setVisibility("hidden");
    sleepFor(3 * MINUTE);
    setVisibility("visible");
    await flush();

    expect(session.wallet).toBeNull();
  });

  it("stays open when the app comes back in time, and each absence counts afresh", async () => {
    await openLocking();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    setVisibility("visible");
    setVisibility("hidden");
    // The first absence's deadline passes in here; this one has its own.
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    setVisibility("visible");
    await flush();
    expect(session.wallet).not.toBeNull();

    setVisibility("hidden");
    sleepFor(4 * MINUTE);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(session.wallet).not.toBeNull();
    expect(window.location.hash).toBe("#/dashboard");
  });

  it.each([
    { what: "a wallet that is not remembered", keeps: true, record: false },
    // A stale record can still name the wallet where no key can be kept.
    {
      what: "a wallet named by a record on a device that keeps no keys",
      keeps: false,
      record: true,
    },
  ])("leaves $what open", async ({ keeps, record }) => {
    if (keeps) keepKeys();
    const info = await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    if (record) session.remembered = info;
    stop = await startAutolock();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    setVisibility("visible");
    await flush();

    expect(session.wallet).not.toBeNull();
    expect(window.location.hash).toBe("#/dashboard");
  });

  it("waits for a sync that runs past the deadline, then locks", async () => {
    await openLocking();
    const release = fake.holdSync();
    const syncing = api.sync();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(session.wallet).not.toBeNull();

    release();
    await expect(syncing).resolves.toMatchObject({ confirmed: 50_000 });
    await flush();

    expect(session.wallet).toBeNull();
    expect(window.location.hash).toBe("#/unlock");
  });

  it("waits for a broadcast the same way, when the check comes on return", async () => {
    await openLocking();
    let finish = (): void => undefined;
    vi.spyOn(fake.FakeWallet.prototype, "broadcast").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ txid: TXID, persist_error: null });
        }),
    );
    const preview = await api.buildTransfer([{ address: fake.ADDRESS, amount_sat: 1_000 }], 2);
    const sending = api.signAndBroadcast(preview.psbt_id);

    setVisibility("hidden");
    sleepFor(6 * MINUTE);
    setVisibility("visible");
    await flush();
    expect(session.wallet).not.toBeNull();

    finish();
    await expect(sending).resolves.toMatchObject({ txid: TXID });
    await flush();

    expect(session.wallet).toBeNull();
    expect(window.location.hash).toBe("#/unlock");
  });

  it("leaves alone the same wallet opened again while a lock waited", async () => {
    await openLocking();
    const release = fake.holdSync();
    const syncing = api.sync();
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    setVisibility("visible");

    // Closed by hand mid-sync, then opened again: the same wallet, a new session.
    await api.closeWallet();
    await openRemembered();
    release();
    await syncing;
    await flush();

    expect(session.wallet).not.toBeNull();
    expect(window.location.hash).toBe("#/dashboard");
  });

  it("never locks on Never", async () => {
    await openLocking();
    await chooseLockAfter("never");

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(24 * 60 * MINUTE);
    setVisibility("visible");
    await flush();

    expect(session.wallet).not.toBeNull();
  });
});

describe("the lock time is kept by the platform (6.11)", () => {
  it("is read at start, five minutes when nothing is saved, and saved when chosen", async () => {
    keepKeys();
    saved = 15;
    stop = await startAutolock();
    expect(lockAfter()).toBe(15);
    stop();

    saved = undefined;
    stop = await startAutolock();
    expect(lockAfter()).toBe(DEFAULT_LOCK_AFTER);

    await chooseLockAfter(60);
    expect(saved).toBe(60);
    expect(lockAfter()).toBe(60);
  });

  it("reads anything this build does not offer as five minutes", () => {
    expect(DEFAULT_LOCK_AFTER).toBe(5);
    for (const unreadable of [undefined, null, 0, 7, "15 min", "", {}]) {
      expect(lockAfterFrom(unreadable)).toBe(5);
    }
    expect(lockAfterFrom(60)).toBe(60);
    expect(lockAfterFrom("never")).toBe("never");
  });

  it("falls back to five minutes when the saved one cannot be read at all", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setPlatform({
      ...platform(),
      getLockAfter: async () => {
        throw new Error("store locked");
      },
    });
    await chooseLockAfter("never");

    stop = await startAutolock();

    expect(lockAfter()).toBe(5);
    expect(error).toHaveBeenCalledOnce();
  });
});

function rowNamed(screen: HTMLElement, selector: string, name: string): string {
  const row = [...screen.querySelectorAll(selector)].find(
    (r) => r.firstElementChild?.textContent === name,
  );
  if (!row) throw new Error(`no ${selector} row named ${name}`);
  return row.textContent ?? "";
}

describe("Lock after in Settings (6.11)", () => {
  it("the desktop offers it in the Security card, as a select saved on change", async () => {
    await openLocking();
    const screen = mountAt("settings", renderSettings);
    const select = find<HTMLSelectElement>(screen, "select[name=lock_after]");

    expect([...select.options].map((o) => o.text)).toEqual([
      "1 min in background",
      "5 min in background",
      "15 min in background",
      "1 hour in background",
      "Never",
    ]);
    expect(select.value).toBe("5");
    expect(screen.textContent).toContain(
      "After this long in the background a remembered wallet closes to Unlock — never in the middle of a sync or a broadcast.",
    );

    select.value = "60";
    select.dispatchEvent(new Event("change"));
    await flush();

    expect(lockAfter()).toBe(60);
    expect(saved).toBe(60);
  });

  it("the phone offers it beside Remembered on this device, as chips saved on a tap", async () => {
    await openLocking();
    const screen = mountAt("settings", renderPhoneSettings);
    const chips = find(screen, "[role=radiogroup][aria-label='Lock after']");

    expect([...chips.querySelectorAll("[role=radio]")].map((c) => c.textContent)).toEqual([
      "1 min",
      "5 min",
      "15 min",
      "1 hour",
      "Never",
    ]);
    expect(find(chips, "[aria-checked=true]").textContent).toBe("5 min");

    buttonNamed(chips, "Never").click();
    await flush();

    expect(lockAfter()).toBe("never");
    expect(saved).toBe("never");
  });

  it("both say it is not available where no key can be kept", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);

    const desktop = mountAt("settings", renderSettings);
    expect(desktop.querySelector("select")).toBeNull();
    expect(rowNamed(desktop, ".setting-row", "Lock after")).toBe("Lock afterNot available here");
    expect(desktop.textContent).not.toContain("After this long in the background");

    const phone = mountAt("settings", renderPhoneSettings);
    expect(phone.querySelector("[aria-label='Lock after']")).toBeNull();
    expect(rowNamed(phone, ".m-item", "Lock after")).toBe("Lock afterNot available here");
  });

  it("says when a choice could not be saved, which still holds until the app closes", async () => {
    await openLocking();
    setPlatform({
      ...platform(),
      setLockAfter: async () => {
        throw new Error("store locked");
      },
    });
    const screen = mountAt("settings", renderSettings);
    const select = find<HTMLSelectElement>(screen, "select[name=lock_after]");

    select.value = "1";
    select.dispatchEvent(new Event("change"));
    await flush();

    expect(find(screen, ".banner").textContent).toBe(
      "The lock time could not be saved (store locked). It holds until the app closes.",
    );
    expect(lockAfter()).toBe(1);
  });
});

/*
 * Last: booting leaves the shell listening for the rest of the file, as in
 * desktop-shell.test.ts.
 */
describe("the app starts it (6.11)", () => {
  it("at boot, before the phone shell mounts, as before the desktop's", async () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.replaceChildren(root);
    await openRemembered();
    const record = session.remembered;
    setPlatform({ ...platform(), getRemembered: async () => record });
    await boot({ mount: mountPhone });
    await flush();
    expect(root.querySelector(".m-tabs")).not.toBeNull();

    setVisibility("hidden");
    sleepFor(5 * MINUTE);
    setVisibility("visible");
    await flush();

    expect(session.wallet).toBeNull();
    expect(root.querySelector("h1")?.textContent).toBe("Unlock");
  });
});
