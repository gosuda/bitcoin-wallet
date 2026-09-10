import { addressError, addressLooksValid } from "../../address";
import { formatAmount, parseAmount, type Unit } from "../../amount";
import { api } from "../../api";
import { navigate } from "../../router";
import { screenGuard } from "../../screen";
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
  const onScreen = screenGuard();
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
  /**
   * See the desktop Send screen: `drain` is null while a build is in flight,
   * so it cannot be the thing that invalidates one. This can, and must —
   * the confirm sheet does not repeat the recipient, so a stale drain would
   * be broadcast with nothing on screen contradicting it.
   */
  let drainSeq = 0;
  const maxNote = el("span", { className: "hint" });
  const max = el("button", {
    className: "m-chip m-chip-max",
    text: "Max",
    attrs: { type: "button", "aria-pressed": "false" },
  }) as HTMLButtonElement;

  const leaveDrain = (): void => {
    drainSeq += 1;
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
      // Max moves the form on from whatever it was about to send, exactly as
      // an edit does. Every edit says so through `clearPreview`; this was the
      // one control that did not, so a visible sheet stayed confirmable while
      // the amount beside it changed to the drained one.
      clearPreview();
      leaveDrain();
      const seq = drainSeq;
      const preview = await api.buildDrain(to, rate);
      if (seq !== drainSeq) {
        void api.discardTx(preview.psbt_id);
        return;
      }
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
      clearPreview();
      leaveDrain();
      void refreshRate();
    },
    { tight: true, label: "Fee target" },
  );

  async function refreshRate(): Promise<void> {
    const choice = fee.value();
    const before = rate;
    if (choice === "custom") {
      const typed = Number(rateInput.value);
      rate = Number.isFinite(typed) && typed >= 1 ? typed : 1;
      rateNote.textContent = `${rate.toFixed(1)} sat/vB · your rate`;
    } else {
      try {
        estimate ??= await api.estimateFee();
        // The target can change — including to Custom — while the estimate is
        // in flight. `Number("custom")` is NaN, so applying it afterwards
        // silently built at 1 sat/vB while the field showed the typed rate.
        if (fee.value() !== choice) return;
        rate = rateForTarget(estimate, Number(choice)) ?? 1;
        rateNote.textContent = `${rate.toFixed(2)} sat/vB`;
      } catch (e) {
        if (fee.value() !== choice) return;
        rateNote.textContent = `Using 1 sat/vB — ${errorMessage(e)}`;
        rate = 1;
      }
    }
    // A Max preview is built at one rate. Changing it afterwards would leave
    // Review showing the new rate and broadcasting the old one.
    if (rate !== before) leaveDrain();
  }
  rateInput.addEventListener("input", () => {
    clearPreview();
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

  /**
   * `touched` decides only whether a field may show its message. Review
   * follows the values: a form filled in correctly is ready whether or not
   * focus has left the last field.
   */
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
    clearPreview();
    leaveDrain();
    refresh();
  });
  address.addEventListener("blur", () => {
    touched.address = true;
    refresh();
  });
  amount.addEventListener("input", () => {
    clearPreview();
    leaveDrain();
    refresh();
  });
  amount.addEventListener("blur", () => {
    touched.amount = true;
    refresh();
  });

  // --- review -----------------------------------------------------------------
  const reviewHost = el("div");

  /**
   * The preview the visible Review sheet was built from.
   *
   * Its Confirm closes over one PSBT, so leaving the sheet up after an edit
   * means Confirm sends what the form used to say: the old amount in ordinary
   * mode, and in Max mode a PSBT the edit already discarded, which comes back
   * as an expired preview. Any edit therefore takes the sheet down with it.
   */
  let pendingPreview: TxPreview | null = null;

  /**
   * Bumped whenever the form moves on from a preview.
   *
   * `pendingPreview` cannot do this job alone: it is still null while a build
   * is in flight, so an edit during one clears nothing and the result installs
   * regardless — the same shape as the Max race, on the ordinary path.
   */
  let formSeq = 0;

  /** Call before `leaveDrain`, so a preview that *is* the drain is discarded once. */
  const clearPreview = (): void => {
    formSeq += 1;
    if (pendingPreview && pendingPreview !== drain) void api.discardTx(pendingPreview.psbt_id);
    pendingPreview = null;
    reviewHost.replaceChildren();
  };

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
          const seq = formSeq;
          // In Max mode the preview already exists and is exactly the amount shown.
          const preview =
            drain ?? (await api.buildTransfer([{ address: to, amount_sat: parsed.sats }], rate));
          if (seq !== formSeq || !onScreen()) {
            // The form changed or the screen went away while this was building.
            // Showing it would offer the previous recipient and amount; keeping
            // it would strand the PSBT with nothing left to reclaim it.
            if (preview !== drain) void api.discardTx(preview.psbt_id);
            return;
          }
          showPreview(preview, preview.total_out_sat);
        } catch (e) {
          if (onScreen()) alert.show("error", errorMessage(e));
        }
      }),
    { variant: "primary", block: true },
  );

  function showPreview(preview: TxPreview, sats: number): void {
    pendingPreview = preview;
    const confirm = button(
      "Confirm and send",
      () =>
        withBusy(confirm, async () => {
          try {
            // Consumed by the broadcast either way, so neither may be
            // discarded again on the way out.
            drain = null;
            pendingPreview = null;
            session.lastResult = await api.signAndBroadcast(preview.psbt_id);
            navigate("result");
          } catch (e) {
            // Signing consumed the PSBT before it failed, so the mounted
            // Confirm would retry an id the core no longer has. Take the sheet
            // down and make them review the current form again.
            clearPreview();
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
      button("Cancel", clearPreview, { variant: "quiet" }),
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

  // Screens are rebuilt on every navigation, so anything still pending when
  // this one goes away is unreachable — abandoned sends would grow the core's
  // pending map without bound.
  const discardOnLeave = (): void => {
    clearPreview();
    leaveDrain();
    window.removeEventListener("hashchange", discardOnLeave);
  };
  window.addEventListener("hashchange", discardOnLeave);

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
