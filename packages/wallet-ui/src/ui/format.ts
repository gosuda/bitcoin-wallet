/**
 * How values are written on screen, the same on both shells: the display
 * standard of Round 7 (docs/ROADMAP.md). Screens format through here, so a
 * rule is changed in one place and cannot drift between the shells again.
 */

import type { CoinId } from "../types";

/*
 * Numbers on screen follow the device's locale, as dates already did. Text
 * put into an amount field does not: `formatAmount` writes plain digits and
 * a `.`, which is what the field reads back.
 */
const numberFormat = new Intl.NumberFormat();
const decimalSign =
  numberFormat.formatToParts(0.5).find((part) => part.type === "decimal")?.value ?? ".";
/** The eight digits after a BTC point, in the device's numerals (٠٠٠٠٠٠٠١ in Arabic). */
const satDigits = new Intl.NumberFormat(undefined, { minimumIntegerDigits: 8, useGrouping: false });

/** An integer grouped the way the device writes numbers; no unit. */
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function formatSats(sats: number): string {
  return `${formatNumber(sats)} sat`;
}

/**
 * A balance in BTC with all 8 decimals, in the device's separators. Integer
 * math, so exact for any sat count; balances are never negative.
 */
export function formatBtc(sats: number): string {
  const whole = Math.floor(sats / 1e8);
  return `${formatNumber(whole)}${decimalSign}${satDigits.format(sats - whole * 1e8)} BTC`;
}

/**
 * An id shortened for a list or a summary: its first 10 and last 8
 * characters around "…", enough to tell two apart at a glance. Used for a
 * txid, an outpoint's txid, and an address in a list or a summary.
 *
 * An address is written whole wherever a payment or an output is reviewed or
 * described — Send's review, a transaction's detail, Import PSBT — so it is
 * never shortened there.
 */
export function shortId(id: string): string {
  // Anything this short would come out no shorter.
  return id.length <= 19 ? id : `${id.slice(0, 10)}…${id.slice(-8)}`;
}

/** An outpoint for a list: its txid shortened, then the output's index. */
export function shortOutpoint(coin: CoinId): string {
  return `${shortId(coin.txid)}:${coin.vout}`;
}

/**
 * What an output is to this wallet: someone else's, change on a spend of this
 * wallet's, or a payment to it. `owner` is the transaction or PSBT the output
 * belongs to, whose net effect tells change from a receipt.
 */
export function outputRole(
  owner: { net_sat: number },
  output: { ours: boolean },
): "recipient" | "change" | "ours" {
  if (!output.ours) return "recipient";
  return owner.net_sat < 0 ? "change" : "ours";
}

/**
 * A fee rate as the screens write it, with one decimal: "2.0 sat/vB". A rate
 * is typed back into a field with a ".", so it keeps one on every device.
 */
export function formatRate(satPerVb: number): string {
  return `${satPerVb.toFixed(1)} sat/vB`;
}

/** A transaction's size in virtual bytes: "141 vB". */
export function formatVsize(vbytes: number): string {
  return `${formatNumber(vbytes)} vB`;
}

/**
 * What a transaction pays, as every screen that describes one writes it:
 * "141 sat · 1.0 sat/vB · 141 vB". The rate is worked out from the fee and
 * the size when it is not given, and a part that is not known is left out.
 */
export function feeLine(
  feeSat: number | null,
  vsize: number | null,
  rateSatPerVb?: number | null,
): string {
  const rate = rateSatPerVb ?? (feeSat !== null && vsize ? feeSat / vsize : null);
  return [
    feeSat === null ? null : formatSats(feeSat),
    rate === null ? null : formatRate(rate),
    vsize === null ? null : formatVsize(vsize),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
