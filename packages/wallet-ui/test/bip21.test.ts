import { describe, expect, it } from "vitest";
import { buildPaymentUri, parsePaymentUri, qrPayload } from "../src/bip21";

const ADDR = "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl";

describe("parsePaymentUri", () => {
  it("takes a bare address", () => {
    expect(parsePaymentUri(ADDR)).toEqual({ address: ADDR });
    expect(parsePaymentUri(`  ${ADDR}  `)).toEqual({ address: ADDR });
  });

  // A camera pointed at the wrong QR must not silently become a payee.
  it("refuses text that is not address-shaped", () => {
    for (const junk of ["https://example.com", "hello world", "short", "", "   ", "a".repeat(91)]) {
      expect(parsePaymentUri(junk), junk).toBeNull();
    }
  });

  it("reads amount in BTC as whole sats", () => {
    expect(parsePaymentUri(`bitcoin:${ADDR}?amount=0.0001`)).toEqual({
      address: ADDR,
      amountSat: 10_000,
    });
    expect(parsePaymentUri(`bitcoin:${ADDR}?amount=0.00000001`)?.amountSat).toBe(1);
  });

  // 0.1 * 1e8 is 10000000.000000002 in binary floating point.
  it("does not lose a sat to floating point", () => {
    expect(parsePaymentUri(`bitcoin:${ADDR}?amount=0.1`)?.amountSat).toBe(10_000_000);
    expect(parsePaymentUri(`bitcoin:${ADDR}?amount=0.29`)?.amountSat).toBe(29_000_000);
  });

  it("keeps the address when the amount is unusable", () => {
    for (const bad of ["0", "-1", "abc", "NaN", "Infinity", ""]) {
      const parsed = parsePaymentUri(`bitcoin:${ADDR}?amount=${bad}`);
      expect(parsed?.address, bad).toBe(ADDR);
      expect(parsed?.amountSat, bad).toBeUndefined();
    }
  });

  it("accepts the scheme in any case", () => {
    expect(parsePaymentUri(`BITCOIN:${ADDR}`)?.address).toBe(ADDR);
    expect(parsePaymentUri(`Bitcoin:${ADDR}`)?.address).toBe(ADDR);
  });

  it("ignores parameters it does not implement", () => {
    const parsed = parsePaymentUri(`bitcoin:${ADDR}?amount=0.001&lightning=lnbc1&req-x=1`);
    expect(parsed).toEqual({ address: ADDR, amountSat: 100_000 });
  });

  it("takes label, falling back to message", () => {
    expect(parsePaymentUri(`bitcoin:${ADDR}?label=Coffee`)?.label).toBe("Coffee");
    expect(parsePaymentUri(`bitcoin:${ADDR}?message=Rent`)?.label).toBe("Rent");
    // An explicitly empty `label=` alongside a `message=` is left untested:
    // `??` keeps the empty string rather than falling through, and which of
    // those a payer means is a product question, not a settled one.
  });

  it("decodes percent-escapes in the address and label", () => {
    expect(parsePaymentUri(`bitcoin:${ADDR}?label=Bob%27s%20Bar`)?.label).toBe("Bob's Bar");
  });

  it("returns null for a scheme with no address", () => {
    expect(parsePaymentUri("bitcoin:")).toBeNull();
    expect(parsePaymentUri("bitcoin:?amount=1")).toBeNull();
  });
});

describe("buildPaymentUri", () => {
  it("omits an absent or zero amount", () => {
    expect(buildPaymentUri({ address: ADDR })).toBe(`bitcoin:${ADDR}`);
    expect(buildPaymentUri({ address: ADDR, amountSat: 0 })).toBe(`bitcoin:${ADDR}`);
  });

  it("writes BTC with no trailing zeros", () => {
    expect(buildPaymentUri({ address: ADDR, amountSat: 10_000 })).toBe(
      `bitcoin:${ADDR}?amount=0.0001`,
    );
    expect(buildPaymentUri({ address: ADDR, amountSat: 100_000_000 })).toBe(
      `bitcoin:${ADDR}?amount=1`,
    );
  });

  it("round-trips through the parser", () => {
    for (const amountSat of [1, 10_000, 100_000_000, 2_099_999_997_690_000]) {
      const uri = buildPaymentUri({ address: ADDR, amountSat });
      expect(parsePaymentUri(uri), uri).toEqual({ address: ADDR, amountSat });
    }
  });
});

describe("qrPayload", () => {
  it("upper-cases bech32, which is case-insensitive and denser in a QR", () => {
    expect(qrPayload(ADDR)).toBe(ADDR.toUpperCase());
    expect(qrPayload("bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")).toBe(
      "BCRT1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH",
    );
  });

  // The load-bearing branch: base58 is case-sensitive, so upper-casing one
  // yields a QR that scans cleanly and pays nobody.
  it("leaves base58 alone", () => {
    const base58 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
    expect(qrPayload(base58)).toBe(base58);
    const testnet = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn";
    expect(qrPayload(testnet)).toBe(testnet);
  });

  // A URI's parameters are not case-insensitive; an upper-cased label arrives changed.
  it("leaves a URI alone", () => {
    const uri = `bitcoin:${ADDR}?label=Coffee`;
    expect(qrPayload(uri)).toBe(uri);
  });
});
