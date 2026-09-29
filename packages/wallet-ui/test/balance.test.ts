import { describe, expect, it } from "vitest";
import { headlineSat, pendingSat } from "../src/balance";
import type { Balance } from "../src/types";

const balance = (b: Partial<Balance>): Balance => ({
  confirmed: 0,
  trusted_pending: 0,
  untrusted_pending: 0,
  immature: 0,
  frozen: 0,
  ...b,
});

describe("balance rules", () => {
  // The defect this module was extracted for: two shells showed different
  // headline numbers for one wallet because only one counted these.
  it("counts everything tracked in the headline, pending, immature and frozen included", () => {
    const b = balance({
      confirmed: 1000,
      trusted_pending: 200,
      untrusted_pending: 30,
      immature: 4,
      frozen: 50_000,
    });
    expect(headlineSat(b)).toBe(51_234);
  });

  it("counts only unconfirmed money as pending", () => {
    expect(
      pendingSat(balance({ confirmed: 1000, trusted_pending: 200, untrusted_pending: 30 })),
    ).toBe(230);
  });

  it("reads zero everywhere for an empty wallet", () => {
    const b = balance({});
    expect([headlineSat(b), pendingSat(b)]).toEqual([0, 0]);
  });
});
