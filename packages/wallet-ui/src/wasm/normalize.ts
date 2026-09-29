/**
 * The shapes `serde-wasm-bindgen` hands back, turned into the app's types.
 *
 * Two mismatches are handled here: a Rust map arrives as a JS `Map` where the
 * app expects a plain object, and a Rust `None` arrives as `undefined` where
 * the app's types say `null`. Nothing here touches the WebAssembly module, so
 * these run, and are tested, without it.
 */

import type {
  FeeEstimate,
  PublicDescriptors,
  TxDetail,
  TxInput,
  TxOutput,
  TxSummary,
  Utxo,
} from "../types";

/** `sat_per_vb_by_target` arrives as a nested `Map`; flatten it to a record. */
export function toFeeEstimate(raw: unknown): FeeEstimate {
  const outer =
    raw instanceof Map
      ? raw.get("sat_per_vb_by_target")
      : (raw as { sat_per_vb_by_target?: unknown }).sat_per_vb_by_target;
  const entries =
    outer instanceof Map
      ? [...outer.entries()]
      : outer && typeof outer === "object"
        ? Object.entries(outer)
        : [];
  const byTarget: Record<string, number> = {};
  for (const [target, rate] of entries) byTarget[String(target)] = Number(rate);
  return { sat_per_vb_by_target: byTarget };
}

/** Field access over either shape serde-wasm-bindgen may hand back. */
function reader(raw: unknown): (key: string) => unknown {
  return (key) => (raw instanceof Map ? raw.get(key) : (raw as Record<string, unknown>)[key]);
}

/** `None` crosses as `undefined`; the UI contract is `null`. */
function optionalNumber(value: unknown): number | null {
  return value === undefined || value === null ? null : Number(value);
}

function optionalString(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

/** An unspent output. */
export function toUtxo(raw: unknown): Utxo {
  const read = reader(raw);
  return {
    txid: String(read("txid")),
    vout: Number(read("vout")),
    value: Number(read("value")),
    confirmations: optionalNumber(read("confirmations")),
    address: String(read("address")),
    frozen: read("frozen") === true,
  };
}

/** A history row. */
export function toTxSummary(raw: unknown): TxSummary {
  const read = reader(raw);
  return {
    txid: String(read("txid")),
    net_sat: Number(read("net_sat")),
    sent_sat: Number(read("sent_sat")),
    received_sat: Number(read("received_sat")),
    fee_sat: optionalNumber(read("fee_sat")),
    confirmations: optionalNumber(read("confirmations")),
    timestamp: optionalNumber(read("timestamp")),
  };
}

export function toTxDetail(raw: unknown): TxDetail {
  const read = reader(raw);
  const inputs = (read("inputs") as unknown[]).map((i): TxInput => {
    const r = reader(i);
    return {
      txid: String(r("txid")),
      vout: Number(r("vout")),
      value_sat: optionalNumber(r("value_sat")),
      ours: Boolean(r("ours")),
    };
  });
  const outputs = (read("outputs") as unknown[]).map((o): TxOutput => {
    const r = reader(o);
    return {
      address: optionalString(r("address")),
      value_sat: Number(r("value_sat")),
      ours: Boolean(r("ours")),
    };
  });
  return {
    txid: String(read("txid")),
    net_sat: Number(read("net_sat")),
    sent_sat: Number(read("sent_sat")),
    received_sat: Number(read("received_sat")),
    fee_sat: optionalNumber(read("fee_sat")),
    fee_rate_sat_vb: optionalNumber(read("fee_rate_sat_vb")),
    confirmations: optionalNumber(read("confirmations")),
    block_height: optionalNumber(read("block_height")),
    timestamp: optionalNumber(read("timestamp")),
    vsize: Number(read("vsize")),
    inputs,
    outputs,
  };
}

export function toPublicDescriptors(raw: unknown): PublicDescriptors {
  const read = reader(raw);
  return {
    external: String(read("external")),
    internal: optionalString(read("internal")),
    account_xpub: optionalString(read("account_xpub")),
    fingerprint: optionalString(read("fingerprint")),
  };
}
