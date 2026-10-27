import { UNIT_CHOICES, type Unit } from "../../amount";
import { api } from "../../api";
import { redirect, screenGuard } from "../../screen";
import { session } from "../../session";
import { errorMessage } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, convertField, el, textInput } from "../../ui/dom";
import { drawReceiveQr, receivePayload } from "../../ui/qr";
import { RECEIVE_QR_NOTE } from "../../ui/text";
import { body, button, card, chips, header, labelled, lede, row, withLock } from "../ui";

export function renderReceive(): HTMLElement {
  const info = session.wallet;
  if (!info) return redirect("setup");
  const host = el("main");
  const onScreen = screenGuard();

  const alert = banner();
  let address = info.address;

  const canvas = el("canvas", {
    attrs: { role: "img", "aria-label": "QR code of the receiving address" },
  });
  const qr = el("div", { className: "m-qr" }, [canvas]);
  const text = el("p", { className: "m-address", text: address });
  const caption = el("span", { className: "m-uri", text: "" });

  // --- an optional amount turns the address into a payment request ------
  const amount = textInput({ placeholder: "0", mono: true, name: "request_amount" });
  amount.setAttribute("inputmode", "decimal");
  let unitValue: Unit = "sat";
  const unit = chips<Unit>(
    UNIT_CHOICES,
    unitValue,
    (next) => {
      convertField(amount, unitValue, next);
      unitValue = next;
      void paint();
    },
    { label: "Amount unit" },
  );
  const amountErr = el("span", { className: "m-err", attrs: { role: "status" } });

  const payload = (): string => receivePayload(address, amount, unitValue, amountErr);
  const paint = (): Promise<void> => {
    text.textContent = address;
    return drawReceiveQr(canvas, caption, address, payload(), 190, alert);
  };
  amount.addEventListener("input", () => void paint());

  const fresh: HTMLButtonElement = button(
    "New address",
    () =>
      // A second tap while this runs would reveal another address, leaving the first unused.
      withLock(fresh, async () => {
        alert.hide();
        try {
          address = await api.newAddress();
          if (!onScreen()) return;
          await paint();
        } catch (e) {
          if (onScreen()) alert.show("error", errorMessage(e));
        }
      }),
    { icon: "plus" },
  );

  host.appendChild(header("Receive", { back: "dashboard" }));
  host.appendChild(
    body(
      alert.node,
      card(qr, text, caption),
      row(
        copyButton(() => payload()),
        info.is_ranged ? fresh : null,
      ),
      card(
        labelled("Request an amount", amount, "(optional)"),
        row(amount, unit.node),
        amountErr,
        el("span", {
          className: "hint",
          text: RECEIVE_QR_NOTE,
        }),
      ),
      info.is_ranged ? null : lede("A single-key wallet has one address; every payment reuses it."),
    ),
  );

  void paint();
  return host;
}
