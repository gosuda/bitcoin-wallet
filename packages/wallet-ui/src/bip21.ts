/**
 * BIP21 `bitcoin:` URIs, which is what both a QR scan and a deep link hand us.
 *
 * Deliberately permissive about the input and strict about the output: a QR may
 * hold a bare address, a URI, or a URI with parameters we do not implement, and
 * in every case the useful answer is the address plus an amount if one is
 * there. Anything unparseable returns null rather than throwing, because the
 * caller's job is to prefill a form, not to validate — the wallet core rejects
 * a bad address far more authoritatively than a regex could.
 */

import { formatAmount, parseAmount } from "./amount";

export interface PaymentRequest {
  address: string;
  /** Whole satoshis, when the URI carried an `amount` in BTC. */
  amountSat?: number;
  label?: string;
}

export function parsePaymentUri(input: string): PaymentRequest | null {
  const text = input.trim();
  if (text === "") return null;

  if (!/^bitcoin:/i.test(text)) {
    // A bare address. Reject anything with URI or whitespace shape so a stray
    // scan of some other QR does not silently become a payee.
    return /^[A-Za-z0-9]{14,90}$/.test(text) ? { address: text } : null;
  }

  // Not using `new URL`: `bitcoin:` is not hierarchical, so browsers park the
  // whole payload in `pathname` and the query handling differs between engines.
  const rest = text.slice("bitcoin:".length);
  const [addressPart = "", queryPart = ""] = rest.split("?", 2);
  // `decodeURIComponent` throws on a malformed escape — "bitcoin:%" is enough.
  // This function promises null instead, and a throw here also aborted the
  // deep-link handler's map before it could reach a later valid URL.
  let address: string;
  try {
    address = decodeURIComponent(addressPart).trim();
  } catch {
    return null;
  }
  if (address === "") return null;

  const params = new URLSearchParams(queryPart);

  // BIP21: a `req-` parameter we do not implement invalidates the whole URI.
  // Honouring only the keys we know would strip a condition the payer made
  // mandatory and show the payment as an ordinary transfer.
  for (const key of params.keys()) {
    // Case-sensitive on purpose: BIP21 spells the required prefix "req-", and
    // query keys are not case-folded. "REQ-Foo" is therefore an unknown
    // *optional* parameter, which the spec says to ignore — rejecting it
    // turned a usable payment link into a dead one.
    if (key.startsWith("req-")) return null;
  }

  const out: PaymentRequest = { address };

  const amount = params.get("amount");
  if (amount !== null) {
    // Parsed, not coerced. `Number` would read "1e-3" as 0.001 BTC and round
    // "0.000000009" up to a satoshi the payer never asked for; BIP21 amounts
    // are plain decimal BTC with at most eight places.
    // `parseAmount` trims what the user types; a URI's amount is not trimmed.
    const sats = amount === amount.trim() ? parseAmount(amount, "btc").sats : null;
    if (sats !== null) out.amountSat = sats;
  }

  const label = params.get("label") ?? params.get("message");
  if (label !== null && label !== "") out.label = label;

  return out;
}

/** The inverse of `parsePaymentUri`: what a Receive screen encodes. */
export function buildPaymentUri(request: PaymentRequest): string {
  const params = new URLSearchParams();
  if (request.amountSat !== undefined && request.amountSat > 0) {
    params.set("amount", formatAmount(request.amountSat, "btc"));
  }
  if (request.label) params.set("label", request.label);
  const query = params.toString();
  return `bitcoin:${request.address}${query ? `?${query}` : ""}`;
}

/**
 * What goes in a QR.
 *
 * A bare bech32 address is upper-cased: BIP173 prefers it in QR codes and it
 * is case-insensitive, so nothing is lost. Measured on a 42-character address
 * the code is no smaller — version 3 either way — so this is convention, not a
 * win. A URI is left alone: its parameters are not case-insensitive, and an
 * upper-cased label would arrive changed. Base58 is case-*sensitive*; upper-
 * casing one would produce a QR that scans cleanly and pays nobody, which is
 * the load-bearing branch here.
 */
export function qrPayload(text: string): string {
  return /^(bc1|tb1|bcrt1)[a-z0-9]+$/i.test(text) ? text.toUpperCase() : text;
}
