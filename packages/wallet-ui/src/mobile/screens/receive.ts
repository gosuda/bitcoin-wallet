import QRCode from "qrcode";

import { formatAmount, parseAmount, type Unit } from "../../amount";
import { api } from "../../api";
import { buildPaymentUri, qrPayload } from "../../bip21";
import { navigate } from "../../router";
import { session } from "../../session";
import { errorMessage } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, textInput } from "../../ui/dom";
import { body, button, card, chips, header, labelled, lede, row } from "../ui";

export function renderReceive(): HTMLElement {
  const info = session.wallet;
  const host = el("main");
  if (!info) {
    navigate("setup");
    return host;
  }

  const alert = banner();
  let address = info.address;

  const canvas = el("canvas", {
    attrs: { role: "img", "aria-label": "QR code of the receiving address" },
  }) as HTMLCanvasElement;
  const qr = el("div", { className: "m-qr" }, [canvas]);
  const text = el("p", { className: "m-address", text: address });
  const caption = el("span", { className: "m-uri", text: "" });

  // --- an optional amount turns the address into a payment request ------
  const amount = textInput({ placeholder: "0", mono: true, name: "request_amount" });
  amount.setAttribute("inputmode", "decimal");
  let unitValue: Unit = "sat";
  const unit = chips<Unit>(
    [
      { value: "sat", label: "sat" },
      { value: "btc", label: "BTC" },
    ],
    unitValue,
    (next) => {
      const parsed = parseAmount(amount.value, unitValue);
      unitValue = next;
      if (parsed.sats !== null) amount.value = formatAmount(parsed.sats, next);
      void paint();
    },
    { label: "Amount unit" },
  );
  const amountErr = el("span", { className: "m-err", attrs: { role: "status" } });

  /** What is shared: the bare address, or a bitcoin: URI once an amount is set. */
  const payload = (): string => {
    const parsed = parseAmount(amount.value, unitValue);
    amountErr.textContent = parsed.error ?? "";
    amount.classList.toggle("input-invalid", parsed.error !== null);
    return parsed.sats === null ? address : buildPaymentUri({ address, amountSat: parsed.sats });
  };

  const paint = async (): Promise<void> => {
    text.textContent = address;
    const share = payload();
    caption.textContent = share === address ? "" : share;
    canvas.setAttribute(
      "aria-label",
      share === address ? "QR code of the receiving address" : "QR code of the payment request",
    );
    try {
      await QRCode.toCanvas(canvas, qrPayload(share), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 190,
        color: { dark: "#1a1a1aff", light: "#ffffffff" },
      });
    } catch (e) {
      alert.show("warn", errorMessage(e));
    }
  };
  amount.addEventListener("input", () => void paint());

  const fresh = button(
    "New address",
    async () => {
      alert.hide();
      try {
        address = await api.newAddress();
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
        copyButton(() => payload()),
        info.is_hd ? fresh : null,
      ),
      card(
        labelled("Request an amount", amount, "(optional)"),
        row(amount, unit.node),
        amountErr,
        el("span", {
          className: "hint",
          text: "The QR becomes a bitcoin: link with the amount filled in.",
        }),
      ),
      info.is_hd ? null : lede("A single-key wallet has one address; every payment reuses it."),
    ),
  );

  void paint();
  return host;
}
