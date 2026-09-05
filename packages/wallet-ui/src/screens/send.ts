import { addressLooksValid } from "../address";
import { formatAmount, parseAmount, type Unit } from "../amount";
import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import {
  backendHost,
  errorMessage,
  type FeeEstimate,
  NETWORK_LABELS,
  type Recipient,
  rateForTarget,
  type TxPreview,
} from "../types";
import {
  banner,
  button,
  el,
  field,
  formatSats,
  iconButton,
  kv,
  radioGroup,
  sectionLabel,
  textInput,
  withBusy,
} from "../ui/dom";

const FEE_TARGETS = [1, 3, 6] as const;

interface RecipientRow {
  node: HTMLElement;
  address: HTMLInputElement;
  amount: HTMLInputElement;
  unit: Unit;
  /** The row's own radio pair, so the form can lock every control it owns. */
  units: HTMLInputElement[];
  remove: HTMLButtonElement;
  max: HTMLButtonElement;
  maxBox: HTMLElement;
  maxHint: HTMLElement;
  addressError: HTMLElement;
  amountError: HTMLElement;
  /** A field only shows its error once the user has left it. */
  touched: { address: boolean; amount: boolean };
}

type FeeTarget = `${(typeof FEE_TARGETS)[number]}`;

const FLOOR_NOTE = "floor 1 sat/vB";
const MAX_HINT = "Max sends everything: the whole balance minus the fee, to this one recipient.";

export function renderSend(): HTMLElement {
  const wallet = session.wallet;
  const cfg = session.config;
  if (!wallet || !cfg) {
    navigate("setup");
    return el("main");
  }
  const host = backendHost(cfg.backend);
  const networkName = NETWORK_LABELS[wallet.network].toLowerCase();

  const alert = banner();
  const rows: RecipientRow[] = [];
  const rowsBox = el("div", { className: "card" });
  let estimate: FeeEstimate | null = null;
  let preview: TxPreview | null = null;
  let formLocked = false;
  /**
   * Max is a mode. Tapping it asks the core to build a drain to the row's
   * address, so the amount that appears is exactly what will leave. Editing
   * the amount, the address or the rate leaves the mode and discards this.
   */
  let drain: TxPreview | null = null;
  let rowSeq = 0;

  const feeRate = textInput({ value: "1", type: "number", mono: true });
  feeRate.min = "1";
  feeRate.step = "0.1";
  feeRate.addEventListener("input", () => {
    leaveDrain();
    feeHint.textContent = `Custom rate · ${FLOOR_NOTE}`;
  });
  const feeHint = el("span", { className: "hint fee-source", text: "Fetching estimate…" });

  /** The rate the form will build at, floored at the relay minimum. */
  const currentRate = (): number => {
    const rate = Number(feeRate.value);
    return Number.isFinite(rate) && rate >= 1 ? rate : 1;
  };

  let targetBlocks: FeeTarget = "6";
  const target = radioGroup(
    "fee_target",
    FEE_TARGETS.map((t) => ({
      value: `${t}` as FeeTarget,
      label: `${t} block${t > 1 ? "s" : ""}`,
    })),
    targetBlocks,
    (v) => {
      targetBlocks = v;
      leaveDrain();
      applyEstimate();
    },
  );
  const targetInputs = (): HTMLInputElement[] => Array.from(target.querySelectorAll("input"));

  const applyEstimate = () => {
    if (!estimate) return;
    const rate = rateForTarget(estimate, Number(targetBlocks));
    if (rate === null) {
      feeHint.textContent = "No estimate available; enter a rate.";
      return;
    }
    const rounded = Math.max(1, Math.ceil(rate * 10) / 10);
    feeRate.value = String(rounded);
    feeHint.textContent = `${host} estimate for ${targetBlocks} block${targetBlocks === "1" ? "" : "s"} · ${FLOOR_NOTE}`;
  };

  const loadEstimate = async () => {
    try {
      estimate = await api.estimateFee();
      applyEstimate();
    } catch (e) {
      feeHint.textContent = `Estimate unavailable: ${errorMessage(e)}`;
    }
  };

  const rowValid = (row: RecipientRow): boolean =>
    addressLooksValid(row.address.value, wallet.network) &&
    parseAmount(row.amount.value, row.unit).sats !== null;

  /** Review is the only gate: it stays off while any row is empty or wrong. */
  const updateReview = () => {
    if (formLocked) return;
    reviewBtn.disabled = rows.length === 0 || rows.some((r) => !rowValid(r));
  };

  const setError = (slot: HTMLElement, input: HTMLInputElement, message: string | null) => {
    slot.textContent = message ?? "";
    slot.classList.toggle("hidden", message === null);
    input.classList.toggle("input-invalid", message !== null);
    if (message === null) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  };

  const renderRowErrors = (row: RecipientRow) => {
    const address = row.address.value.trim();
    // An empty field is incomplete, not wrong: Review stays off without a shout.
    const badAddress =
      row.touched.address && address !== "" && !addressLooksValid(address, wallet.network);
    setError(
      row.addressError,
      row.address,
      badAddress ? `Not a valid ${networkName} address.` : null,
    );
    const amount = parseAmount(row.amount.value, row.unit);
    setError(row.amountError, row.amount, row.touched.amount ? amount.error : null);
  };

  const refreshRow = (row: RecipientRow) => {
    renderRowErrors(row);
    updateReview();
  };

  /** Converts the shown value instead of reinterpreting it; keeps whole sats. */
  const setUnit = (row: RecipientRow, unit: Unit) => {
    if (row.unit === unit) return;
    const parsed = parseAmount(row.amount.value, row.unit);
    row.unit = unit;
    // An unparsable value is left as typed; its message already says why.
    if (parsed.sats !== null) row.amount.value = formatAmount(parsed.sats, unit);
    refreshRow(row);
  };

  const leaveDrain = () => {
    if (!drain) return;
    void api.discardTx(drain.psbt_id);
    drain = null;
    for (const r of rows) {
      r.max.classList.remove("max-on");
      r.maxHint.textContent = MAX_HINT;
    }
    syncRowChrome();
  };

  const fillMax = (row: RecipientRow) =>
    withBusy(row.max, async () => {
      alert.hide();
      const address = row.address.value.trim();
      row.touched.address = true;
      renderRowErrors(row);
      if (!address || !addressLooksValid(address, wallet.network)) {
        alert.show("error", "Enter the address first — the exact amount depends on it.");
        return;
      }
      try {
        leaveDrain();
        const preview = await api.buildDrain(address, currentRate());
        drain = preview;
        row.amount.value = formatAmount(preview.total_out_sat, row.unit);
        row.touched.amount = true;
        row.max.classList.add("max-on");
        row.maxHint.textContent = `Everything: ${formatSats(preview.total_out_sat + preview.fee_sat)} minus the ${formatSats(preview.fee_sat)} fee. Editing the amount leaves Max; Max needs a single recipient.`;
        refreshRow(row);
        syncRowChrome();
      } catch (e) {
        alert.show("error", errorMessage(e));
      }
    });

  const removeRow = (row: RecipientRow) => {
    const i = rows.indexOf(row);
    if (i >= 0) rows.splice(i, 1);
    row.node.remove();
    syncRowChrome();
    updateReview();
  };

  /** One row cannot be removed, and only one row can spend the whole balance. */
  const syncRowChrome = () => {
    const single = rows.length === 1;
    for (const r of rows) {
      r.remove.disabled = single || formLocked;
      r.maxBox.classList.toggle("hidden", !single);
    }
    addBtn.disabled = formLocked || drain !== null;
  };

  const addRow = () => {
    const seq = rowSeq++;
    const address = textInput({ placeholder: `Recipient address (${wallet.network})`, mono: true });
    address.id = `recipient-address-${seq}`;
    const amount = textInput({ placeholder: "0", mono: true });
    amount.id = `recipient-amount-${seq}`;
    amount.classList.add("amount-input");
    amount.setAttribute("inputmode", "decimal");

    const addressError = el("span", { className: "field-error hidden" });
    const amountError = el("span", { className: "field-error hidden" });
    const removeBtn = iconButton("x", "Remove recipient", () => removeRow(row));
    const maxBtn = button("Max", () => fillMax(row), "default", "sm");
    const maxHint = el("span", { className: "hint", text: MAX_HINT });
    const maxBox = el("div", { className: "amount-max" }, [maxBtn, maxHint]);

    const row: RecipientRow = {
      node: el("div", { className: "recipient-row" }),
      address,
      amount,
      unit: "sat",
      units: [],
      remove: removeBtn,
      max: maxBtn,
      maxBox,
      maxHint,
      addressError,
      amountError,
      touched: { address: false, amount: false },
    };

    const unitChip = (unit: Unit, label: string): HTMLLabelElement => {
      const input = el("input", {
        attrs: { type: "radio", name: `recipient-unit-${seq}`, value: unit },
      });
      input.checked = unit === row.unit;
      input.addEventListener("change", () => {
        if (input.checked) setUnit(row, unit);
      });
      row.units.push(input);
      return el("label", { className: "unit-chip" }, [input, el("span", { text: label })]);
    };

    address.addEventListener("input", () => {
      leaveDrain();
      if (row.touched.address) renderRowErrors(row);
      updateReview();
    });
    address.addEventListener("blur", () => {
      row.touched.address = true;
      refreshRow(row);
    });
    amount.addEventListener("input", () => {
      leaveDrain();
      if (row.touched.amount) renderRowErrors(row);
      updateReview();
    });
    amount.addEventListener("blur", () => {
      row.touched.amount = true;
      refreshRow(row);
    });

    row.node.append(
      el("div", { className: "field" }, [
        el("label", { className: "field-label", text: "Address", attrs: { for: address.id } }),
        address,
        addressError,
      ]),
      el("div", { className: "field" }, [
        el("label", { className: "field-label", text: "Amount", attrs: { for: amount.id } }),
        el("div", { className: "amount-row" }, [
          amount,
          el(
            "div",
            { className: "unit-group", attrs: { role: "radiogroup", "aria-label": "Amount unit" } },
            [unitChip("sat", "sat"), unitChip("btc", "BTC")],
          ),
        ]),
        amountError,
        maxBox,
      ]),
      // The empty label keeps the button on the same line as the inputs.
      el("div", { className: "field" }, [
        el("span", { className: "field-label", text: "\u00A0", attrs: { "aria-hidden": "true" } }),
        removeBtn,
      ]),
    );
    rows.push(row);
    rowsBox.appendChild(row.node);
    syncRowChrome();
    updateReview();
  };

  const addBtn = button(
    "Add recipient",
    () => {
      leaveDrain();
      addRow();
    },
    "default",
    "sm",
    { name: "plus" },
  );
  const rowsHead = el("div", { className: "card-head" }, [sectionLabel("Recipients"), addBtn]);
  rowsBox.append(rowsHead);

  const collectRecipients = (): Recipient[] | null => {
    const out: Recipient[] = [];
    for (const r of rows) {
      // Reviewing counts as leaving every field: show what is missing.
      r.touched.address = true;
      r.touched.amount = true;
      renderRowErrors(r);
      const address = r.address.value.trim();
      const sats = parseAmount(r.amount.value, r.unit).sats;
      if (!address || !addressLooksValid(address, wallet.network)) {
        alert.show("error", `Every recipient needs a valid ${networkName} address.`);
        r.address.focus();
        return null;
      }
      if (sats === null) {
        alert.show("error", `Invalid amount for ${address}: whole sats > 0.`);
        r.amount.focus();
        return null;
      }
      out.push({ address, amount_sat: sats });
    }
    return out;
  };

  const previewBox = el("section", { className: "card review-card hidden" });
  const formControls = (): (HTMLInputElement | HTMLButtonElement)[] => [
    ...rows.flatMap((r) => [r.address, r.amount, ...r.units, r.max, r.remove]),
    feeRate,
    ...targetInputs(),
    addBtn,
    reviewBtn,
  ];
  const setFormLocked = (locked: boolean) => {
    formLocked = locked;
    for (const c of formControls()) c.disabled = locked;
    syncRowChrome();
    updateReview();
  };

  const showPreview = (p: TxPreview) => {
    preview = p;
    previewBox.className = "card review-card";
    const confirmBtn = button(
      "Confirm & broadcast",
      () =>
        withBusy(confirmBtn, async () => {
          alert.hide();
          try {
            const result = await api.signAndBroadcast(p.psbt_id);
            preview = null;
            drain = null;
            session.lastResult = result;
            navigate("result");
          } catch (e) {
            preview = null;
            previewBox.className = "card review-card hidden";
            setFormLocked(false);
            alert.show("error", errorMessage(e));
          }
        }),
      "primary",
    );
    const backBtn = button("Edit", () =>
      withBusy(backBtn, async () => {
        try {
          // The Max preview stays alive with the mode; anything else is done with.
          if (p !== drain) await api.discardTx(p.psbt_id);
        } catch {
          // Pending map is best-effort; nothing to surface.
        }
        preview = null;
        previewBox.className = "card review-card hidden";
        setFormLocked(false);
      }),
    );
    const muted = (text: string) => el("span", { className: "muted", text });
    previewBox.replaceChildren(
      sectionLabel("Review"),
      kv([
        ["Total out", el("span", { className: "mono", text: formatSats(p.total_out_sat) })],
        [
          "Fee",
          el("span", { className: "mono" }, [
            `${formatSats(p.fee_sat)} `,
            muted(`(${p.vsize} vB · ${p.input_count} in)`),
          ]),
        ],
        [
          "Change",
          el("span", { className: "mono" }, [
            `${formatSats(p.change_sat)} `,
            muted("→ back to this wallet"),
          ]),
        ],
        [
          "Total spent",
          el("span", { className: "mono strong", text: formatSats(p.total_out_sat + p.fee_sat) }),
        ],
      ]),
      el("div", { className: "actions actions-end" }, [backBtn, confirmBtn]),
    );
    previewBox.scrollIntoView({ block: "nearest" });
  };

  const reviewBtn = button(
    "Review",
    () =>
      withBusy(reviewBtn, async () => {
        alert.hide();
        const recipients = collectRecipients();
        if (!recipients) return;
        const rate = Number(feeRate.value);
        if (!Number.isFinite(rate) || rate < 1) {
          alert.show("error", "Fee rate must be at least 1 sat/vB.");
          return;
        }
        try {
          // In Max mode the preview already exists and is exactly the amount shown.
          const p = drain ?? (await api.buildTransfer(recipients, rate));
          setFormLocked(true);
          showPreview(p);
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "primary",
  );

  const cancelBtn = button("Cancel", async () => {
    if (preview) {
      try {
        await api.discardTx(preview.psbt_id);
      } catch {
        // best-effort
      }
    }
    navigate("dashboard");
  });

  // After `reviewBtn` exists: the first row immediately reports its validity.
  addRow();
  void loadEstimate();

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Send" }),
      el("p", { className: "muted small", text: `From ${wallet.address}` }),
    ]),
    alert.node,
    rowsBox,
    el("section", { className: "card" }, [
      sectionLabel("Fee"),
      el("div", { className: "fee-row" }, [
        field("Target", target),
        field("Rate (sat/vB)", feeRate),
        el("div", { className: "field" }, [
          el("span", { className: "field-label", text: "Source" }),
          feeHint,
        ]),
      ]),
    ]),
    el("div", { className: "actions actions-end" }, [cancelBtn, reviewBtn]),
    previewBox,
  ]);
}
