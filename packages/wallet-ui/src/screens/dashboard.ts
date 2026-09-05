import QRCode from "qrcode";

import { formatAmount, parseAmount, type Unit } from "../amount";
import { api } from "../api";
import { headlineSat, pendingSat } from "../balance";
import { buildPaymentUri, qrPayload } from "../bip21";
import { suggestBumpRate } from "../feebump";
import { platform } from "../platform";
import { navigate } from "../router";
import { session } from "../session";
import {
  ADDRESS_TYPE_LABELS,
  type Balance,
  errorMessage,
  NETWORK_LABELS,
  type PublicDescriptors,
  type TxDetail,
  type TxOutput,
  type TxSummary,
  type Utxo,
} from "../types";
import { copyButton } from "../ui/clipboard";
import {
  banner,
  button,
  clear,
  el,
  formatBtc,
  formatNumber,
  formatSats,
  kv,
  mono,
  radioGroup,
  readout,
  sectionLabel,
  textInput,
  withBusy,
} from "../ui/dom";
import { icon } from "../ui/icons";

function stat(label: string, value: string, cls = ""): HTMLElement {
  return el("div", { className: "stat" }, [
    el("span", { className: "stat-label", text: label }),
    el("span", { className: `stat-value mono ${cls}`.trim(), text: value }),
  ]);
}

function shortTxid(txid: string): string {
  return `${txid.slice(0, 10)}…${txid.slice(-8)}`;
}

function utxoTable(utxos: Utxo[]): HTMLElement {
  if (utxos.length === 0) {
    return el("p", { className: "empty", text: "No unspent outputs. Sync to refresh." });
  }
  const head = el("tr", {}, [
    el("th", { text: "Outpoint" }),
    el("th", { text: "Address" }),
    el("th", { className: "num", text: "Value (sat)" }),
    el("th", { className: "num", text: "Conf." }),
  ]);
  const body = el("tbody");
  for (const u of utxos) {
    const pending = u.confirmations === null;
    body.appendChild(
      el("tr", {}, [
        el("td", {
          className: "mono",
          text: `${shortTxid(u.txid)}:${u.vout}`,
          attrs: { title: `${u.txid}:${u.vout}` },
        }),
        el("td", { className: "mono muted", text: u.address }),
        el("td", { className: "num mono", text: formatNumber(u.value) }),
        el("td", {
          className: `num mono ${pending ? "muted" : ""}`.trim(),
          text: pending ? "pending" : String(u.confirmations),
        }),
      ]),
    );
  }
  return el("div", { className: "table-wrap" }, [el("table", {}, [el("thead", {}, [head]), body])]);
}

/** How often the dashboard re-syncs while it is on screen and visible. */
const AUTO_SYNC_MS = 60_000;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative within a day ("2 min ago", "3 h ago"), a short local date before that. */
function formatWhen(timestamp: number | null): string {
  if (timestamp === null) return "—";
  const age = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** What a row says about an output: ours is change on a send, a receipt otherwise. */
function outputLabel(d: TxDetail, o: TxOutput): string {
  if (!o.ours) return "To";
  return d.net_sat < 0 ? "Change" : "Received";
}

/** The sat / BTC pair beside an amount field, as on the Send screen. */
function unitChips(name: string, onChange: (unit: Unit) => void): { node: HTMLElement } {
  const group = el("div", {
    className: "unit-group",
    attrs: { role: "radiogroup", "aria-label": "Amount unit" },
  });
  for (const [unit, label] of [
    ["sat", "sat"],
    ["btc", "BTC"],
  ] as const) {
    const input = el("input", { attrs: { type: "radio", name, value: unit } });
    input.checked = unit === "sat";
    input.addEventListener("change", () => {
      if (input.checked) onChange(unit);
    });
    group.appendChild(
      el("label", { className: "unit-chip" }, [input, el("span", { text: label })]),
    );
  }
  return { node: group };
}

type OpenRow = (tx: TxSummary, row: HTMLTableRowElement, chevron: HTMLElement) => void;

function txTable(txs: TxSummary[], onOpen: OpenRow): HTMLElement {
  if (txs.length === 0) {
    return el("p", { className: "empty", text: "No transactions yet." });
  }
  const head = el("tr", {}, [
    el("th", { className: "tx-dir" }),
    el("th", { text: "Txid" }),
    el("th", { className: "num", text: "Amount (sat)" }),
    el("th", { className: "num", text: "Conf." }),
    el("th", { className: "num", text: "When" }),
    el("th", { className: "num tx-actions" }),
  ]);
  const body = el("tbody");
  for (const tx of txs) {
    // `net_sat` is negative for a send, and the fee is already part of it.
    const incoming = tx.net_sat >= 0;
    const pending = tx.confirmations === null;
    const chevron = el("span", { className: "tx-chevron" }, [icon("chevron", 14)]);
    const row = el("tr", {
      className: "tx-open",
      attrs: { tabindex: "0", role: "button", "aria-expanded": "false" },
    });
    row.append(
      el("td", { className: "tx-dir" }, [
        el("span", { className: `tx-arrow ${incoming ? "tx-in rot180" : "muted"}` }, [
          icon("arrow", 14),
        ]),
      ]),
      el("td", {
        className: "mono",
        text: shortTxid(tx.txid),
        attrs: { title: tx.txid },
      }),
      el("td", {
        className: `num mono tx-amount ${incoming ? "tx-in" : ""}`.trim(),
        text: `${incoming ? "+" : "−"}${formatNumber(Math.abs(tx.net_sat))}`,
      }),
      el("td", {
        className: `num mono ${pending ? "muted" : ""}`.trim(),
        text: pending ? "pending" : String(tx.confirmations),
      }),
      el("td", { className: "num muted", text: formatWhen(tx.timestamp) }),
      el("td", { className: "num tx-actions" }, [chevron]),
    );
    row.addEventListener("click", () => onOpen(tx, row, chevron));
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onOpen(tx, row, chevron);
      }
    });
    body.appendChild(row);
  }
  return el("div", { className: "table-wrap" }, [el("table", {}, [el("thead", {}, [head]), body])]);
}

export function renderDashboard(): HTMLElement {
  const wallet = session.wallet;
  if (!wallet) {
    navigate("setup");
    return el("main");
  }

  const alert = banner();
  const heroTotal = el("span", { className: "stat-hero mono", text: "0" });
  const heroBtc = el("span", { className: "stat-secondary mono", text: formatBtc(0) });
  const stats = el("div", { className: "stat-row" });
  const utxoBox = el("div");
  const utxoCount = el("span", { className: "hint", text: "" });
  const txBox = el("div");
  const txCount = el("span", { className: "hint", text: "" });
  const syncedLabel = el("span", { className: "hint", text: "Not synced yet" });

  const renderBalance = (b: Balance) => {
    const total = headlineSat(b);
    heroTotal.textContent = formatNumber(total);
    heroBtc.textContent = formatBtc(total);
    clear(stats);
    stats.append(
      stat("Confirmed", formatSats(b.confirmed)),
      stat("Pending", formatSats(pendingSat(b)), "muted"),
      b.immature > 0 ? stat("Immature", formatSats(b.immature), "muted") : el("span"),
    );
  };

  const renderUtxos = (utxos: Utxo[]) => {
    utxoCount.textContent = `${utxos.length} output${utxos.length === 1 ? "" : "s"}`;
    utxoBox.replaceChildren(utxoTable(utxos));
  };

  // --- one transaction open at a time, in a row of its own under its tx -----
  let open: { row: HTMLTableRowElement; detail: HTMLTableRowElement; chevron: HTMLElement } | null =
    null;

  const closeDetail = () => {
    if (!open) return;
    open.detail.remove();
    open.chevron.classList.remove("tx-chevron-open");
    open.row.setAttribute("aria-expanded", "false");
    open = null;
  };

  const bumpInline = (txid: string, suggested: number): HTMLElement => {
    const rate = textInput({ value: String(suggested), type: "number", mono: true });
    rate.id = `bump-rate-${txid.slice(0, 8)}`;
    rate.min = "1";
    rate.step = "0.1";
    rate.classList.add("bump-rate");
    const bumpBtn = button(
      "Bump fee",
      () =>
        withBusy(bumpBtn, async () => {
          alert.hide();
          const value = Number(rate.value);
          if (!Number.isFinite(value) || value < 1) {
            alert.show("error", "Fee rate must be at least 1 sat/vB.");
            return;
          }
          try {
            const preview = await api.buildFeeBump(txid, value);
            const result = await api.signAndBroadcast(preview.psbt_id);
            closeDetail();
            session.lastResult = result;
            navigate("result");
          } catch (e) {
            // A rate below the replacement rules is refused by the node; the
            // node's own wording is the most useful thing to show.
            alert.show("error", errorMessage(e));
          }
        }),
      "primary",
      "sm",
      { name: "refresh", size: 12 },
    );
    return el("span", { className: "bump-inline" }, [
      el("label", { className: "bump-label", text: "Bump to", attrs: { for: rate.id } }),
      rate,
      el("span", { className: "bump-label", text: "sat/vB" }),
      bumpBtn,
    ]);
  };

  const detailBox = (
    d: TxDetail,
    explorer: string | null,
    suggested: number | null,
  ): HTMLElement => {
    const ownInputs = d.inputs.filter((i) => i.ours).length;
    const muted = (text: string) => el("span", { className: "muted", text });
    const rows: [string, Node | string][] = [
      ["Txid", mono(d.txid, "small")],
      [
        "Fee",
        d.fee_sat === null
          ? `${formatNumber(d.vsize)} vB`
          : `${formatSats(d.fee_sat)} · ${(d.fee_rate_sat_vb ?? 0).toFixed(1)} sat/vB · ${formatNumber(d.vsize)} vB`,
      ],
      [
        "From",
        `${d.inputs.length} input${d.inputs.length === 1 ? "" : "s"}${
          ownInputs === d.inputs.length ? " · yours" : ownInputs > 0 ? ` · ${ownInputs} yours` : ""
        }`,
      ],
      ...d.outputs.map((o): [string, Node] => [
        outputLabel(d, o),
        el("span", { className: "mono" }, [
          `${o.address ?? "script"} `,
          el("span", { className: "strong", text: formatSats(o.value_sat) }),
          o.ours && d.net_sat < 0 ? muted(" back to this wallet") : "",
        ]),
      ]),
    ];
    const actions = el("div", { className: "tx-detail-actions" }, [
      copyButton(() => d.txid, "Copy txid", "sm"),
    ]);
    if (explorer !== null) {
      actions.appendChild(
        button(
          "Open in explorer",
          () =>
            void platform()
              .openUrl(explorer)
              .catch((e: unknown) => alert.show("error", errorMessage(e))),
          "default",
          "sm",
          { name: "external", size: 14 },
        ),
      );
    }
    if (suggested !== null) actions.appendChild(bumpInline(d.txid, suggested));
    return el("div", { className: "tx-detail-box" }, [kv(rows), actions]);
  };

  const openDetail: OpenRow = (tx, row, chevron) => {
    if (open?.row === row) {
      closeDetail();
      return;
    }
    closeDetail();
    const cell = el("td", { attrs: { colspan: "6" } }, [
      el("div", { className: "tx-detail-box" }, [
        el("span", { className: "hint", text: "Loading…" }),
      ]),
    ]);
    const detail = el("tr", { className: "tx-detail" }, [cell]);
    row.after(detail);
    row.setAttribute("aria-expanded", "true");
    chevron.classList.add("tx-chevron-open");
    open = { row, detail, chevron };
    void (async () => {
      try {
        const d = await api.transaction(tx.txid);
        if (!d) throw new Error("this transaction is not in the wallet's history");
        const explorer = await api.explorerUrl(d.txid);
        // Only our own unconfirmed sends can be replaced, and only with a key.
        let suggested: number | null = null;
        if (d.confirmations === null && d.net_sat < 0 && !wallet.is_watch_only) {
          try {
            suggested = suggestBumpRate(await api.estimateFee());
          } catch {
            suggested = suggestBumpRate(null);
          }
        }
        if (open?.detail === detail) cell.replaceChildren(detailBox(d, explorer, suggested));
      } catch (e) {
        alert.show("error", errorMessage(e));
        closeDetail();
      }
    })();
  };

  const renderTxs = (txs: TxSummary[]) => {
    // The detail belongs to a row that is about to be replaced.
    open = null;
    txCount.textContent = `${txs.length} · newest first · click a row for detail`;
    txBox.replaceChildren(txTable(txs, openDetail));
  };

  let autoSyncFailed = false;

  const renderSynced = () => {
    const at = session.lastSyncedAt;
    const base = at ? `Last synced ${at.toLocaleTimeString()}` : "Not synced yet";
    syncedLabel.textContent = autoSyncFailed ? `${base} · retrying` : base;
  };

  const refreshLocal = async () => {
    const [balance, utxos, txs] = await Promise.all([
      api.getBalance(),
      api.listUtxos(),
      api.listTransactions(),
    ]);
    renderBalance(balance);
    renderUtxos(utxos);
    renderTxs(txs);
  };

  // Guards the button press and the interval against overlapping syncs.
  let syncing = false;

  // `silent` is the periodic sync: a transient failure marks the label
  // instead of raising a banner the user never asked for.
  const runSync = async (silent: boolean) => {
    if (syncing) return;
    // Never redraw the history out from under an open transaction.
    if (silent && open) return;
    syncing = true;
    try {
      if (!silent) alert.hide();
      const balance = await api.sync();
      session.lastSyncedAt = new Date();
      autoSyncFailed = false;
      renderBalance(balance);
      const [utxos, txs] = await Promise.all([api.listUtxos(), api.listTransactions()]);
      renderUtxos(utxos);
      renderTxs(txs);
      renderSynced();
    } catch (e) {
      if (silent) {
        autoSyncFailed = true;
        renderSynced();
      } else {
        alert.show("error", errorMessage(e));
      }
    } finally {
      syncing = false;
    }
  };

  const syncBtn = button("Sync", () => withBusy(syncBtn, () => runSync(false)), "default", "md", {
    name: "refresh",
  });

  const sendBtn = button("Send", () => navigate("send"), "primary", "md", {
    name: "arrow",
    trailing: true,
  });

  const closeBtn = button(
    "Close wallet",
    () =>
      withBusy(closeBtn, async () => {
        try {
          await api.closeWallet();
        } finally {
          session.wallet = null;
          session.lastSyncedAt = null;
          session.lastResult = null;
          navigate(session.remembered ? "unlock" : "key");
        }
      }),
    "danger",
  );

  // --- receive: the address, its QR, and an optional amount request -------
  //
  // The receiving address changes under an HD wallet, so the readout, the QR
  // and the copy button all read one variable instead of a snapshot.
  let receiving = wallet.address;
  const addressBox = readout(receiving);
  const qrCanvas = el("canvas", {
    attrs: { role: "img", "aria-label": "QR code of the receiving address" },
  }) as HTMLCanvasElement;
  const requestAmount = textInput({ placeholder: "0", mono: true, name: "request_amount" });
  requestAmount.id = "request-amount";
  requestAmount.classList.add("amount-input");
  requestAmount.setAttribute("inputmode", "decimal");
  const requestErr = el("span", { className: "field-error" });
  const uriNote = el("span", { className: "hint mono break" });
  let requestUnit: Unit = "sat";

  /** What is shared: the bare address, or a bitcoin: URI once an amount is set. */
  const sharePayload = (): string => {
    const parsed = parseAmount(requestAmount.value, requestUnit);
    requestErr.textContent = parsed.error ?? "";
    requestAmount.classList.toggle("input-invalid", parsed.error !== null);
    return parsed.sats === null
      ? receiving
      : buildPaymentUri({ address: receiving, amountSat: parsed.sats });
  };

  const paintQr = async () => {
    const share = sharePayload();
    uriNote.textContent = share === receiving ? "" : share;
    qrCanvas.setAttribute(
      "aria-label",
      share === receiving ? "QR code of the receiving address" : "QR code of the payment request",
    );
    try {
      await QRCode.toCanvas(qrCanvas, qrPayload(share), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 120,
        color: { dark: "#1a1a1aff", light: "#ffffffff" },
      });
    } catch (e) {
      alert.show("warn", errorMessage(e));
    }
  };
  requestAmount.addEventListener("input", () => void paintQr());
  const units = unitChips("request_unit", (unit) => {
    const parsed = parseAmount(requestAmount.value, requestUnit);
    requestUnit = unit;
    if (parsed.sats !== null) requestAmount.value = formatAmount(parsed.sats, unit);
    void paintQr();
  });

  const addressActions = el("div", { className: "actions" }, [copyButton(() => sharePayload())]);
  if (wallet.is_hd) {
    const newAddressBtn = button(
      "New address",
      () =>
        withBusy(newAddressBtn, async () => {
          alert.hide();
          try {
            receiving = await api.newAddress();
            addressBox.textContent = receiving;
            addressBox.setAttribute("title", receiving);
            await paintQr();
          } catch (e) {
            alert.show("error", errorMessage(e));
          }
        }),
      "default",
      "md",
      { name: "plus" },
    );
    addressActions.appendChild(newAddressBtn);
  }

  // --- public keys: enough to watch this wallet elsewhere ------------------
  const keysBox = el("div", {}, [el("p", { className: "empty", text: "Loading…" })]);
  const renderKeys = (d: PublicDescriptors) => {
    const rows: [string, Node][] = [];
    if (d.account_xpub !== null) rows.push(["Account xpub", mono(d.account_xpub, "small")]);
    rows.push([d.internal === null ? "Descriptor" : "Receive", mono(d.external, "small")]);
    if (d.internal !== null) rows.push(["Change", mono(d.internal, "small")]);
    const actions = el("div", { className: "actions" });
    if (d.account_xpub !== null) {
      const xpub = d.account_xpub;
      actions.appendChild(copyButton(() => xpub, "Copy xpub", "sm"));
    }
    const both = d.internal === null ? d.external : `${d.external}\n${d.internal}`;
    actions.appendChild(
      copyButton(() => both, d.internal === null ? "Copy descriptor" : "Copy descriptors", "sm"),
    );
    keysBox.replaceChildren(kv(rows), actions);
  };

  // --- rescan: for a restore that shows too little --------------------------
  let gap = "20";
  const gapChips = radioGroup(
    "rescan_gap",
    [
      { value: "20", label: "gap 20" },
      { value: "100", label: "100" },
      { value: "500", label: "500" },
    ],
    "20",
    (v) => {
      gap = v;
    },
  );
  const rescanBtn = button(
    "Rescan",
    () =>
      withBusy(rescanBtn, async () => {
        alert.hide();
        try {
          const balance = await api.rescan(Number(gap));
          session.lastSyncedAt = new Date();
          autoSyncFailed = false;
          renderBalance(balance);
          await refreshLocal();
          renderSynced();
          alert.show(
            "ok",
            `Rescanned with a gap of ${gap}: ${formatSats(headlineSat(balance))} in this wallet.`,
          );
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "default",
    "md",
    { name: "refresh" },
  );

  renderBalance({ confirmed: 0, trusted_pending: 0, untrusted_pending: 0, immature: 0 });
  renderSynced();
  utxoBox.appendChild(el("p", { className: "empty", text: "Loading…" }));
  txBox.appendChild(el("p", { className: "empty", text: "Loading…" }));
  void refreshLocal().catch((e: unknown) => alert.show("error", errorMessage(e)));
  void paintQr();
  void api
    .publicDescriptors()
    .then(renderKeys)
    .catch((e: unknown) => {
      keysBox.replaceChildren(el("p", { className: "empty", text: errorMessage(e) }));
    });

  const kind = wallet.is_watch_only ? " · Watch-only" : "";
  const screen = el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Wallet" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[wallet.network]} · ${ADDRESS_TYPE_LABELS[wallet.address_type]}${kind} · ${wallet.wallet_id}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card card-tight" }, [
      el("div", { className: "card-head" }, [
        sectionLabel("Balance"),
        // A watch-only wallet has nothing to sign with, so there is no Send.
        el("div", { className: "actions" }, [
          syncedLabel,
          syncBtn,
          wallet.is_watch_only ? null : sendBtn,
        ]),
      ]),
      el("div", { className: "hero-row" }, [
        heroTotal,
        el("span", { className: "stat-unit", text: "sat" }),
        heroBtc,
      ]),
      stats,
    ]),
    el("section", { className: "card" }, [
      sectionLabel("Receive"),
      el("div", { className: "receive-row" }, [
        el("div", { className: "qr-box" }, [qrCanvas]),
        el("div", { className: "receive-main" }, [
          el("div", { className: "address-row" }, [addressBox, addressActions]),
          el("div", { className: "field" }, [
            el("label", {
              className: "field-label",
              text: "Request amount (optional)",
              attrs: { for: requestAmount.id },
            }),
            el("div", { className: "request-row" }, [requestAmount, units.node, uriNote]),
            requestErr,
            el("p", {
              className: "muted small",
              text: "With an amount the QR is a bitcoin: link; without one it is the bare address.",
            }),
          ]),
        ]),
      ]),
    ]),
    el("section", { className: "card" }, [
      el("div", { className: "card-head" }, [sectionLabel("Unspent outputs"), utxoCount]),
      utxoBox,
    ]),
    el("section", { className: "card" }, [
      el("div", { className: "card-head" }, [sectionLabel("Transactions"), txCount]),
      txBox,
    ]),
    el("section", { className: "card pubkeys" }, [
      el("div", { className: "card-head" }, [
        sectionLabel("Public keys"),
        el("span", {
          className: "hint",
          text: "Reveal your history, not your funds — for a watch-only copy elsewhere.",
        }),
      ]),
      keysBox,
    ]),
    el("div", { className: "actions actions-split" }, [
      el("div", { className: "actions" }, [
        rescanBtn,
        gapChips,
        el("span", {
          className: "hint",
          text: "Looks further past the last used address — for a restore that shows too little.",
        }),
      ]),
      closeBtn,
    ]),
  ]);

  // Keep the wallet fresh while this screen is open. The router swaps screens
  // without a teardown hook, so the timer retires itself once the node is gone.
  const timer = window.setInterval(() => {
    if (!screen.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (document.hidden) return;
    void withBusy(syncBtn, () => runSync(true));
  }, AUTO_SYNC_MS);

  return screen;
}
