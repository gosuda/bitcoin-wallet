/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { renderCreate as renderPhoneCreate } from "../src/mobile/screens/create";
import { renderRestore as renderPhoneRestore, setRestoreMode } from "../src/mobile/screens/restore";
import { renderUnlock as renderPhoneUnlock } from "../src/mobile/screens/unlock";
import { platform, setPlatform } from "../src/platform";
import type { Route } from "../src/router";
import { renderUnlock } from "../src/screens/unlock";
import { session } from "../src/session";
import type { RememberedWallet } from "../src/types";
import { fake } from "./fakes";
import { at, buttonNamed, find, leaveTo, mount, settle, type, useScreenHarness } from "./harness";

useScreenHarness();

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const WORDS = PHRASE.split(" ");

const SAVED: RememberedWallet = {
  wallet_id: "testnet4-p2wpkh-fake",
  address: fake.ADDRESS,
  network: "testnet4",
  address_type: "p2wpkh",
};

/** Types the phrase's word into every word box there is, by the position its label names. */
function typeWords(screen: HTMLElement): void {
  for (const box of screen.querySelectorAll<HTMLInputElement>('input[aria-label^="Word "]')) {
    const position = Number(box.getAttribute("aria-label")?.slice("Word ".length));
    type(box, WORDS[position - 1] ?? "");
  }
}

/** A promise held open until `release` is called. */
function held<T>(value: T): { promise: Promise<T>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<T>((resolve) => {
    release = () => resolve(value);
  });
  return { promise, release };
}

interface Opener {
  name: string;
  route: Route;
  press: string;
  /** Installs a platform whose step after the press waits on `gate`. */
  hold(gate: Promise<void>): void;
  render(): Promise<HTMLElement>;
}

/** Unlock reads the key from the key store; the read is what waits. */
function unlocking(gate: Promise<void>): void {
  setPlatform({
    ...platform(),
    canRememberWallet: true,
    getRemembered: async () => SAVED,
    loadSecret: async () => {
      await gate;
      return { secret: PHRASE, passphrase: null };
    },
  });
  session.remembered = SAVED;
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

const OPENERS: readonly Opener[] = [
  {
    name: "desktop Unlock",
    route: "unlock",
    press: "Unlock",
    hold: unlocking,
    render: async () => mount(renderUnlock()),
  },
  {
    name: "phone Unlock",
    route: "unlock",
    press: "Open wallet",
    hold: unlocking,
    render: async () => mount(renderPhoneUnlock()),
  },
  {
    name: "phone Restore, recovery phrase",
    route: "restore",
    press: "Restore wallet",
    hold: readingBack,
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
    press: "Open wallet",
    hold: readingBack,
    render: async () => {
      setRestoreMode("key");
      const screen = mount(renderPhoneRestore());
      type(find(screen, "input[name=secret]"), "11".repeat(32));
      return screen;
    },
  },
  {
    name: "phone Create",
    route: "create",
    press: "Create wallet",
    hold: readingBack,
    render: async () => {
      const screen = mount(renderPhoneCreate());
      await settle();
      typeWords(screen);
      return screen;
    },
  },
];

describe.each(OPENERS)("an open that finishes after $name was left", (opener) => {
  it("opens the wallet, and leaves the screen the user went to alone", async () => {
    const { promise, release } = held<void>(undefined);
    opener.hold(promise);
    at(opener.route);
    const screen = await opener.render();

    buttonNamed(screen, opener.press).click();
    await settle();
    leaveTo("setup");
    release();
    await settle();

    // It went through, so the wallet is open wherever the user is now…
    expect(session.wallet?.wallet_id).toBe(SAVED.wallet_id);
    // …but the screen they went to is theirs.
    expect(window.location.hash).toBe("#/setup");
  });
});
