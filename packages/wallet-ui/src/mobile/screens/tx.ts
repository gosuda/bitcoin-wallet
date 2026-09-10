import { api } from "../../api";
import { suggestBumpRate } from "../../feebump";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { screenGuard } from "../../screen";
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
  const onScreen = screenGuard();
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

  const paint = (d: TxDetail, explorerUrl: string | null): void => {
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

    // Resolved before the button is offered, the way Result and the desktop
    // dashboard do it: on regtest there is no explorer, and a button that only
    // ever explains itself is worse than no button.
    const explorer = explorerUrl
      ? button(
          "Explorer",
          async () => {
            alert.hide();
            try {
              await platform().openUrl(explorerUrl);
            } catch (e) {
              alert.show("warn", errorMessage(e));
            }
          },
          { icon: "external" },
        )
      : null;
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
      ...(bumpable ? [bumpCard(d.txid, d.fee_rate_sat_vb)] : []),
    );
  };

  const bumpCard = (id: string, originalRate: number | null): HTMLElement => {
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
    let rateTouched = false;
    rate.addEventListener("input", () => {
      rateTouched = true;
      relabel();
    });
    void (async () => {
      let suggested = suggestBumpRate(null, originalRate);
      let text: string;
      try {
        suggested = suggestBumpRate(await api.estimateFee(), originalRate);
        text = `1-block estimate ${suggested} sat/vB`;
      } catch {
        // Name the rate actually prefilled: with the original's rate known,
        // the floor is above 1 sat/vB and saying otherwise misreports the field.
        text = `Estimate unavailable — starting at ${suggested} sat/vB`;
      }
      // The note is information either way, but the field belongs to whoever
      // typed in it: an estimate arriving after that is stale advice, not a
      // correction, and replacing the number would bump at a rate the user
      // never chose.
      note.textContent = text;
      if (rateTouched) return;
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
      // Asked for once, here, so the button below is only built when there is
      // somewhere for it to go.
      const explorerUrl = await api.explorerUrl(detail.txid).catch(() => null);
      if (!onScreen()) return;
      paint(detail, explorerUrl);
    } catch (e) {
      content.replaceChildren(alert.node);
      alert.show("error", errorMessage(e));
    }
  })();

  return host;
}
