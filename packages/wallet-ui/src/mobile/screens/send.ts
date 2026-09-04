import { api } from "../../api";
import { navigate } from "../../router";
import { session } from "../../session";
import {
  type Balance,
  errorMessage,
  type FeeEstimate,
  rateForTarget,
  type TxPreview,
} from "../../types";
import { banner, el, formatNumber, kv, sectionLabel, textInput } from "../../ui/dom";
import { body, button, card, chips, header, lede, row, spacer, withBusy } from "../ui";

/** Rough vsize of a one-in one-out P2WPKH spend, for the Max estimate only. */
const TYPICAL_VSIZE = 141;

interface Prefill {
  address?: string;
  amountSat?: number;
}

/** Set by the Scan screen and by a `bitcoin:` deep link before navigating here. */
let prefill: Prefill = {};

export function prefillSend(next: Prefill): void {
  prefill = next;
}

function spendable(b: Balance): number {
  return b.confirmed + b.trusted_pending;
}

export function renderSend(): HTMLElement {
  const info = session.wallet;
  const host = el("main");
  if (!info) {
    navigate("setup");
    return host;
  }

  const alert = banner();
  const taken = prefill;
  prefill = {};

  const address = textInput({
    value: taken.address ?? "",
    placeholder: "bc1 / tb1 address",
    mono: true,
    name: "address",
  });
  address.setAttribute("autocapitalize", "none");
  address.setAttribute("autocorrect", "off");

  const amount = textInput({
    value: taken.amountSat !== undefined ? String(taken.amountSat) : "",
    placeholder: "0",
    mono: true,
    name: "amount",
  });
  amount.setAttribute("inputmode", "decimal");

  const unit = chips(
    [
      { value: "sat", label: "sat" },
      { value: "btc", label: "BTC" },
    ],
    "sat",
  );

  const target = chips(
    [
      { value: "1", label: "1 block" },
      { value: "3", label: "3 blocks" },
      { value: "6", label: "6 blocks" },
    ],
    "3",
    () => void refreshRate(),
  );

  const rateNote = el("span", { className: "m-txmeta", text: "Fetching fee estimate…" });
  let estimate: FeeEstimate | null = null;
  let rate = 1;

  async function refreshRate(): Promise<void> {
    try {
      estimate ??= await api.estimateFee();
      rate = rateForTarget(estimate, Number(target.value())) ?? 1;
      rateNote.textContent = `${rate.toFixed(2)} sat/vB`;
    } catch (e) {
      rateNote.textContent = `Using 1 sat/vB — ${errorMessage(e)}`;
      rate = 1;
    }
  }

  function amountSat(): number {
    const raw = Number(amount.value.trim());
    if (!Number.isFinite(raw) || raw <= 0) return Number.NaN;
    return unit.value() === "btc" ? Math.round(raw * 1e8) : Math.round(raw);
  }

  const max = el("button", {
    className: "m-chip",
    text: "Max",
    attrs: { type: "button" },
    on: {
      click: async () => {
        try {
          const balance = await api.getBalance();
          const fee = Math.ceil(TYPICAL_VSIZE * rate);
          const most = Math.max(0, spendable(balance) - fee);
          amount.value = unit.value() === "btc" ? (most / 1e8).toFixed(8) : String(most);
        } catch (e) {
          alert.show("warn", errorMessage(e));
        }
      },
    },
  });

  const form = card(
    sectionLabel("To"),
    row(
      address,
      button("", () => navigate("scan"), { icon: "scan" }),
    ),
    sectionLabel("Amount"),
    row(amount, unit.node, max),
    sectionLabel("Fee"),
    target.node,
    rateNote,
  );

  const reviewHost = el("div");

  const review = button(
    "Review",
    () =>
      withBusy(review, async () => {
        alert.hide();
        const sats = amountSat();
        if (!address.value.trim()) return alert.show("error", "Enter an address to send to.");
        if (Number.isNaN(sats)) return alert.show("error", "Enter an amount greater than zero.");
        try {
          const preview = await api.buildTransfer(
            [{ address: address.value.trim(), amount_sat: sats }],
            rate,
          );
          showPreview(preview, sats);
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    { variant: "primary", block: true },
  );

  function showPreview(preview: TxPreview, sats: number): void {
    const confirm = button(
      "Confirm and send",
      () =>
        withBusy(confirm, async () => {
          try {
            session.lastResult = await api.signAndBroadcast(preview.psbt_id);
            navigate("result");
          } catch (e) {
            alert.show("error", errorMessage(e));
          }
        }),
      { variant: "primary", block: true },
    );

    reviewHost.replaceChildren(
      card(
        sectionLabel("Review"),
        kv([
          ["Amount", `${formatNumber(sats)} sat`],
          ["Fee", `${formatNumber(preview.fee_sat)} sat`],
          ["Total", `${formatNumber(sats + preview.fee_sat)} sat`],
          ["Size", `${formatNumber(preview.vsize)} vB`],
        ]),
        confirm,
        button(
          "Cancel",
          () => {
            void api.discardTx(preview.psbt_id);
            reviewHost.replaceChildren();
          },
          { variant: "quiet" },
        ),
      ),
    );
  }

  host.appendChild(header("Send", { back: "dashboard" }));
  host.appendChild(
    body(
      alert.node,
      form,
      reviewHost,
      spacer(),
      review,
      taken.address ? lede("Address filled in from a scan.") : null,
    ),
  );

  void refreshRate();
  return host;
}
