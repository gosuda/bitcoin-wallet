/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { screenToken, stillCurrent } from "../src/screen";
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

beforeEach(() => {
  window.location.hash = "#/dashboard";
  session.wallet = wallet("signet-p2wpkh-aaaa");
});

describe("screen token", () => {
  it("stays current while nothing moves", () => {
    expect(stillCurrent(screenToken())).toBe(true);
  });

  it("goes stale when the route changes", () => {
    const token = screenToken();
    window.location.hash = "#/settings";
    expect(stillCurrent(token)).toBe(false);
  });

  // The case a route check alone would miss: same screen, different wallet.
  // This is how a sync started for one wallet repainted another's balance.
  it("goes stale when the wallet changes under the same route", () => {
    const token = screenToken();
    session.wallet = wallet("signet-p2wpkh-bbbb");
    expect(stillCurrent(token)).toBe(false);
  });

  it("goes stale when the wallet is closed", () => {
    const token = screenToken();
    session.wallet = null;
    expect(stillCurrent(token)).toBe(false);
  });

  it("is current again when the user returns to the same screen and wallet", () => {
    const token = screenToken();
    window.location.hash = "#/settings";
    window.location.hash = "#/dashboard";
    expect(stillCurrent(token)).toBe(true);
  });

  // An unknown hash resolves to setup, so a token taken there is not silently
  // equal to one taken on a real screen.
  it("does not treat an unknown route as the screen it came from", () => {
    const token = screenToken();
    window.location.hash = "#/nope";
    expect(stillCurrent(token)).toBe(false);
  });
});
