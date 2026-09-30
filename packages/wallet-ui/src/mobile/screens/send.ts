import { addressError, addressLooksValid } from "../../address";
import { formatAmount, parseAmount, type Unit } from "../../amount";
import { api } from "../../api";
import { type PaymentRequest, parsePaymentUri } from "../../bip21";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { screenGuard } from "../../screen";
import { session } from "../../session";
import {
  DEFAULT_FEE_TARGET,
  errorMessage,
  FEE_TARGETS,
  type FeeEstimate,
  type FeeTarget,
  feeRateError,
  MAX_FEE_RATE_SAT_VB,
  NETWORK_LABELS,
  type Recipient,
  rateForTarget,
  type TxPreview,
} from "../../types";
import { heldTo, LET_WALLET_CHOOSE, payingFrom, takeChosenCoins } from "../../ui/coins";
import { banner, el, kv, sectionLabel, textInput } from "../../ui/dom";
import { feeLine, formatRate, formatSats, typeableRate } from "../../ui/format";
import { icon } from "../../ui/icons";
import { estimateUnavailable, FETCHING_ESTIMATE, FLOOR_NOTE, maxModeNote } from "../../ui/text";
import {
  body,
  button,
  card,
  chips,
  header,
  labelled,
  lede,
  reticle,
  row,
  seeThroughMark,
  spacer,
  withBusy,
} from "../ui";

interface Prefill {
  address?: string;
  amountSat?: number;
}

/** Set by the Scan screen and by a `bitcoin:` deep link before navigating here. */
let prefill: Prefill = {};

export function prefillSend(next: Prefill): void {
  prefill = next;
}

type FeeChoice = `${FeeTarget}` | "custom";

const UNIT_LABELS: Record<Unit, string> = { sat: "sat", btc: "BTC" };

/** One recipient's fields, whichever cards they are laid out in. */
interface RecipientRow {
  address: HTMLInputElement;
  amount: HTMLInputElement;
  addressErr: HTMLElement;
  amountErr: HTMLElement;
  /** The unit inside the amount field, for when the chips are not beside it. */
  unitMark: HTMLElement;
  /** Null where this build has no camera. */
  scan: HTMLButtonElement | null;
  /** A field only shows its error once the user has left it. */
  touched: { address: boolean; amount: boolean };
}

/** A send to several, reviewed: every recipient, then the fee and the total. */
function recipientList(to: readonly Recipient[], fee: string, total: number): HTMLElement {
  const list = el("dl", { className: "m-review" });
  for (const r of to) {
    list.append(
      el("dt", { className: "m-review-to", text: r.address }),
      el("dd", { text: `${formatSats(r.amount_sat)}` }),
    );
  }
  list.append(
    el("dt", { text: "Fee" }),
    el("dd", { text: fee }),
    el("dt", { className: "m-review-total", text: "Total" }),
    el("dd", { className: "m-review-total", text: `${formatSats(total)}` }),
  );
  return list;
}

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
  const scanQr = platform().scanQr;
  /**
   * The coins ticked on Coins when Send selected opened this, or null. The
   * send spends exactly those, Max included, until Let the wallet choose
   * drops them; leaving this screen drops them too.
   */
  let coins = takeChosenCoins();

  // --- recipients -----------------------------------------------------------
  //
  // A lone recipient keeps the To and Amount cards, with the unit and Max
  // beside the amount. Several get a card each and share one unit, chosen
  // below the cards; Max spends everything, so only a lone recipient has it.
  const rows: RecipientRow[] = [];
  const recipientsBox = el("div", { className: "m-recipients" });
  const unitLine = el("div", { className: "m-unit-line" });

  let currentUnit: Unit = "sat";
  const unit = chips<Unit>(
    [
      { value: "sat", label: "sat" },
      { value: "btc", label: "BTC" },
    ],
    currentUnit,
    (next) => {
      if (next === currentUnit) return;
      // Convert the shown values instead of reinterpreting them; keep whole
      // sats. A value that does not parse stays as typed: its message says why.
      for (const r of rows) {
        const parsed = parseAmount(r.amount.value, currentUnit);
        if (parsed.sats !== null) r.amount.value = formatAmount(parsed.sats, next);
        r.unitMark.textContent = UNIT_LABELS[next];
      }
      currentUnit = next;
      refresh();
    },
    { label: "Amount unit" },
  );

  // --- Max is a mode ------------------------------------------------------
  //
  // Tapping it asks the core to build a drain to the address, so the amount
  // that appears is exactly what will leave. Editing the amount, the rate or
  // the address leaves the mode; the stale preview is discarded. Adding a
  // recipient leaves it too: everything can only go to one address.
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
  });

  const leaveDrain = (): void => {
    drainSeq += 1;
    if (!drain) return;
    void api.discardTx(drain.psbt_id);
    drain = null;
    max.setAttribute("aria-pressed", "false");
    maxNote.textContent = "";
  };

  const fillMax = async (): Promise<void> => {
    // Max is only drawn beside a lone recipient; several have no one address
    // for everything to go to.
    const only = rows.length === 1 ? rows[0] : undefined;
    if (!only) return;
    alert.hide();
    const to = only.address.value.trim();
    const bad = to
      ? addressError(to, info.network)
      : "Enter the address first — the exact amount depends on it.";
    only.touched.address = true;
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
      const preview = await api.buildDrain(to, rate, heldTo(coins));
      if (seq !== drainSeq) {
        void api.discardTx(preview.psbt_id);
        return;
      }
      drain = preview;
      only.amount.value = formatAmount(preview.total_out_sat, currentUnit);
      only.touched.amount = true;
      max.setAttribute("aria-pressed", "true");
      maxNote.textContent = maxModeNote(preview.total_out_sat + preview.fee_sat, preview.fee_sat);
      refresh();
    } catch (e) {
      alert.show("error", errorMessage(e));
    }
  };
  max.addEventListener("click", () => void withBusy(max, fillMax));

  // --- fee -----------------------------------------------------------------
  const rateInput = textInput({ value: "1", type: "number", mono: true, name: "rate" });
  rateInput.min = "1";
  rateInput.max = String(MAX_FEE_RATE_SAT_VB);
  rateInput.step = "0.1";
  rateInput.setAttribute("inputmode", "decimal");
  const customRow = el("div", { className: "m-rate-row" }, [
    rateInput,
    el("span", { className: "m-rate-unit", text: "sat/vB" }),
  ]);
  customRow.hidden = true;
  const rateErr = el("span", { className: "m-err", attrs: { role: "status" } });
  const rateNote = el("span", { className: "m-txmeta", text: FETCHING_ESTIMATE });
  let estimate: FeeEstimate | null = null;
  let rate = 1;

  const fee = chips<FeeChoice>(
    [
      ...FEE_TARGETS.map((t) => ({
        value: `${t}` as FeeChoice,
        label: `${t} block${t > 1 ? "s" : ""}`,
      })),
      { value: "custom", label: "Custom" },
    ],
    `${DEFAULT_FEE_TARGET}`,
    (choice) => {
      customRow.hidden = choice !== "custom";
      if (choice === "custom") rateInput.value = String(rate);
      clearPreview();
      leaveDrain();
      void refreshRate();
      refresh();
    },
    { tight: true, label: "Fee target" },
  );

  async function refreshRate(): Promise<void> {
    const choice = fee.value();
    const before = rate;
    if (choice === "custom") {
      const typed = Number(rateInput.value);
      rate = Number.isFinite(typed) && typed >= 1 ? typed : 1;
      rateNote.textContent = `Custom rate · ${FLOOR_NOTE}`;
    } else {
      try {
        estimate ??= await api.estimateFee();
        // The target can change — including to Custom — while the estimate is
        // in flight. `Number("custom")` is NaN, so applying it afterwards
        // silently built at 1 sat/vB while the field showed the typed rate.
        // The screen can also have changed while it was in flight.
        if (fee.value() !== choice || !onScreen()) return;
        // Rounded and floored as the desktop's field is: the raw estimate can be
        // below the 1 sat/vB the core builds at, and the note would name a rate
        // the transaction does not pay.
        const market = rateForTarget(estimate, Number(choice));
        rate = typeableRate(market ?? 1);
        // An estimate with no rate in it is none: say so, as the desktop does.
        rateNote.textContent = market === null ? estimateUnavailable(rate) : formatRate(rate);
      } catch (_e) {
        if (fee.value() !== choice || !onScreen()) return;
        rateNote.textContent = estimateUnavailable(1);
        rate = 1;
      }
    }
    if (rate !== before) {
      // A Max preview is built at one rate; changing it afterwards would
      // leave Review showing the new rate and broadcasting the old one.
      leaveDrain();
      // The caller's own `refresh()` right after calling this ran against
      // the rate from before this estimate arrived. Re-validate now that
      // `rate` itself changed, so an implausible estimate disables Review
      // instead of leaving it clickable until the build rejects it.
      refresh();
    }
  }
  rateInput.addEventListener("input", () => {
    clearPreview();
    leaveDrain();
    void refreshRate();
    refresh();
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
  /**
   * Custom validates what was typed, so a bad keystroke is flagged before
   * `rate` ever changes. A preset has no typed value to check — but its
   * estimate still becomes `rate`, and a backend that returns something
   * non-finite or past the ceiling must not sail through unchecked just
   * because a person did not type it.
   */
  const rateError = (): string | null =>
    fee.value() === "custom" ? feeRateError(Number(rateInput.value)) : feeRateError(rate);

  /** What Review would send, or null while any row is incomplete or wrong. */
  const recipients = (): Recipient[] | null => {
    const out: Recipient[] = [];
    for (const r of rows) {
      const address = r.address.value.trim();
      const sats = parseAmount(r.amount.value, currentUnit).sats;
      if (!addressLooksValid(address, info.network) || sats === null) return null;
      out.push({ address, amount_sat: sats });
    }
    return out;
  };

  const refresh = (): void => {
    for (const r of rows) {
      setError(
        r.addressErr,
        r.address,
        r.touched.address ? addressError(r.address.value, info.network) : null,
      );
      setError(
        r.amountErr,
        r.amount,
        r.touched.amount ? parseAmount(r.amount.value, currentUnit).error : null,
      );
    }
    setError(rateErr, rateInput, rateError());
    review.disabled = recipients() === null || rateError() !== null;
  };

  // --- rows -----------------------------------------------------------------

  /** Any edit moves the form on from what Review or Max built for it. */
  const edited = (): void => {
    clearPreview();
    leaveDrain();
    refresh();
  };

  // No board draws this: which coins pay, and the way back to letting the
  // wallet choose them, laid out as the Add recipient line is.
  const coinsLine = coins
    ? el("div", { className: "m-coins-line" }, [
        el("span", { className: "m-txmeta", text: payingFrom(coins) }),
        button(LET_WALLET_CHOOSE, () => {
          coins = null;
          coinsLine?.remove();
          // What Review or Max built was held to those coins.
          edited();
        }),
      ])
    : null;

  const newRow = (from: Prefill): RecipientRow => {
    const address = textInput({
      value: from.address ?? "",
      placeholder: `${NETWORK_LABELS[info.network]} address`,
      mono: true,
      name: "address",
    });
    address.setAttribute("autocapitalize", "none");
    address.setAttribute("autocorrect", "off");
    const amount = textInput({
      value: from.amountSat !== undefined ? formatAmount(from.amountSat, currentUnit) : "",
      placeholder: "0",
      mono: true,
      name: "amount",
    });
    amount.setAttribute("inputmode", "decimal");
    const r: RecipientRow = {
      address,
      amount,
      addressErr: el("span", { className: "m-err", attrs: { role: "status" } }),
      amountErr: el("span", { className: "m-err", attrs: { role: "status" } }),
      unitMark: el("span", {
        className: "m-amount-unit",
        text: UNIT_LABELS[currentUnit],
        attrs: { "aria-hidden": "true" },
      }),
      scan: null,
      touched: { address: from.address !== undefined, amount: from.amountSat !== undefined },
    };
    if (scanQr) {
      r.scan = button("", () => void scanFor(r), {
        icon: "scan",
        ariaLabel: "Scan a QR code",
        square: true,
      });
    }
    address.addEventListener("input", edited);
    address.addEventListener("blur", () => {
      r.touched.address = true;
      refresh();
    });
    amount.addEventListener("input", edited);
    amount.addEventListener("blur", () => {
      r.touched.amount = true;
      refresh();
    });
    return r;
  };

  /** A recipient among several, as a card of its own. */
  const cardFor = (r: RecipientRow, n: number): HTMLElement => {
    const name = `Recipient ${n}`;
    r.address.setAttribute("aria-label", `${name} address`);
    r.amount.setAttribute("aria-label", `${name} amount`);
    const removeLabel = `Remove recipient ${n}`;
    const remove = el(
      "button",
      {
        className: "m-icon-btn m-recipient-remove",
        attrs: { type: "button", "aria-label": removeLabel, title: removeLabel },
        on: { click: () => removeRecipient(r) },
      },
      [icon("x", 18)],
    );
    const node = card(
      el("div", { className: "m-recipient-head" }, [sectionLabel(name), remove]),
      row(r.address, r.scan),
      r.addressErr,
      el("div", { className: "m-amount-field" }, [r.amount, r.unitMark]),
      r.amountErr,
    );
    node.classList.add("m-recipient");
    return node;
  };

  /** Lays the rows out for how many there are: Max beside a lone one, a × on each of several. */
  const layout = (): void => {
    const only = rows.length === 1 ? rows[0] : undefined;
    if (only) {
      // A card's names would override the To and Amount labels.
      only.address.removeAttribute("aria-label");
      only.amount.removeAttribute("aria-label");
      recipientsBox.replaceChildren(
        card(labelled("Address", only.address), row(only.address, only.scan), only.addressErr),
        card(
          labelled("Amount", only.amount),
          row(only.amount, unit.node, max),
          only.amountErr,
          maxNote,
        ),
      );
      unitLine.replaceChildren();
      return;
    }
    recipientsBox.replaceChildren(...rows.map((r, i) => cardFor(r, i + 1)));
    unitLine.replaceChildren(el("span", { className: "hint", text: "Amounts in" }), unit.node);
  };

  const addRecipient = (): void => {
    // Review would now build for other recipients, and Max needs a lone one.
    clearPreview();
    leaveDrain();
    rows.push(newRow({}));
    layout();
    refresh();
  };

  const removeRecipient = (r: RecipientRow): void => {
    const i = rows.indexOf(r);
    if (i < 0 || rows.length === 1) return;
    clearPreview();
    leaveDrain();
    rows.splice(i, 1);
    layout();
    refresh();
  };

  const addLine = el("div", { className: "m-add-line" }, [
    button("Add recipient", addRecipient, { icon: "plus" }),
    unitLine,
  ]);

  // --- scanning ---------------------------------------------------------------
  //
  // The camera runs on this screen rather than on Scan, which would rebuild
  // this one and lose every row. While it runs the form steps aside for what
  // Scan shows: a reticle over a page turned see-through.
  const mark = seeThroughMark();
  /** Stops the camera and turns the page solid again; null while none runs. */
  let stopScan: (() => void) | null = null;
  const scanner = body(
    el("div", { className: "m-scan" }, [
      reticle(),
      lede("Point the camera at an address or a bitcoin: QR code."),
    ]),
    button("Stop scanning", () => stopScan?.(), { block: true }),
  );
  const scanNote = lede("Address filled in from a scan.");

  /**
   * Where a scanned payment goes: the last row without an address, so a scan
   * overwrites nothing while a row is still empty. With none empty it
   * replaces the address beside the scan button pressed, as a lone row
   * always has.
   */
  const scanTarget = (pressed: RecipientRow): RecipientRow => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r && r.address.value.trim() === "") return r;
    }
    return pressed;
  };

  const fillFromScan = (r: RecipientRow, payment: PaymentRequest): void => {
    clearPreview();
    leaveDrain();
    r.address.value = payment.address;
    r.touched.address = true;
    // A code without an amount leaves the one typed alone.
    if (payment.amountSat !== undefined) {
      r.amount.value = formatAmount(payment.amountSat, currentUnit);
      r.touched.amount = true;
    }
    refresh();
    if (!scanNote.isConnected) form.appendChild(scanNote);
    r.address.scrollIntoView({ block: "nearest" });
  };

  const scanFor = async (pressed: RecipientRow): Promise<void> => {
    if (!scanQr || stopScan) return;
    alert.hide();
    const camera = new AbortController();
    const stop = (): void => {
      camera.abort();
      mark.clear();
    };
    stopScan = stop;
    // Taking the form out of the page scrolls it back to the top.
    const scrolled = form.scrollTop;
    mark.set();
    host.classList.add("m-scanner");
    host.replaceChildren(scanHead, scanner);
    let text: string | null = null;
    try {
      text = await scanQr(camera.signal);
    } catch (e) {
      if (onScreen()) alert.show("error", errorMessage(e));
    }
    stop();
    stopScan = null;
    host.classList.remove("m-scanner");
    host.replaceChildren(head, form);
    form.scrollTop = scrolled;
    // Null is a cancel, not a failure: say nothing.
    if (text === null || !onScreen()) return;
    const payment = parsePaymentUri(text);
    if (payment) fillFromScan(scanTarget(pressed), payment);
    else alert.show("warn", "That QR code is not a Bitcoin address.");
  };

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
        for (const r of rows) {
          r.touched.address = true;
          r.touched.amount = true;
        }
        refresh();
        const to = recipients();
        if (to === null) return;
        try {
          const seq = formSeq;
          // In Max mode the preview already exists and is exactly the amount shown.
          const preview = drain ?? (await api.buildTransfer(to, rate, heldTo(coins)));
          if (seq !== formSeq || !onScreen()) {
            // The form changed or the screen went away while this was building.
            // Showing it would offer the previous recipients and amounts;
            // keeping it would strand the PSBT with nothing left to reclaim it.
            if (preview !== drain) void api.discardTx(preview.psbt_id);
            return;
          }
          showPreview(preview, to);
        } catch (e) {
          if (onScreen()) alert.show("error", errorMessage(e));
        }
      }),
    { variant: "primary", block: true },
  );

  function showPreview(preview: TxPreview, to: readonly Recipient[]): void {
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

    const total = preview.total_out_sat + preview.fee_sat;
    const feeText = feeLine(preview.fee_sat, preview.vsize);
    const sheet = card(
      sectionLabel("Review"),
      to.length === 1
        ? kv([
            ["Amount", `${formatSats(preview.total_out_sat)}`],
            ["Fee", feeText],
            ["Change", `${formatSats(preview.change_sat)}`],
            ["Total", `${formatSats(total)}`],
          ])
        : recipientList(to, feeText, total),
      confirm,
      button("Edit", clearPreview, { variant: "quiet" }),
    );
    sheet.classList.add("m-confirm-neutral");
    reviewHost.replaceChildren(sheet);
    sheet.scrollIntoView({ block: "nearest" });
  }

  // Screens are rebuilt on every navigation, so anything still pending when
  // this one goes away is unreachable — abandoned sends would grow the core's
  // pending map without bound. The camera, which has no way out of its own,
  // stops with the screen.
  const discardOnLeave = (): void => {
    stopScan?.();
    clearPreview();
    leaveDrain();
    window.removeEventListener("hashchange", discardOnLeave);
  };
  window.addEventListener("hashchange", discardOnLeave);

  const head = header("Send", { back: "dashboard" });
  const scanHead = header("Scan");
  const form = body(
    alert.node,
    coinsLine,
    recipientsBox,
    addLine,
    card(sectionLabel("Fee"), fee.node, customRow, rateErr, rateNote),
    reviewHost,
    spacer(),
    review,
    taken.address ? scanNote : null,
  );
  host.append(head, form);

  rows.push(newRow(taken));
  layout();
  refresh();
  void refreshRate();
  return host;
}
