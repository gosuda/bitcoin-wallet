import { describe, expect, it } from "vitest";
import { headlineSat, pendingSat } from "../src/balance";
import type { Balance } from "../src/types";

const balance = (b: Partial<Balance>): Balance => ({
  confirmed: 0,
  trusted_pending: 0,
  untrusted_pending: 0,
  immature: 0,
  ...b,
});

describe("balance rules", () => {
  // The defect this module was extracted for: two shells showed different
  // headline numbers for one wallet because only one counted these.
  it("counts everything tracked in the headline, pending and immature included", () => {
    const b = balance({
      confirmed: 1000,
      trusted_pending: 200,
      untrusted_pending: 30,
      immature: 4,
    });
    expect(headlineSat(b)).toBe(1234);
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
