import { describe, expect, it } from "vitest";
import { errorMessage, isAppError, MAX_FEE_RATE_SAT_VB, WalletError } from "../src/types";

/**
 * Every code this UI can receive: from `wallet_core::Error::code()`
 * (mirrored here, not imported — there is nothing to import across the
 * wasm boundary), from `api.ts`'s own `WalletError` throws, and from the
 * Tauri IPC envelope's `internal`/`config`.
 */
const ALL_CODES = [
  "invalid_key",
  "invalid_address",
  "descriptor",
  "persist",
  "backend",
  "timeout",
  "build_tx",
  "insufficient_funds",
  "invalid_fee_rate",
  "sign",
  "psbt",
  "unsupported",
  "dust",
  "fee_too_low",
  "no_utxos",
  "invalid_txid",
  "not_replaceable",
  "corrupt_state",
  "no_wallet",
  "no_config",
  "not_remembered",
  "unknown_psbt",
  "internal",
  "config",
] as const;

describe("errorMessage", () => {
  // The defect this whole table exists to fix: every message, however
  // clear on its own, arrived with its machine-readable code stapled on.
  it("never appends the raw code to a message, for any known code", () => {
    for (const code of ALL_CODES) {
      const msg = errorMessage(new WalletError(code, `${code} message`));
      expect(msg).not.toContain(`(${code})`);
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("computes the shortfall for insufficient_funds from details", () => {
    const err = new WalletError(
      "insufficient_funds",
      "insufficient funds: need 100 sat, have 40 sat",
      {
        needed_sat: 100,
        available_sat: 40,
      },
    );
    expect(errorMessage(err)).toBe("Need 60 more sat.");
  });

  it("names the required rate or fee for fee_too_low", () => {
    const byRate = new WalletError("fee_too_low", "x", {
      required_sat_vb: 4.5,
      required_sat: null,
    });
    expect(errorMessage(byRate)).toContain("4.5 sat/vB");

    const byAmount = new WalletError("fee_too_low", "x", {
      required_sat_vb: null,
      required_sat: 2000,
    });
    expect(errorMessage(byAmount)).toContain(`${(2000).toLocaleString("en-US")} sat`);
  });

  it("names the output for dust, one-indexed for a reader", () => {
    const err = new WalletError("dust", "x", { output: 0 });
    expect(errorMessage(err)).toContain("Output 1");
  });

  it("names the ceiling for invalid_fee_rate", () => {
    const msg = errorMessage(new WalletError("invalid_fee_rate", "x"));
    expect(msg).toContain(MAX_FEE_RATE_SAT_VB.toLocaleString("en-US"));
  });

  it("falls back to the message when details are missing or the wrong shape", () => {
    expect(errorMessage(new WalletError("insufficient_funds", "insufficient funds"))).toBe(
      "insufficient funds",
    );
    expect(
      errorMessage(new WalletError("insufficient_funds", "x", { needed_sat: "not a number" })),
    ).toBe("x");
    // A code this table has no special copy for is untouched, code and all
    // gone from the *output* but the message itself passed through as-is.
    expect(errorMessage(new WalletError("descriptor", "bad descriptor: x"))).toBe(
      "bad descriptor: x",
    );
  });

  it("still handles a plain Error, a string, and an unrecognized value", () => {
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage("just a string")).toBe("just a string");
    expect(errorMessage(42)).toBe("unexpected error");
  });
});

describe("WalletError", () => {
  it("is an AppError", () => {
    const err = new WalletError("no_wallet", "no wallet is open");
    expect(isAppError(err)).toBe(true);
  });

  // Guards the `exactOptionalPropertyTypes` fix: a `WalletError` built with
  // no details must leave the property absent, not present-and-undefined —
  // `AppError.details` only promises a value when the key exists at all.
  it("has no details property at all when none is given", () => {
    const err = new WalletError("no_wallet", "no wallet is open");
    expect(Object.hasOwn(err, "details")).toBe(false);
  });

  it("carries details through when given", () => {
    const err = new WalletError("insufficient_funds", "x", { needed_sat: 1 });
    expect(Object.hasOwn(err, "details")).toBe(true);
    expect(err.details).toEqual({ needed_sat: 1 });
  });
});
