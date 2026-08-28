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
import { banner, button, clear, el, formatSats, mono, withBusy } from "../ui/dom";

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
    el("th", { className: "num", text: "Value" }),
    el("th", { className: "num", text: "Conf." }),
  ]);
  const body = el("tbody");
  for (const u of utxos) {
    body.appendChild(
      el("tr", {}, [
        el("td", {
          className: "mono",
          text: `${shortTxid(u.txid)}:${u.vout}`,
          attrs: { title: `${u.txid}:${u.vout}` },
        }),
        el("td", { className: "mono", text: u.address }),
        el("td", { className: "num mono", text: formatSats(u.value) }),
        el("td", {
          className: `num mono ${u.confirmations === null ? "muted" : ""}`.trim(),
          text: u.confirmations === null ? "pending" : String(u.confirmations),
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
  const stats = el("div", { className: "stat-row" });
  const utxoBox = el("div");
  const syncedLabel = el("span", { className: "muted small", text: "Not synced yet" });

  const renderBalance = (b: Balance) => {
    clear(stats);
    stats.append(
      stat("Confirmed", formatSats(b.confirmed)),
      stat("Pending", formatSats(b.trusted_pending + b.untrusted_pending), "muted"),
      b.immature > 0 ? stat("Immature", formatSats(b.immature), "muted") : el("span"),
    );
  };

  const renderSynced = () => {
    const at = session.lastSyncedAt;
    syncedLabel.textContent = at ? `Last synced ${at.toLocaleTimeString()}` : "Not synced yet";
  };

  const refreshLocal = async () => {
    const [balance, utxos] = await Promise.all([api.getBalance(), api.listUtxos()]);
    renderBalance(balance);
    utxoBox.replaceChildren(utxoTable(utxos));
  };

  const syncBtn = button("Sync", () =>
    withBusy(syncBtn, async () => {
      alert.hide();
      try {
        const balance = await api.sync();
        session.lastSyncedAt = new Date();
        renderBalance(balance);
        utxoBox.replaceChildren(utxoTable(await api.listUtxos()));
        renderSynced();
      } catch (e) {
        alert.show("error", errorMessage(e));
      }
    }),
  );

  const sendBtn = button("Send", () => navigate("send"), "primary");

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
          navigate("key");
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
    el("section", { className: "card" }, [
      el("h2", { text: "Receiving address" }),
      el("div", { className: "address-row" }, [
        mono(wallet.address),
        copyButton(() => wallet.address),
      ]),
    ]),
    el("section", { className: "card" }, [
      el("div", { className: "screen-head" }, [
        el("h2", { text: "Balance" }),
        el("div", { className: "actions" }, [syncedLabel, syncBtn, sendBtn]),
      ]),
      stats,
    ]),
    el("section", { className: "card" }, [el("h2", { text: "Unspent outputs" }), utxoBox]),
    el("div", { className: "actions actions-end" }, [closeBtn]),
  ]);
}
