/**
 * Amounts as the user types them.
 *
 * Sats are the wallet's only unit; BTC is a display convention with exactly
 * eight decimals. Everything here is integer arithmetic: `Number("0.1") * 1e8`
 * is 10000000.000000002, and a wallet that rounds is a wallet that is off by a
 * sat. Both shells parse through this so they agree on what "1e5" means (an
 * error, not a hundred thousand).
 */

export const SATS_PER_BTC = 100_000_000;

/** Amount unit of a field. Sats are the internal representation. */
export type Unit = "sat" | "btc";

/** A parsed amount, or the reason it is not one. Empty text is neither. */
export interface AmountParse {
  sats: number | null;
  error: string | null;
}

const NOT_A_NUMBER = "Enter an amount, digits only.";
const NOT_POSITIVE = "Amount must be more than 0 sat.";

/** Text in `unit` as whole sats. */
export function parseAmount(raw: string, unit: Unit): AmountParse {
  const text = raw.trim();
  if (!text) return { sats: null, error: null };
  if (unit === "sat") {
    if (!/^\d+$/.test(text)) return { sats: null, error: "Enter a whole number of sats." };
    const sats = Number(text);
    if (!Number.isSafeInteger(sats)) return { sats: null, error: "Amount is too large." };
    return sats > 0 ? { sats, error: null } : { sats: null, error: NOT_POSITIVE };
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return { sats: null, error: NOT_A_NUMBER };
  const whole = match[1] ?? "";
  const frac = match[2] ?? "";
  if (!whole && !frac) return { sats: null, error: NOT_A_NUMBER };
  if (frac.length > 8) {
    return { sats: null, error: "BTC has 8 decimals at most — 1 sat is 0.00000001." };
  }
  const sats = Number(whole || "0") * SATS_PER_BTC + Number(frac.padEnd(8, "0"));
  if (!Number.isSafeInteger(sats)) return { sats: null, error: "Amount is too large." };
  return sats > 0 ? { sats, error: null } : { sats: null, error: NOT_POSITIVE };
}

/** Whole sats as field text: plain digits, or BTC with up to 8 decimals. */
export function formatAmount(sats: number, unit: Unit): string {
  if (unit === "sat") return String(sats);
  const whole = Math.floor(sats / SATS_PER_BTC);
  const frac = String(sats - whole * SATS_PER_BTC)
    .padStart(8, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
