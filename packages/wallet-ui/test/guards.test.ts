import { describe, expect, it } from "vitest";
import { type GuardState, guardRoute, PHONE_ONLY, type Shell } from "../src/guards";
import { ROUTES } from "../src/router";
import type { AddressType } from "../src/types";

const SHELLS: readonly Shell[] = ["desktop", "phone"];

const fresh: GuardState = {
  wallet: null,
  configType: null,
  unlockable: false,
  hasResult: false,
  hasTxid: false,
};
const configured: GuardState = { ...fresh, configType: "p2wpkh" };
const open: GuardState = { ...configured, wallet: { watchOnly: false } };
const watching: GuardState = { ...configured, wallet: { watchOnly: true } };

/** Every combination of the facts the guard reads: 72 states. */
function everyState(): GuardState[] {
  const states: GuardState[] = [];
  const wallets: GuardState["wallet"][] = [null, { watchOnly: false }, { watchOnly: true }];
  const types: (AddressType | null)[] = [null, "p2wpkh", "p2pk"];
  for (const wallet of wallets) {
    for (const configType of types) {
      for (const unlockable of [false, true]) {
        for (const hasResult of [false, true]) {
          for (const hasTxid of [false, true]) {
            states.push({ wallet, configType, unlockable, hasResult, hasTxid });
          }
        }
      }
    }
  }
  return states;
}

describe("guardRoute", () => {
  it.each(SHELLS)("sends a first run (%s) to Setup, whatever it asked for", (shell) => {
    for (const route of ROUTES) expect(guardRoute(route, fresh, shell), route).toBe("setup");
  });

  it.each(SHELLS)("with settings saved, opens the key screens (%s)", (shell) => {
    for (const route of ["key", "create", "restore"] as const) {
      expect(guardRoute(route, configured, shell)).toBe(route);
    }
    expect(guardRoute("dashboard", configured, shell)).toBe("setup");
    expect(guardRoute("send", configured, shell)).toBe("setup");
  });

  it.each(SHELLS)("offers Unlock only when there is something to unlock (%s)", (shell) => {
    expect(guardRoute("unlock", configured, shell)).toBe("key");
    expect(guardRoute("unlock", { ...configured, unlockable: true }, shell)).toBe("unlock");
  });

  // Saved by an older build; nothing can be opened on it, so the key screens
  // would only offer paths the core refuses.
  it.each(SHELLS)("sends a saved p2pk type back to Setup (%s)", (shell) => {
    const legacy: GuardState = { ...configured, configType: "p2pk", unlockable: true };
    for (const route of ["key", "create", "restore", "unlock"] as const) {
      expect(guardRoute(route, legacy, shell), route).toBe("setup");
    }
  });

  it("closes the wallet before Setup: from the dashboard on desktop, Settings on a phone", () => {
    expect(guardRoute("setup", open, "desktop")).toBe("dashboard");
    expect(guardRoute("setup", open, "phone")).toBe("settings");
  });

  it.each(SHELLS)("never offers Send to a wallet that only watches (%s)", (shell) => {
    expect(guardRoute("send", open, shell)).toBe("send");
    expect(guardRoute("send", watching, shell)).toBe("dashboard");
  });

  it.each(SHELLS)("shows a result only while there is one (%s)", (shell) => {
    expect(guardRoute("result", open, shell)).toBe("dashboard");
    expect(guardRoute("result", { ...open, hasResult: true }, shell)).toBe("result");
    expect(guardRoute("result", { ...configured, hasResult: true }, shell)).toBe("result");
  });

  it("sends the phone's own screens to the wallet on desktop", () => {
    for (const route of PHONE_ONLY) {
      expect(guardRoute(route, { ...open, hasTxid: true }, "desktop"), route).toBe("dashboard");
      expect(guardRoute(route, configured, "desktop"), route).toBe("setup");
    }
  });

  it("opens the phone's own screens with a wallet, and a transaction only once one is picked", () => {
    for (const route of ["receive", "scan", "settings", "export"] as const) {
      expect(guardRoute(route, open, "phone"), route).toBe(route);
      expect(guardRoute(route, configured, "phone"), route).toBe("setup");
    }
    expect(guardRoute("tx", open, "phone")).toBe("dashboard");
    expect(guardRoute("tx", { ...open, hasTxid: true }, "phone")).toBe("tx");
  });

  // A shell navigates to the answer and guards again on arrival, so an answer
  // that redirected once more would bounce between screens.
  it.each(SHELLS)("always answers with a route it lets through itself (%s)", (shell) => {
    for (const state of everyState()) {
      for (const route of ROUTES) {
        const landed = guardRoute(route, state, shell);
        expect(guardRoute(landed, state, shell), `${route} → ${landed}`).toBe(landed);
        if (shell === "desktop") expect(PHONE_ONLY.has(landed), landed).toBe(false);
      }
    }
  });
});
