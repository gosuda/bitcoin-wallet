import { api } from "../../api";
import { headlineSat } from "../../balance";
import { navigate } from "../../router";
import { session } from "../../session";
import { type Balance, errorMessage, NETWORK_LABELS, type TxSummary } from "../../types";
import { banner, el, formatBtc, formatNumber, sectionLabel } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { body, button, card, header, listCard, row } from "../ui";

const AUTO_SYNC_MS = 60_000;

function whenLabel(tx: TxSummary): string {
  if (tx.confirmations === null || tx.confirmations === 0) return "Pending";
  return tx.confirmations === 1
    ? "1 confirmation"
    : `${formatNumber(tx.confirmations)} confirmations`;
}

function dateLabel(tx: TxSummary): string {
  if (tx.timestamp === null) return "";
  return new Date(tx.timestamp * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function txRow(tx: TxSummary): HTMLElement {
  const incoming = tx.net_sat >= 0;
  const glyph = icon(incoming ? "down" : "up", 18);
  const dot = el("span", { className: "m-dirdot" }, [glyph]);
  dot.classList.add(incoming ? "m-tx-in" : "m-tx-out");

  const meta = [whenLabel(tx), dateLabel(tx)].filter(Boolean).join(" · ");
  const amount = el("span", {
    className: "m-amt",
    text: `${incoming ? "+" : "−"}${formatNumber(Math.abs(tx.net_sat))}`,
  });
  if (incoming) amount.classList.add("m-tx-in");

  return el("div", { className: "m-txrow" }, [
    dot,
    el("span", { className: "m-txmain" }, [
      el("span", { className: "m-txtitle", text: incoming ? "Received" : "Sent" }),
      el("span", { className: "m-txmeta", text: meta }),
    ]),
    amount,
  ]);
}

export function renderWallet(): HTMLElement {
  const info = session.wallet;
  const alert = banner();
  const host = el("main");
  if (!info) {
    navigate("setup");
    return host;
  }

  const hero = el("span", { className: "m-hero", text: "—" });
  const sub = el("span", { className: "m-sub", text: "" });
  const synced = el("span", { text: "Not synced yet" });

  const paint = (balance: Balance): void => {
    const total = headlineSat(balance);
    hero.textContent = formatNumber(total);
    // formatBtc already carries the unit; appending another gave "BTC BTC".
    sub.textContent = formatBtc(total);
  };

  const txHost = listCard(el("div", { className: "m-empty", text: "No transactions yet." }));

  const paintTxs = (txs: readonly TxSummary[]): void => {
    txHost.replaceChildren(
      el("div", { className: "m-list-head" }, [
        sectionLabel("Transactions"),
        el("span", { className: "m-txmeta", text: `${txs.length} · newest first` }),
      ]),
      ...(txs.length === 0
        ? [el("div", { className: "m-empty", text: "No transactions yet." })]
        : txs.slice(0, 25).map(txRow)),
    );
  };

  const refresh = async (): Promise<void> => {
    paint(await api.getBalance());
    paintTxs(await api.listTransactions());
  };

  const sync = el("button", {
    className: "m-sync",
    attrs: { type: "button" },
  }) as HTMLButtonElement;
  sync.appendChild(icon("refresh", 13));
  sync.appendChild(el("span", { text: "Sync" }));

  const runSync = async (): Promise<void> => {
    if (sync.disabled) return;
    sync.disabled = true;
    try {
      paint(await api.sync());
      paintTxs(await api.listTransactions());
      session.lastSyncedAt = new Date();
      synced.textContent = `Synced ${session.lastSyncedAt.toLocaleTimeString()}`;
      alert.hide();
    } catch (e) {
      synced.textContent = "Sync failed";
      alert.show("warn", errorMessage(e));
    } finally {
      sync.disabled = false;
    }
  };
  sync.addEventListener("click", () => void runSync());

  const balanceCard = card(
    el("div", { className: "m-meta" }, [
      el("span", {
        className: "pill",
        text: `${NETWORK_LABELS[info.network]}${info.is_hd ? " · HD" : ""}`,
      }),
      sync,
    ]),
    hero,
    sub,
    el("span", { className: "m-txmeta" }, [synced]),
  );

  host.appendChild(
    header("Wallet", {
      action: { name: "gear", label: "Settings", onClick: () => navigate("settings") },
    }),
  );
  host.appendChild(
    body(
      alert.node,
      balanceCard,
      row(
        button("Send", () => navigate("send"), { variant: "primary", icon: "up" }),
        button("Receive", () => navigate("receive"), { icon: "down" }),
      ),
      txHost,
    ),
  );

  void refresh().catch((e: unknown) => alert.show("warn", errorMessage(e)));

  // Auto-sync while this screen is on top and the app is in the foreground; the
  // timer retires itself once the node leaves the document.
  const timer = window.setInterval(() => {
    if (!host.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (document.hidden || sync.disabled) return;
    void runSync();
  }, AUTO_SYNC_MS);

  return host;
}
