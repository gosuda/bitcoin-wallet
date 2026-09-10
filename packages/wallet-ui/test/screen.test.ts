/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { screenGuard } from "../src/screen";
import { session } from "../src/session";
import type { WalletInfo } from "../src/types";

const wallet = (wallet_id: string): WalletInfo => ({
  address: "tb1q0",
  network: "signet",
  address_type: "p2wpkh",
  wallet_id,
  is_hd: true,
  is_watch_only: false,
});

/**
 * jsdom queues its own `hashchange`, so navigation is driven explicitly here.
 * The shell builds screens from that event, which is what the guard keys on.
 */
const navigateTo = (hash: string): void => {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

beforeEach(() => {
  window.location.hash = "#/dashboard";
  session.wallet = wallet("signet-p2wpkh-aaaa");
});

describe("screenGuard", () => {
  it("holds while nothing moves", () => {
    expect(screenGuard()()).toBe(true);
  });

  it("lapses when the route changes", () => {
    const onScreen = screenGuard();
    navigateTo("#/settings");
    expect(onScreen()).toBe(false);
  });

  // The defect this guard was rewritten for. Route and wallet alone are equal
  // across the two visits, so a promise from the abandoned render read as
  // current and drove the freshly built one.
  it("does not revive when the user returns to the same screen", () => {
    const firstVisit = screenGuard();
    navigateTo("#/settings");
    navigateTo("#/dashboard");
    expect(firstVisit()).toBe(false);
  });

  it("gives each render its own answer", () => {
    const firstVisit = screenGuard();
    navigateTo("#/settings");
    navigateTo("#/dashboard");
    const secondVisit = screenGuard();
    expect(firstVisit()).toBe(false);
    expect(secondVisit()).toBe(true);
  });

  // A guard created during navigation must survive the event that created it,
  // or every screen would be born already retired.
  it("survives the navigation that built its screen", () => {
    let onScreen: (() => boolean) | null = null;
    const build = (): void => {
      onScreen = screenGuard();
      window.removeEventListener("hashchange", build);
    };
    window.addEventListener("hashchange", build);
    navigateTo("#/settings");
    expect(onScreen).not.toBeNull();
    expect((onScreen as unknown as () => boolean)()).toBe(true);
  });

  it("lapses when the wallet changes under the same route", () => {
    const onScreen = screenGuard();
    session.wallet = wallet("signet-p2wpkh-bbbb");
    expect(onScreen()).toBe(false);
  });

  it("lapses when the wallet is closed", () => {
    const onScreen = screenGuard();
    session.wallet = null;
    expect(onScreen()).toBe(false);
  });
});
