import { describe, expect, it } from "vitest";
import { feeRateError, MAX_FEE_RATE_SAT_VB } from "../src/types";

describe("feeRateError", () => {
  it("accepts ordinary rates, including the ceiling itself", () => {
    for (const rate of [1, 0.1, 2.5, 141, MAX_FEE_RATE_SAT_VB]) {
      expect(feeRateError(rate)).toBeNull();
    }
  });

  // The defect this guards: a typed rate reached `build_transfer` unchecked
  // above, so a misplaced decimal or a unit mix-up (sat/vkB for sat/vB) was
  // sent to the core as-is instead of being caught where it was typed.
  it("refuses anything past the ceiling", () => {
    for (const rate of [MAX_FEE_RATE_SAT_VB + 0.01, 1e5, 1e30]) {
      expect(feeRateError(rate)).not.toBeNull();
    }
  });

  it("refuses non-finite and non-positive values", () => {
    for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0]) {
      expect(feeRateError(rate)).not.toBeNull();
    }
  });
});
