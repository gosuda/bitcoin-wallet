import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import {
  ADDRESS_TYPE_LABELS,
  type Balance,
  errorMessage,
  NETWORK_LABELS,
  rateForTarget,
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

/** Only our own unconfirmed sends can be replaced; everything else is settled. */
function isBumpable(tx: TxSummary): boolean {
  return tx.confirmations === null && tx.net_sat < 0;
}

type BumpRequest = (tx: TxSummary, row: HTMLTableRowElement, trigger: HTMLButtonElement) => void;

function txTable(txs: TxSummary[], onBump: BumpRequest): HTMLElement {
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
    const row = el("tr");
    const actions = el("td", { className: "num tx-actions" });
    if (isBumpable(tx)) {
      const bumpBtn = button("Bump fee", () => onBump(tx, row, bumpBtn), "default", "sm", {
        name: "refresh",
        size: 12,
      });
      actions.appendChild(bumpBtn);
    }
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
      actions,
    );
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
    const pending = b.trusted_pending + b.untrusted_pending;
    const total = b.confirmed + pending + b.immature;
    heroTotal.textContent = formatNumber(total);
    heroBtc.textContent = formatBtc(total);
    clear(stats);
    stats.append(
      stat("Confirmed", formatSats(b.confirmed)),
      stat("Pending", formatSats(pending), "muted"),
      b.immature > 0 ? stat("Immature", formatSats(b.immature), "muted") : el("span"),
    );
  };

  const renderUtxos = (utxos: Utxo[]) => {
    utxoCount.textContent = `${utxos.length} output${utxos.length === 1 ? "" : "s"}`;
    utxoBox.replaceChildren(utxoTable(utxos));
  };

  /** At most one inline confirm is open, in a row of its own under its tx. */
  let bumpRow: HTMLTableRowElement | null = null;

  const closeBump = () => {
    bumpRow?.remove();
    bumpRow = null;
  };

  const openBumpConfirm = (tx: TxSummary, row: HTMLTableRowElement, suggested: number) => {
    const rate = textInput({ value: String(suggested), type: "number", mono: true });
    rate.id = `bump-rate-${tx.txid.slice(0, 8)}`;
    rate.min = "1";
    rate.step = "0.1";
    rate.classList.add("bump-rate");
    const bumpBtn = button(
      "Bump",
      () =>
        withBusy(bumpBtn, async () => {
          alert.hide();
          const value = Number(rate.value);
          if (!Number.isFinite(value) || value < 1) {
            alert.show("error", "Fee rate must be at least 1 sat/vB.");
            return;
          }
          try {
            const preview = await api.buildFeeBump(tx.txid, value);
            const result = await api.signAndBroadcast(preview.psbt_id);
            closeBump();
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
    );
    closeBump();
    bumpRow = el("tr", { className: "bump-row" }, [
      el("td", { attrs: { colspan: "6" } }, [
        el("div", { className: "bump-confirm", attrs: { role: "group" } }, [
          el("label", {
            className: "bump-label",
            text: "New rate (sat/vB)",
            attrs: { for: rate.id },
          }),
          rate,
          bumpBtn,
          button("Cancel", closeBump, "quiet", "sm"),
        ]),
      ]),
    ]);
    row.after(bumpRow);
    rate.focus();
    rate.select();
  };

  const requestBump: BumpRequest = (tx, row, trigger) => {
    closeBump();
    void withBusy(trigger, async () => {
      alert.hide();
      let suggested = 1;
      try {
        // Replacing means outbidding the original: the 1-block rate is the ask.
        const rate = rateForTarget(await api.estimateFee(), 1);
        suggested = Math.max(1, Math.ceil((rate ?? 1) * 10) / 10);
      } catch (e) {
        alert.show("warn", `Fee estimate unavailable: ${errorMessage(e)} — starting at 1 sat/vB.`);
      }
      openBumpConfirm(tx, row, suggested);
    });
  };

  const renderTxs = (txs: TxSummary[]) => {
    // The confirm belongs to a row that is about to be replaced.
    bumpRow = null;
    txCount.textContent = `${txs.length} · newest first`;
    txBox.replaceChildren(txTable(txs, requestBump));
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
    // Never redraw the history out from under an open bump confirm.
    if (silent && bumpRow) return;
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

  renderBalance({ confirmed: 0, trusted_pending: 0, untrusted_pending: 0, immature: 0 });
  renderSynced();
  utxoBox.appendChild(el("p", { className: "empty", text: "Loading…" }));
  txBox.appendChild(el("p", { className: "empty", text: "Loading…" }));
  void refreshLocal().catch((e: unknown) => alert.show("error", errorMessage(e)));

  const screen = el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Wallet" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[wallet.network]} · ${ADDRESS_TYPE_LABELS[wallet.address_type]} · ${wallet.wallet_id}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card card-tight" }, [
      el("div", { className: "card-head" }, [
        sectionLabel("Balance"),
        el("div", { className: "actions" }, [syncedLabel, syncBtn, sendBtn]),
      ]),
      el("div", { className: "hero-row" }, [
        heroTotal,
        el("span", { className: "stat-unit", text: "sat" }),
        heroBtc,
      ]),
      stats,
    ]),
    el("section", { className: "card" }, [
      sectionLabel("Receiving address"),
      el("div", { className: "address-row" }, [
        readout(wallet.address),
        copyButton(() => wallet.address),
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
    el("div", { className: "actions actions-end" }, [closeBtn]),
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
