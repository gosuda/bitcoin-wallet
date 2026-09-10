import { describe, expect, it } from "vitest";
import { isBumpable, suggestBumpRate } from "../src/feebump";
import { rateForTarget, type TxSummary } from "../src/types";

const tx = (t: Partial<TxSummary>): TxSummary => ({
  txid: "a".repeat(64),
  net_sat: -1000,
  sent_sat: 2000,
  received_sat: 1000,
  fee_sat: 100,
  confirmations: null,
  timestamp: null,
  ...t,
});

describe("isBumpable", () => {
  it("takes our own unconfirmed send", () => {
    expect(isBumpable(tx({ confirmations: null, net_sat: -1000 }))).toBe(true);
  });

  // Replacing a confirmed transaction is impossible; offering it is a lie.
  it("refuses anything already mined, however shallowly", () => {
    expect(isBumpable(tx({ confirmations: 1 }))).toBe(false);
    expect(isBumpable(tx({ confirmations: 0 }))).toBe(false);
  });

  // We cannot replace what we did not author.
  it("refuses an incoming payment even while unconfirmed", () => {
    expect(isBumpable(tx({ confirmations: null, net_sat: 1000 }))).toBe(false);
    expect(isBumpable(tx({ confirmations: null, net_sat: 0 }))).toBe(false);
  });
});

describe("suggestBumpRate", () => {
  it("falls back to the relay minimum with no estimate", () => {
    expect(suggestBumpRate(null)).toBe(1);
    expect(suggestBumpRate({ sat_per_vb_by_target: {} })).toBe(1);
  });

  it("asks the 1-block rate when the original's is unknown", () => {
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 12.3, "6": 2 } })).toBe(12.3);
  });

  // Outbidding is two comparisons. When fees have fallen since the original
  // send, the market rate is below the rate being replaced, and offering it
  // makes the node refuse the replacement — the bump fails on first press.
  it("clears the original's rate when the market has fallen below it", () => {
    const estimate = { sat_per_vb_by_target: { "1": 12.3 } };
    expect(suggestBumpRate(estimate, 20)).toBe(21);
    expect(suggestBumpRate(null, 20)).toBe(21);
  });

  it("asks the market rate when it already beats the original", () => {
    const estimate = { sat_per_vb_by_target: { "1": 30 } };
    expect(suggestBumpRate(estimate, 20)).toBe(30);
  });

  it("ignores an unusable original rate", () => {
    const estimate = { sat_per_vb_by_target: { "1": 12.3 } };
    for (const bad of [null, undefined, 0, -5, Number.NaN]) {
      expect(suggestBumpRate(estimate, bad), String(bad)).toBe(12.3);
    }
  });

  it("never goes below the relay minimum", () => {
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 0.5 } })).toBe(1);
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 0 } })).toBe(1);
  });

  it("rounds up to a tenth so the value is typeable", () => {
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 4.966 } })).toBe(5);
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 2.01 } })).toBe(2.1);
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 3 } })).toBe(3);
  });

  // A real backend (bitcoin-rs, gosuda/bitcoin-rs#669) serves the relay
  // minimum as 1.0000000000000002 because it converts BTC/kvB in two steps.
  // Rounding up is correct for a bump, so that ULP becomes a 10% overpay —
  // this pins the behaviour so the cost of such a backend stays visible.
  it("shows what a backend's float noise costs at the floor", () => {
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 1.0000000000000002 } })).toBe(1.1);
    expect(suggestBumpRate({ sat_per_vb_by_target: { "1": 1 } })).toBe(1);
  });
});

describe("rateForTarget", () => {
  const estimate = { sat_per_vb_by_target: { "1": 10, "6": 4, "144": 1 } };

  it("prefers an exact target", () => {
    expect(rateForTarget(estimate, 6)).toBe(4);
  });

  // Overpaying beats underpaying: with no exact match, take the faster rate.
  it("falls back to the nearest faster target", () => {
    expect(rateForTarget(estimate, 3)).toBe(10);
    expect(rateForTarget(estimate, 100)).toBe(4);
  });

  it("falls back to a slower target only when nothing is faster", () => {
    expect(rateForTarget({ sat_per_vb_by_target: { "6": 4 } }, 1)).toBe(4);
  });

  it("has no answer without estimates", () => {
    expect(rateForTarget({ sat_per_vb_by_target: {} }, 6)).toBeNull();
  });

  it("ignores keys that are not targets", () => {
    expect(rateForTarget({ sat_per_vb_by_target: { abc: 99, "6": 4 } }, 6)).toBe(4);
  });
});
