import { addressError, addressLooksValid } from "../../address";
import { formatAmount, parseAmount, type Unit } from "../../amount";
import { api } from "../../api";
import { navigate } from "../../router";
import { session } from "../../session";
import { errorMessage, type FeeEstimate, rateForTarget, type TxPreview } from "../../types";
import { banner, el, formatNumber, kv, sectionLabel, textInput } from "../../ui/dom";
import { body, button, card, chips, header, labelled, lede, row, spacer, withBusy } from "../ui";

interface Prefill {
  address?: string;
  amountSat?: number;
}

/** Set by the Scan screen and by a `bitcoin:` deep link before navigating here. */
let prefill: Prefill = {};

export function prefillSend(next: Prefill): void {
  prefill = next;
}

type FeeChoice = "1" | "3" | "6" | "custom";

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

  // --- fields -----------------------------------------------------------
  const address = textInput({
    value: taken.address ?? "",
    placeholder: "bc1 / tb1 address",
    mono: true,
    name: "address",
  });
  address.setAttribute("autocapitalize", "none");
  address.setAttribute("autocorrect", "off");
  const addressErr = el("span", { className: "m-err", attrs: { role: "status" } });

  const amount = textInput({
    value: taken.amountSat !== undefined ? String(taken.amountSat) : "",
    placeholder: "0",
    mono: true,
    name: "amount",
  });
  amount.setAttribute("inputmode", "decimal");
  const amountErr = el("span", { className: "m-err", attrs: { role: "status" } });

  /** A field only shows its error once the user has left it. */
  const touched = { address: taken.address !== undefined, amount: taken.amountSat !== undefined };

  let currentUnit: Unit = "sat";
  const unit = chips<Unit>(
    [
      { value: "sat", label: "sat" },
      { value: "btc", label: "BTC" },
    ],
    currentUnit,
    (next) => {
      // Convert the shown value instead of reinterpreting it; keep whole sats.
      const parsed = parseAmount(amount.value, currentUnit);
      currentUnit = next;
      if (parsed.sats !== null) amount.value = formatAmount(parsed.sats, next);
      refresh();
    },
    { label: "Amount unit" },
  );

  // --- Max is a mode ------------------------------------------------------
  //
  // Tapping it asks the core to build a drain to the address, so the amount
  // that appears is exactly what will leave. Editing the amount, the rate or
  // the address leaves the mode; the stale preview is discarded.
  let drain: TxPreview | null = null;
  const maxNote = el("span", { className: "hint" });
  const max = el("button", {
    className: "m-chip m-chip-max",
    text: "Max",
    attrs: { type: "button", "aria-pressed": "false" },
  }) as HTMLButtonElement;

  const leaveDrain = (): void => {
    if (!drain) return;
    void api.discardTx(drain.psbt_id);
    drain = null;
    max.setAttribute("aria-pressed", "false");
    maxNote.textContent = "";
  };

  const fillMax = async (): Promise<void> => {
    alert.hide();
    const to = address.value.trim();
    const bad = to
      ? addressError(to, info.network)
      : "Enter the address first — the exact amount depends on it.";
    touched.address = true;
    refresh();
    if (bad) return alert.show("error", bad);
    try {
      leaveDrain();
      const preview = await api.buildDrain(to, rate);
      drain = preview;
      amount.value = formatAmount(preview.total_out_sat, currentUnit);
      touched.amount = true;
      max.setAttribute("aria-pressed", "true");
      maxNote.textContent = `Everything: ${formatNumber(preview.total_out_sat + preview.fee_sat)} sat minus the ${formatNumber(preview.fee_sat)} sat fee. Edit the amount to leave Max.`;
      refresh();
    } catch (e) {
      alert.show("error", errorMessage(e));
    }
  };
  max.addEventListener("click", () => void withBusy(max, fillMax));

  // --- fee -----------------------------------------------------------------
  const rateInput = textInput({ value: "1", type: "number", mono: true, name: "rate" });
  rateInput.min = "1";
  rateInput.step = "0.1";
  rateInput.setAttribute("inputmode", "decimal");
  const customRow = el("div", { className: "m-rate-row" }, [
    rateInput,
    el("span", { className: "m-rate-unit", text: "sat/vB · floor 1" }),
  ]);
  customRow.hidden = true;
  const rateNote = el("span", { className: "m-txmeta", text: "Fetching fee estimate…" });
  let estimate: FeeEstimate | null = null;
  let rate = 1;

  const fee = chips<FeeChoice>(
    [
      { value: "1", label: "1 block" },
      { value: "3", label: "3 blocks" },
      { value: "6", label: "6 blocks" },
      { value: "custom", label: "Custom" },
    ],
    "3",
    (choice) => {
      customRow.hidden = choice !== "custom";
      if (choice === "custom") rateInput.value = String(rate);
      leaveDrain();
      void refreshRate();
    },
    { tight: true, label: "Fee target" },
  );

  async function refreshRate(): Promise<void> {
    if (fee.value() === "custom") {
      const typed = Number(rateInput.value);
      rate = Number.isFinite(typed) && typed >= 1 ? typed : 1;
      rateNote.textContent = `${rate.toFixed(1)} sat/vB · your rate`;
      return;
    }
    try {
      estimate ??= await api.estimateFee();
      rate = rateForTarget(estimate, Number(fee.value())) ?? 1;
      rateNote.textContent = `${rate.toFixed(2)} sat/vB`;
    } catch (e) {
      rateNote.textContent = `Using 1 sat/vB — ${errorMessage(e)}`;
      rate = 1;
    }
  }
  rateInput.addEventListener("input", () => {
    leaveDrain();
    void refreshRate();
  });

  // --- validation -----------------------------------------------------------
  const setError = (slot: HTMLElement, input: HTMLInputElement, message: string | null) => {
    slot.textContent = message ?? "";
    input.classList.toggle("input-invalid", message !== null);
    if (message === null) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  };

  const refresh = (): void => {
    setError(
      addressErr,
      address,
      touched.address ? addressError(address.value, info.network) : null,
    );
    setError(
      amountErr,
      amount,
      touched.amount ? parseAmount(amount.value, currentUnit).error : null,
    );
    review.disabled =
      !addressLooksValid(address.value, info.network) ||
      parseAmount(amount.value, currentUnit).sats === null;
  };

  address.addEventListener("input", () => {
    leaveDrain();
    if (touched.address) refresh();
    else review.disabled = true;
  });
  address.addEventListener("blur", () => {
    touched.address = true;
    refresh();
  });
  amount.addEventListener("input", () => {
    leaveDrain();
    if (touched.amount) refresh();
    else review.disabled = true;
  });
  amount.addEventListener("blur", () => {
    touched.amount = true;
    refresh();
  });

  // --- review -----------------------------------------------------------------
  const reviewHost = el("div");

  const review = button(
    "Review",
    () =>
      withBusy(review, async () => {
        alert.hide();
        touched.address = true;
        touched.amount = true;
        refresh();
        const to = address.value.trim();
        const parsed = parseAmount(amount.value, currentUnit);
        if (addressError(to, info.network) || parsed.sats === null) return;
        try {
          // In Max mode the preview already exists and is exactly the amount shown.
          const preview =
            drain ?? (await api.buildTransfer([{ address: to, amount_sat: parsed.sats }], rate));
          showPreview(preview, preview.total_out_sat);
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
            drain = null;
            session.lastResult = await api.signAndBroadcast(preview.psbt_id);
            navigate("result");
          } catch (e) {
            alert.show("error", errorMessage(e));
          }
        }),
      { variant: "primary", block: true },
    );

    const sheet = card(
      sectionLabel("Review"),
      kv([
        ["Amount", `${formatNumber(sats)} sat`],
        ["Fee", `${formatNumber(preview.fee_sat)} sat · ${formatNumber(preview.vsize)} vB`],
        ["Change", `${formatNumber(preview.change_sat)} sat`],
        ["Total", `${formatNumber(sats + preview.fee_sat)} sat`],
      ]),
      confirm,
      button(
        "Cancel",
        () => {
          if (preview !== drain) void api.discardTx(preview.psbt_id);
          reviewHost.replaceChildren();
        },
        { variant: "quiet" },
      ),
    );
    sheet.classList.add("m-confirm-neutral");
    reviewHost.replaceChildren(sheet);
    sheet.scrollIntoView({ block: "nearest" });
  }

  const scan = button("", () => navigate("scan"), {
    icon: "scan",
    ariaLabel: "Scan a QR code",
    square: true,
  });

  host.appendChild(header("Send", { back: "dashboard" }));
  host.appendChild(
    body(
      alert.node,
      card(labelled("To", address), row(address, scan), addressErr),
      card(labelled("Amount", amount), row(amount, unit.node, max), amountErr, maxNote),
      card(sectionLabel("Fee"), fee.node, customRow, rateNote),
      reviewHost,
      spacer(),
      review,
      taken.address ? lede("Address filled in from a scan.") : null,
    ),
  );

  refresh();
  void refreshRate();
  return host;
}
