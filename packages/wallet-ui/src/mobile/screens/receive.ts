import QRCode from "qrcode";

import { api } from "../../api";
import { navigate } from "../../router";
import { session } from "../../session";
import { errorMessage } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el } from "../../ui/dom";
import { body, button, card, header, lede, row, spacer } from "../ui";

/**
 * What goes in the QR.
 *
 * Bech32 is case-insensitive and BIP173 prefers upper case in QR codes, which
 * lets the encoder pick alphanumeric mode instead of byte mode. Measured on a
 * 42-character address that is not actually smaller — both land on version 3,
 * 29 modules — so the gain is spare capacity within the same size rather than
 * a tighter code; it would start to matter for a longer BIP21 payload.
 *
 * The load-bearing part is the prefix test. Base58 addresses are
 * case-*sensitive*, so upper-casing one would produce a QR that scans cleanly
 * and pays nobody.
 */
function qrPayload(address: string): string {
  return /^(bc1|tb1|bcrt1)/i.test(address) ? address.toUpperCase() : address;
}

export function renderReceive(): HTMLElement {
  const info = session.wallet;
  const host = el("main");
  if (!info) {
    navigate("setup");
    return host;
  }

  const alert = banner();
  let address = info.address;

  const canvas = el("canvas") as HTMLCanvasElement;
  const qr = el("div", { className: "m-qr" }, [canvas]);
  const text = el("p", { className: "m-address", text: address });
  const caption = el("span", { className: "m-txmeta", text: "" });

  const paint = async (): Promise<void> => {
    text.textContent = address;
    try {
      await QRCode.toCanvas(canvas, qrPayload(address), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
        color: { dark: "#1a1a1aff", light: "#ffffffff" },
      });
    } catch (e) {
      alert.show("warn", errorMessage(e));
    }
  };

  const fresh = button(
    "New address",
    async () => {
      alert.hide();
      try {
        address = await api.newAddress();
        caption.textContent = "Fresh, unused address";
        await paint();
      } catch (e) {
        alert.show("error", errorMessage(e));
      }
    },
    { icon: "plus" },
  );

  host.appendChild(header("Receive", { back: "dashboard" }));
  host.appendChild(
    body(
      alert.node,
      card(qr, text, caption),
      row(
        copyButton(() => address),
        info.is_hd ? fresh : null,
      ),
      info.is_hd ? null : lede("A single-key wallet has one address; every payment reuses it."),
      spacer(),
    ),
  );

  void paint();
  return host;
}
