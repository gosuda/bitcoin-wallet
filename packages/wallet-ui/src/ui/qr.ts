/**
 * QR codes as both shells draw them, dark modules on a light quiet zone at the
 * width each screen gives, and what Receive puts in one.
 */

import QRCode from "qrcode";
import { parseAmount, type Unit } from "../amount";
import { buildPaymentUri, qrPayload } from "../bip21";
import { errorMessage } from "../types";
import { type Banner, setFieldError } from "./dom";

/** Draws `text` on `canvas`, `width` pixels across; a failure is said in `alert`. */
export async function drawQr(
  canvas: HTMLCanvasElement,
  text: string,
  width: number,
  alert: Banner,
): Promise<void> {
  try {
    await QRCode.toCanvas(canvas, text, {
      errorCorrectionLevel: "M",
      margin: 1,
      width,
      color: { dark: "#1a1a1aff", light: "#ffffffff" },
    });
  } catch (e) {
    alert.show("warn", errorMessage(e));
  }
}

/**
 * What Receive shares: the bare `address`, or a bitcoin: URI once `amount`
 * holds one in `unit`. Why the amount is not one is said in `error`.
 */
export function receivePayload(
  address: string,
  amount: HTMLInputElement,
  unit: Unit,
  error: HTMLElement,
): string {
  const parsed = parseAmount(amount.value, unit);
  setFieldError(error, amount, parsed.error);
  return parsed.sats === null ? address : buildPaymentUri({ address, amountSat: parsed.sats });
}

/** Receive's QR of `share`, named for what it holds, with a URI written out in `caption`. */
export function drawReceiveQr(
  canvas: HTMLCanvasElement,
  caption: HTMLElement,
  address: string,
  share: string,
  width: number,
  alert: Banner,
): Promise<void> {
  caption.textContent = share === address ? "" : share;
  canvas.setAttribute(
    "aria-label",
    share === address ? "QR code of the receiving address" : "QR code of the payment request",
  );
  return drawQr(canvas, qrPayload(share), width, alert);
}
