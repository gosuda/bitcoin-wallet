/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { platform, setPlatform } from "../src/platform";
import { session } from "../src/session";
import { fake } from "./fakes";
import { buttonNamed, leaveTo, settle, useScreenHarness } from "./harness";
import { OPENERS } from "./openers";

useScreenHarness();

/** A promise held open until `release` is called. */
function held<T>(value: T): { promise: Promise<T>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<T>((resolve) => {
    release = () => resolve(value);
  });
  return { promise, release };
}

/** Unlock reads the key from the key store; the read is what waits. */
function unlocking(gate: Promise<void>): void {
  setPlatform({
    ...platform(),
    canRememberWallet: true,
    getRemembered: async () => fake.SAVED,
    loadSecret: async () => {
      await gate;
      return { secret: fake.PHRASE, passphrase: null };
    },
  });
  session.remembered = fake.SAVED;
}

/** The phone's openers read the remembered record back once the wallet is open. */
function readingBack(gate: Promise<void>): void {
  setPlatform({
    ...platform(),
    getRemembered: async () => {
      await gate;
      return null;
    },
  });
}

/** The openers held here: both Unlock screens, and the phone's Create and Restore. */
const LATE = new Set([
  "desktop Unlock",
  "phone Unlock",
  "phone Restore, recovery phrase",
  "phone Restore, single key",
  "phone Create",
]);
const LATE_OPENERS = OPENERS.filter((o) => LATE.has(o.name));

describe.each(LATE_OPENERS)("an open that finishes after $name was left", (opener) => {
  it("opens the wallet, and leaves the screen the user went to alone", async () => {
    const { promise, release } = held<void>(undefined);
    // Installs a platform whose step after the press waits on `promise`.
    const hold = opener.remembered ? unlocking : readingBack;
    hold(promise);
    const screen = await opener.render();

    buttonNamed(screen, opener.press).click();
    await settle();
    leaveTo("setup");
    release();
    await settle();

    // It went through, so the wallet is open wherever the user is now…
    expect(session.wallet?.wallet_id).toBe(fake.SAVED.wallet_id);
    // …but the screen they went to is theirs.
    expect(window.location.hash).toBe("#/setup");
  });
});
