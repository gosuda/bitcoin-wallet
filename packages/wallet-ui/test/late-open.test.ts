/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { session } from "../src/session";
import { deferred, fake } from "./fakes";
import { buttonNamed, leaveTo, rememberSaved, settle, useScreenHarness } from "./harness";
import { openerNamed } from "./openers";

useScreenHarness();

/** Unlock reads the key from the key store; the read is what waits. */
function unlocking(gate: Promise<void>): void {
  rememberSaved({
    loadSecret: async () => {
      await gate;
      return { secret: fake.PHRASE, passphrase: null };
    },
  });
}

/** The other openers hand the key to the core; its open is what waits. */
function opening(gate: Promise<void>): void {
  const open = fake.FakeWallet.open;
  vi.spyOn(fake.FakeWallet, "open").mockImplementation(async () => {
    await gate;
    return open();
  });
}

/** The openers held here: both Unlock screens, and the phone's Create and Restore. */
const LATE_OPENERS = [
  "desktop Unlock",
  "phone Unlock",
  "phone Restore, recovery phrase",
  "phone Restore, single key",
  "phone Create",
].map(openerNamed);

describe.each(LATE_OPENERS)("an open that finishes after $name was left", (opener) => {
  it("opens the wallet, and leaves the screen the user went to alone", async () => {
    const { promise, resolve: release } = deferred<void>();
    const hold = opener.remembered ? unlocking : opening;
    hold(promise);
    const screen = await opener.render();

    buttonNamed(screen, opener.press).click();
    await settle();
    leaveTo("setup");
    release();
    await settle();

    expect(session.wallet?.wallet_id).toBe(fake.SAVED.wallet_id);
    expect(window.location.hash).toBe("#/setup");
  });
});
