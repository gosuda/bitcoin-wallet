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
  const address = decodeURIComponent(addressPart).trim();
  if (address === "") return null;

  const out: PaymentRequest = { address };
  const params = new URLSearchParams(queryPart);

  const amount = params.get("amount");
  if (amount !== null) {
    const btc = Number(amount);
    // BIP21 amounts are in BTC; satoshis are the only unit the wallet takes.
    if (Number.isFinite(btc) && btc > 0) out.amountSat = Math.round(btc * 1e8);
  }

  const label = params.get("label") ?? params.get("message");
  if (label !== null && label !== "") out.label = label;

  return out;
}
