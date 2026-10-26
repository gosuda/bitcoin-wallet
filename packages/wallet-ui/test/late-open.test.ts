/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { platform, setPlatform } from "../src/platform";
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
