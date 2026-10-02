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

/**
 * A rate as a fee field is prefilled with, on both shells: rounded up to a
 * tenth so it can be typed, and no lower than the relay minimum the core
 * builds at anyway. A note showing the raw estimate below that would name a
 * rate the transaction does not pay.
 */
export function typeableRate(rateSatPerVb: number): number {
  // An estimate arrives with float noise, 18.900000000000002 for 18.9, which
  // rounded up to 19.0. Six decimals keep every fraction a rate has; the
  // core's own minimums are 0.004 sat/vB apart.
  const tenths = Math.round(rateSatPerVb * 1e6) / 1e5;
  return Math.max(1, Math.ceil(tenths) / 10);
}

/**
 * A space that does not break. A time is one phrase, and so is each part of a
 * fee line: a row that wraps beside a wide amount put "Today" on one line and
 * "07:44" on the next, and a phone's review broke "141 vB" in two.
 */
const NBSP = "\u00a0";

/** A count and what it counts, grouped as the device groups numbers: "1 input", "1,204 inputs". */
export function counted(count: number, word: string): string {
  return `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;
}

/** A transaction's size in virtual bytes: "141 vB". */
export function formatVsize(vbytes: number): string {
  return `${formatNumber(vbytes)} vB`;
}

/**
 * What a transaction pays, as every screen that describes one writes it:
 * "141 sat · 1.0 sat/vB · 141 vB". The rate is worked out from the fee and
 * the size when it is not given, and a part that is not known is left out.
 * Where it wraps, it breaks only after a "·".
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
    .map((part) => part.replace(/ /g, NBSP))
    .join(`${NBSP}· `);
}

/**
 * Where a transaction stands, for a list or a detail: "Pending" until it is
 * in a block, then "1 confirmation", "12 confirmations". Pending means the
 * core reports no count; a count is never 0.
 */
export function formatConfirmations(confirmations: number | null): string {
  if (confirmations === null) return "Pending";
  return confirmations === 1 ? "1 confirmation" : `${formatNumber(confirmations)} confirmations`;
}

/** The same where a row is tight, as a coin's is: "Pending", "12 conf.". */
export function formatConf(confirmations: number | null): string {
  return confirmations === null ? "Pending" : `${formatNumber(confirmations)} conf.`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** How `formatTime` writes a clock time; `formatDateTime` writes it the same way. */
const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

/**
 * A clock time, "14:02": the 24-hour clock the boards use, with no seconds.
 * A 12-hour time comes out in the device's words ("오후 2:02" on a Korean
 * device), which beside the app's English "Today" reads as two languages.
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, CLOCK);
}

/**
 * When something happened, for a list: "just now", "12 min ago", then
 * "Today 14:02", then a date, "Aug 27", with the year only when it is not
 * this one. `timestamp` is in seconds, as the core reports it.
 */
export function formatWhen(timestamp: number, now: Date = new Date()): string {
  return whenWords(new Date(timestamp * 1000), now).replace(/ /g, NBSP);
}

function whenWords(date: Date, now: Date): string {
  const age = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (date.toDateString() === now.toDateString()) return `Today ${formatTime(date)}`;
  return date.toLocaleDateString(undefined, dayOf(date, now));
}

/**
 * When a transaction happened, in its detail: "Aug 27, 14:02", on the same
 * clock as `formatTime`, and with the year when it is not this one, as the
 * list says it.
 */
export function formatDateTime(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, { ...dayOf(date, now), ...CLOCK });
}

/** How a list writes the day of `date`, "Aug 27": the year only when it is not this one. */
function dayOf(date: Date, now: Date): Intl.DateTimeFormatOptions {
  return { month: "short", day: "numeric", ...(sameYear(date, now) ? {} : { year: "numeric" }) };
}

/**
 * Whether two dates fall in one year as the device's calendar counts them,
 * the calendar its dates are written in: a Persian year does not begin on
 * January 1, so comparing Gregorian years left out a year that differs.
 */
function sameYear(a: Date, b: Date): boolean {
  const year = new Intl.DateTimeFormat(undefined, { year: "numeric" });
  return year.format(a) === year.format(b);
}
