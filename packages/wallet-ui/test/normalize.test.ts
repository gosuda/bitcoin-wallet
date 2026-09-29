import { describe, expect, it } from "vitest";
import {
  toFeeEstimate,
  toPublicDescriptors,
  toTxDetail,
  toTxSummary,
  toUtxo,
} from "../src/wasm/normalize";

// What `serde-wasm-bindgen` produces with the binding's default serializer:
// a `serde_json` object becomes a `Map` (the fee estimate is one), a struct
// becomes a plain object, and `None` becomes `undefined`.

describe("toFeeEstimate", () => {
  it("flattens the nested Maps the core sends", () => {
    const raw = new Map([
      [
        "sat_per_vb_by_target",
        new Map([
          ["1", 12.5],
          ["6", 4],
        ]),
      ],
    ]);
    expect(toFeeEstimate(raw)).toEqual({ sat_per_vb_by_target: { "1": 12.5, "6": 4 } });
  });

  it("takes the plain-object shape too", () => {
    const raw = { sat_per_vb_by_target: { "3": 7 } };
    expect(toFeeEstimate(raw)).toEqual({ sat_per_vb_by_target: { "3": 7 } });
  });

  it("reads a missing table as no estimates, not an error", () => {
    expect(toFeeEstimate(new Map())).toEqual({ sat_per_vb_by_target: {} });
    expect(toFeeEstimate({})).toEqual({ sat_per_vb_by_target: {} });
  });
});

describe("toUtxo", () => {
  // The bug from 2026-09-28: an unconfirmed output rendered "undefined".
  it("turns a missing confirmation count into null", () => {
    const raw = { txid: "ab", vout: 1, value: 1000, confirmations: undefined, address: "tb1q" };
    expect(toUtxo(raw)).toEqual({
      txid: "ab",
      vout: 1,
      value: 1000,
      confirmations: null,
      address: "tb1q",
    });
  });

  it("keeps a real count, and reads a Map row the same way", () => {
    const raw = new Map<string, unknown>([
      ["txid", "cd"],
      ["vout", 0],
      ["value", 2500],
      ["confirmations", 3],
      ["address", "tb1p"],
    ]);
    expect(toUtxo(raw).confirmations).toBe(3);
    expect(toUtxo(raw).value).toBe(2500);
  });
});

describe("toTxSummary", () => {
  it("turns every absent optional into null", () => {
    const raw = {
      txid: "ef",
      net_sat: -1200,
      sent_sat: 5000,
      received_sat: 3800,
      fee_sat: undefined,
      confirmations: undefined,
      timestamp: undefined,
    };
    expect(toTxSummary(raw)).toEqual({
      txid: "ef",
      net_sat: -1200,
      sent_sat: 5000,
      received_sat: 3800,
      fee_sat: null,
      confirmations: null,
      timestamp: null,
    });
  });
});

describe("toTxDetail", () => {
  it("normalizes the rows inside as well as the transaction", () => {
    const raw = {
      txid: "01",
      net_sat: -700,
      sent_sat: 10000,
      received_sat: 9300,
      fee_sat: 200,
      fee_rate_sat_vb: 1.4,
      confirmations: undefined,
      block_height: undefined,
      timestamp: undefined,
      vsize: 141,
      inputs: [{ txid: "aa", vout: 0, value_sat: undefined, ours: true }],
      outputs: [
        { address: "tb1qpay", value_sat: 500, ours: false },
        { address: undefined, value_sat: 9300, ours: true },
      ],
    };
    const detail = toTxDetail(raw);
    expect(detail.confirmations).toBeNull();
    expect(detail.block_height).toBeNull();
    expect(detail.fee_sat).toBe(200);
    expect(detail.inputs).toEqual([{ txid: "aa", vout: 0, value_sat: null, ours: true }]);
    expect(detail.outputs).toEqual([
      { address: "tb1qpay", value_sat: 500, ours: false },
      { address: null, value_sat: 9300, ours: true },
    ]);
  });
});

describe("toPublicDescriptors", () => {
  it("gives a single key's missing halves as null", () => {
    const raw = {
      external: "wpkh(02ab)",
      internal: undefined,
      account_xpub: undefined,
      fingerprint: undefined,
    };
    expect(toPublicDescriptors(raw)).toEqual({
      external: "wpkh(02ab)",
      internal: null,
      account_xpub: null,
      fingerprint: null,
    });
  });
});
