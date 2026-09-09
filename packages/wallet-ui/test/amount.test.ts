import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount, SATS_PER_BTC } from "../src/amount";

describe("parseAmount, sat", () => {
  it("takes whole sats", () => {
    expect(parseAmount("1", "sat")).toEqual({ sats: 1, error: null });
    expect(parseAmount("  21000  ", "sat")).toEqual({ sats: 21000, error: null });
  });

  // The bug this module exists for: a phone keypad offers "e", and
  // Number("1e5") is 100000 — so a typo used to become a real amount.
  it("refuses exponent notation rather than reading it as a number", () => {
    expect(parseAmount("1e5", "sat").sats).toBeNull();
    expect(parseAmount("1e5", "sat").error).toBe("Enter a whole number of sats.");
  });

  it("refuses anything but digits", () => {
    // "1 " is absent on purpose: the parser trims, so it is a valid 1.
    for (const bad of ["1.5", "-1", "0x10", "1,000", "abc", "١٢٣", "+1", "1_0"]) {
      expect(parseAmount(bad, "sat").sats, bad).toBeNull();
    }
  });

  it("treats empty as incomplete, not wrong", () => {
    expect(parseAmount("", "sat")).toEqual({ sats: null, error: null });
    expect(parseAmount("   ", "sat")).toEqual({ sats: null, error: null });
  });

  it("rejects zero, which is not a payment", () => {
    expect(parseAmount("0", "sat").error).toBe("Amount must be more than 0 sat.");
    expect(parseAmount("000", "sat").error).toBe("Amount must be more than 0 sat.");
  });

  it("rejects amounts past exact integer range", () => {
    expect(parseAmount("9007199254740993", "sat").error).toBe("Amount is too large.");
  });
});

describe("parseAmount, btc", () => {
  // Number("0.1") * 1e8 is 10000000.000000002. Anything that multiplies is
  // wrong by a sat somewhere; this asserts the integer path.
  it("converts without floating-point drift", () => {
    expect(parseAmount("0.1", "btc").sats).toBe(10_000_000);
    expect(parseAmount("0.29", "btc").sats).toBe(29_000_000);
    expect(parseAmount("1.1", "btc").sats).toBe(110_000_000);
    expect(parseAmount("0.00000001", "btc").sats).toBe(1);
    expect(parseAmount("20999999.9769", "btc").sats).toBe(2_099_999_997_690_000);
  });

  it("accepts a bare leading or trailing point", () => {
    expect(parseAmount(".5", "btc").sats).toBe(50_000_000);
    expect(parseAmount("5.", "btc").sats).toBe(5 * SATS_PER_BTC);
  });

  it("rejects a lone point, which carries no digits", () => {
    expect(parseAmount(".", "btc").error).toBe("Enter an amount, digits only.");
  });

  it("rejects more precision than a satoshi", () => {
    expect(parseAmount("0.000000001", "btc").error).toBe(
      "BTC has 8 decimals at most — 1 sat is 0.00000001.",
    );
  });

  it("rejects exponent notation here too", () => {
    expect(parseAmount("1e-3", "btc").sats).toBeNull();
  });
});

describe("formatAmount", () => {
  it("strips trailing zeros but keeps significant ones", () => {
    expect(formatAmount(10_000_000, "btc")).toBe("0.1");
    expect(formatAmount(1, "btc")).toBe("0.00000001");
    expect(formatAmount(100_000_000, "btc")).toBe("1");
    expect(formatAmount(0, "btc")).toBe("0");
    expect(formatAmount(101_000_000, "btc")).toBe("1.01");
  });

  it("round-trips every amount a field can hold", () => {
    for (const sats of [1, 999, 10_000_000, 100_000_000, 2_099_999_997_690_000]) {
      expect(parseAmount(formatAmount(sats, "btc"), "btc").sats, String(sats)).toBe(sats);
      expect(parseAmount(formatAmount(sats, "sat"), "sat").sats, String(sats)).toBe(sats);
    }
  });
});
