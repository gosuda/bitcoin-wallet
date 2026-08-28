import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import {
  backendHost,
  errorMessage,
  type FeeEstimate,
  type Recipient,
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

type FeeTarget = `${(typeof FEE_TARGETS)[number]}`;

const FLOOR_NOTE = "floor 1 sat/vB";

export function renderSend(): HTMLElement {
  const wallet = session.wallet;
  const cfg = session.config;
  if (!wallet || !cfg) {
    navigate("setup");
    return el("main");
  }
  const host = backendHost(cfg.backend);

  const alert = banner();
  const rows: RecipientRow[] = [];
  const rowsBox = el("div", { className: "card" });
  let estimate: FeeEstimate | null = null;
  let preview: TxPreview | null = null;

  const feeRate = textInput({ value: "1", type: "number", mono: true });
  feeRate.min = "1";
  feeRate.step = "0.1";
  feeRate.addEventListener("input", () => {
    feeHint.textContent = `Custom rate · ${FLOOR_NOTE}`;
  });
  const feeHint = el("span", { className: "hint fee-source", text: "Fetching estimate…" });

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
      iconButton("x", "Remove recipient", () => removeRow(row)),
    );
    rows.push(row);
    rowsBox.appendChild(row.node);
    syncRemoveButtons();
  };

  const addBtn = button("Add recipient", addRow, "default", "sm", { name: "plus" });
  const rowsHead = el("div", { className: "card-head" }, [sectionLabel("Recipients"), addBtn]);
  rowsBox.append(rowsHead);
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

  const previewBox = el("section", { className: "card review-card hidden" });
  const formControls = (): (HTMLInputElement | HTMLButtonElement)[] => [
    ...rows.flatMap((r) => [r.address, r.amount]),
    feeRate,
    ...targetInputs(),
    addBtn,
    reviewBtn,
  ];
  const setFormLocked = (locked: boolean) => {
    for (const c of formControls()) c.disabled = locked;
    if (!locked) syncRemoveButtons();
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
          await api.discardTx(p.psbt_id);
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
          const p = await api.buildTransfer(recipients, rate);
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
