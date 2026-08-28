import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import { errorMessage, type FeeEstimate, type Recipient, type TxPreview } from "../types";
import { banner, button, el, field, formatSats, kv, textInput, withBusy } from "../ui/dom";

const FEE_TARGETS = [1, 3, 6] as const;

interface RecipientRow {
  node: HTMLElement;
  address: HTMLInputElement;
  amount: HTMLInputElement;
}

/** Best rate for `target` blocks (mirrors `FeeEstimate::for_target`). */
function rateForTarget(est: FeeEstimate, target: number): number | null {
  const entries = Object.entries(est.sat_per_vb_by_target)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([k]) => Number.isFinite(k))
    .sort((a, b) => a[0] - b[0]);
  const exact = entries.find(([k]) => k === target);
  if (exact) return exact[1];
  const faster = entries.filter(([k]) => k < target).at(-1);
  if (faster) return faster[1];
  const slower = entries.find(([k]) => k > target);
  return slower ? slower[1] : null;
}

function parseSats(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function renderSend(): HTMLElement {
  const wallet = session.wallet;
  if (!wallet) {
    navigate("setup");
    return el("main");
  }

  const alert = banner();
  const rows: RecipientRow[] = [];
  const rowsBox = el("div", { className: "card" });
  let estimate: FeeEstimate | null = null;
  let preview: TxPreview | null = null;

  const feeRate = textInput({ value: "1", type: "number", mono: true });
  feeRate.min = "1";
  feeRate.step = "0.1";
  feeRate.addEventListener("input", () => {
    feeHint.textContent = "Custom rate";
  });
  const feeHint = el("span", { className: "muted small", text: "Fetching estimate…" });

  const target = el("select", { attrs: { name: "fee_target" } });
  for (const t of FEE_TARGETS) {
    target.appendChild(
      el("option", { text: `${t} block${t > 1 ? "s" : ""}`, attrs: { value: String(t) } }),
    );
  }
  target.value = "6";

  const applyEstimate = () => {
    if (!estimate) return;
    const rate = rateForTarget(estimate, Number(target.value));
    if (rate === null) {
      feeHint.textContent = "No estimate available; enter a rate.";
      return;
    }
    const rounded = Math.max(1, Math.ceil(rate * 10) / 10);
    feeRate.value = String(rounded);
    feeHint.textContent = `Estimate for ${target.value} block(s): ${rate.toFixed(1)} sat/vB`;
  };
  target.addEventListener("change", applyEstimate);

  const loadEstimate = async () => {
    try {
      estimate = await api.estimateFee();
      applyEstimate();
    } catch (e) {
      feeHint.textContent = `Estimate unavailable: ${errorMessage(e)}`;
    }
  };

  const removeRow = (row: RecipientRow) => {
    const i = rows.indexOf(row);
    if (i >= 0) rows.splice(i, 1);
    row.node.remove();
    syncRemoveButtons();
  };

  const syncRemoveButtons = () => {
    for (const r of rows) {
      const btn = r.node.querySelector("button");
      if (btn) btn.disabled = rows.length === 1;
    }
  };

  const addRow = () => {
    const address = textInput({ placeholder: `Recipient address (${wallet.network})`, mono: true });
    const amount = textInput({ placeholder: "sats", type: "number", mono: true });
    amount.min = "1";
    amount.step = "1";
    const row: RecipientRow = { node: el("div", { className: "recipient-row" }), address, amount };
    row.node.append(
      field("Address", address),
      field("Amount (sat)", amount),
      button("Remove", () => removeRow(row), "default"),
    );
    rows.push(row);
    rowsBox.insertBefore(row.node, addBtn.parentElement);
    syncRemoveButtons();
  };

  const addBtn = button("Add recipient", addRow, "default", "sm");
  rowsBox.append(el("h2", { text: "Recipients" }), el("div", { className: "actions" }, [addBtn]));
  addRow();

  const collectRecipients = (): Recipient[] | null => {
    const out: Recipient[] = [];
    for (const r of rows) {
      const address = r.address.value.trim();
      const sats = parseSats(r.amount.value);
      if (!address) {
        alert.show("error", "Every recipient needs an address.");
        return null;
      }
      if (sats === null) {
        alert.show("error", `Invalid amount for ${address}: whole sats > 0.`);
        return null;
      }
      out.push({ address, amount_sat: sats });
    }
    return out;
  };

  const previewBox = el("section", { className: "card hidden" });
  const formControls = (): (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] => [
    ...rows.flatMap((r) => [r.address, r.amount]),
    feeRate,
    target,
    addBtn,
    reviewBtn,
  ];
  const setFormLocked = (locked: boolean) => {
    for (const c of formControls()) c.disabled = locked;
    if (!locked) syncRemoveButtons();
  };

  const showPreview = (p: TxPreview, recipients: Recipient[]) => {
    preview = p;
    previewBox.className = "card";
    const confirmBtn = button(
      "Confirm and broadcast",
      () =>
        withBusy(confirmBtn, async () => {
          alert.hide();
          try {
            const result = await api.signAndBroadcast(p.psbt_id);
            preview = null;
            session.lastResult = result;
            navigate("result");
          } catch (e) {
            preview = null;
            previewBox.className = "card hidden";
            setFormLocked(false);
            alert.show("error", errorMessage(e));
          }
        }),
      "primary",
    );
    const backBtn = button("Edit", () =>
      withBusy(backBtn, async () => {
        try {
          await api.discardTx(p.psbt_id);
        } catch {
          // Pending map is best-effort; nothing to surface.
        }
        preview = null;
        previewBox.className = "card hidden";
        setFormLocked(false);
      }),
    );
    previewBox.replaceChildren(
      el("h2", { text: "Review" }),
      kv([
        ["Recipients", `${recipients.length}`],
        ["Total out", el("span", { className: "mono", text: formatSats(p.total_out_sat) })],
        [
          "Fee",
          el("span", { className: "mono", text: `${formatSats(p.fee_sat)} (${p.vsize} vB)` }),
        ],
        ["Change", el("span", { className: "mono", text: formatSats(p.change_sat) })],
        ["Inputs", `${p.input_count}`],
        [
          "Total spent",
          el("span", { className: "mono", text: formatSats(p.total_out_sat + p.fee_sat) }),
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
          const p = await api.buildTransfer(recipients, rate);
          setFormLocked(true);
          showPreview(p, recipients);
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

  void loadEstimate();

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Send" }),
      el("p", { className: "muted small", text: `From ${wallet.address}` }),
    ]),
    alert.node,
    rowsBox,
    el("section", { className: "card" }, [
      el("h2", { text: "Fee" }),
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
