import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import {
  ADDRESS_TYPE_LABELS,
  type Balance,
  errorMessage,
  NETWORK_LABELS,
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
  withBusy,
} from "../ui/dom";

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

  const renderSynced = () => {
    const at = session.lastSyncedAt;
    syncedLabel.textContent = at ? `Last synced ${at.toLocaleTimeString()}` : "Not synced yet";
  };

  const refreshLocal = async () => {
    const [balance, utxos] = await Promise.all([api.getBalance(), api.listUtxos()]);
    renderBalance(balance);
    renderUtxos(utxos);
  };

  const syncBtn = button(
    "Sync",
    () =>
      withBusy(syncBtn, async () => {
        alert.hide();
        try {
          const balance = await api.sync();
          session.lastSyncedAt = new Date();
          renderBalance(balance);
          renderUtxos(await api.listUtxos());
          renderSynced();
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "default",
    "md",
    { name: "refresh" },
  );

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
  void refreshLocal().catch((e: unknown) => alert.show("error", errorMessage(e)));

  return el("main", { className: "screen" }, [
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
    el("div", { className: "actions actions-end" }, [closeBtn]),
  ]);
}
