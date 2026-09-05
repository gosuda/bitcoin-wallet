import { api } from "../../api";
import { suggestBumpRate } from "../../feebump";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { session } from "../../session";
import { errorMessage, type TxDetail, type TxOutput } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, formatNumber, sectionLabel, textInput } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { body, button, card, header, item, lede, listCard, row, withBusy } from "../ui";

/**
 * Which transaction to show. Routes carry no parameters, so a history row
 * stashes the txid here and navigates; the shell refuses the route when
 * nothing is stashed.
 */
let current: string | null = null;

export function showTransaction(txid: string): void {
  current = txid;
  navigate("tx");
}

export function currentTxid(): string | null {
  return current;
}

function short(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function when(timestamp: number | null): string {
  if (timestamp === null) return "";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** What a row says about an output: ours is change on a send, a receipt otherwise. */
function outputLabel(d: TxDetail, o: TxOutput): string {
  if (!o.ours) return "To";
  return d.net_sat < 0 ? "Change" : "Received";
}

export function renderTransaction(): HTMLElement {
  const info = session.wallet;
  const txid = current;
  const host = el("main");
  if (!info || !txid) {
    navigate("dashboard");
    return host;
  }

  const alert = banner();
  const content = body(alert.node, lede("Loading…"));
  host.appendChild(header("Transaction", { back: "dashboard" }));
  host.appendChild(content);

  const paint = (d: TxDetail): void => {
    const incoming = d.net_sat >= 0;
    const dot = el("span", { className: "m-dirdot" }, [icon(incoming ? "down" : "up", 22)]);
    dot.classList.add(incoming ? "m-tx-in" : "m-tx-out");
    const pending = d.confirmations === null;
    const status = el("span", { className: pending ? "pill m-pill-pending" : "pill" }, [
      el("span", { className: "pill-dot" }),
      pending
        ? `Pending${d.timestamp === null ? "" : ` · seen ${when(d.timestamp)}`}`
        : `${formatNumber(d.confirmations ?? 0)} confirmation${d.confirmations === 1 ? "" : "s"}${
            d.timestamp === null ? "" : ` · ${when(d.timestamp)}`
          }`,
    ]);
    const hero = card(
      dot,
      el("span", { className: "m-hero m-tx-amount" }, [
        `${incoming ? "+" : "−"}${formatNumber(Math.abs(d.net_sat))} `,
        el("span", { className: "m-tx-unit", text: "sat" }),
      ]),
      status,
    );
    hero.classList.add("m-tx-hero");

    const fee =
      d.fee_sat === null
        ? `${formatNumber(d.vsize)} vB`
        : `${formatNumber(d.fee_sat)} sat · ${(d.fee_rate_sat_vb ?? 0).toFixed(1)} sat/vB · ${formatNumber(d.vsize)} vB`;
    const confirmations = pending
      ? "0 — in the mempool"
      : `${formatNumber(d.confirmations ?? 0)}${d.block_height === null ? "" : ` · block ${formatNumber(d.block_height)}`}`;
    const facts = listCard(item("Fee", fee, undefined), item("Confirmations", confirmations));

    const ownInputs = d.inputs.filter((i) => i.ours).length;
    const from = `${d.inputs.length} input${d.inputs.length === 1 ? "" : "s"}${
      ownInputs === d.inputs.length ? " · yours" : ownInputs > 0 ? ` · ${ownInputs} yours` : ""
    }`;
    const flow = listCard(
      item("From", from),
      ...d.outputs.map((o) =>
        item(
          outputLabel(d, o),
          `${o.address === null ? "script" : short(o.address)} · ${formatNumber(o.value_sat)} sat`,
        ),
      ),
    );

    const explorer = button(
      "Explorer",
      async () => {
        alert.hide();
        try {
          const url = await api.explorerUrl(d.txid);
          if (!url) return alert.show("warn", "No public explorer exists for this network.");
          await platform().openUrl(url);
        } catch (e) {
          alert.show("warn", errorMessage(e));
        }
      },
      { icon: "external" },
    );
    const ident = card(
      sectionLabel("Transaction id"),
      el("span", { className: "m-mono-block", text: d.txid }),
      row(
        copyButton(() => d.txid),
        explorer,
      ),
    );

    // Only our own unconfirmed sends can be replaced, and only with a key.
    const bumpable = pending && d.net_sat < 0 && !info.is_watch_only;
    content.replaceChildren(
      alert.node,
      hero,
      facts,
      flow,
      ident,
      ...(bumpable ? [bumpCard(d.txid)] : []),
    );
  };

  const bumpCard = (id: string): HTMLElement => {
    const rate = textInput({ value: "1", type: "number", mono: true, name: "bump_rate" });
    rate.min = "1";
    rate.step = "0.1";
    rate.setAttribute("inputmode", "decimal");
    const note = el("span", { className: "hint", text: "Fetching the 1-block estimate…" });
    const bump = button(
      "Bump fee",
      () =>
        withBusy(bump, async () => {
          alert.hide();
          const value = Number(rate.value);
          if (!Number.isFinite(value) || value < 1) {
            return alert.show("error", "Fee rate must be at least 1 sat/vB.");
          }
          try {
            const preview = await api.buildFeeBump(id, value);
            session.lastResult = await api.signAndBroadcast(preview.psbt_id);
            navigate("result");
          } catch (e) {
            // A rate below the replacement rules is refused by the node; its
            // own wording is the most useful thing to show.
            alert.show("error", errorMessage(e));
          }
        }),
      { variant: "primary", block: true },
    );
    const relabel = () => {
      const label = bump.querySelector("span");
      if (label) label.textContent = `Bump to ${rate.value} sat/vB`;
    };
    rate.addEventListener("input", relabel);
    void (async () => {
      let suggested = suggestBumpRate(null);
      try {
        suggested = suggestBumpRate(await api.estimateFee());
        note.textContent = `1-block estimate ${suggested} sat/vB`;
      } catch {
        note.textContent = "Estimate unavailable — starting at 1 sat/vB";
      }
      rate.value = String(suggested);
      relabel();
    })();
    const sheet = card(
      el("div", { className: "m-bump-head" }, [sectionLabel("Bump fee"), note]),
      el("div", { className: "m-rate-row" }, [
        rate,
        el("span", { className: "m-rate-unit", text: "sat/vB" }),
      ]),
      bump,
    );
    sheet.classList.add("m-bump");
    return sheet;
  };

  void (async () => {
    try {
      const detail = await api.transaction(txid);
      if (!detail) {
        content.replaceChildren(alert.node);
        alert.show("warn", "This transaction is not in the wallet's history.");
        return;
      }
      paint(detail);
    } catch (e) {
      content.replaceChildren(alert.node);
      alert.show("error", errorMessage(e));
    }
  })();

  return host;
}
