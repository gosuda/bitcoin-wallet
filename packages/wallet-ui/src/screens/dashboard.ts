import QRCode from "qrcode";

import { formatAmount, parseAmount, type Unit } from "../amount";
import { api } from "../api";
import { headlineSat, pendingSat } from "../balance";
import { buildPaymentUri, qrPayload } from "../bip21";
import { canPayForParent, isBumpable, suggestBumpRate, suggestPackageRate } from "../feebump";
import { platform } from "../platform";
import { navigate } from "../router";
import { sameWalletGuard, screenGuard } from "../screen";
import { session } from "../session";
import {
  ADDRESS_TYPE_LABELS,
  type Balance,
  type BroadcastResult,
  errorMessage,
  FEE_TARGETS,
  type FeeEstimate,
  type FeeTarget,
  feeRateError,
  MAX_FEE_RATE_SAT_VB,
  NETWORK_LABELS,
  type TxDetail,
  type TxOutput,
  type TxPreview,
  type TxSummary,
  type Utxo,
} from "../types";
import { copyButton } from "../ui/clipboard";
import {
  coinKey,
  coinsValue,
  freezeSwitch,
  redrawKeepingFocus,
  sendFrom,
  shortOutpoint,
  tickBox,
  tickInput,
} from "../ui/coins";
import {
  append,
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

/** Both ends of an address, which is how 3b fits it beside the columns coin control adds. */
function shortAddress(address: string): string {
  return `${address.slice(0, 16)}…${address.slice(-6)}`;
}

/**
 * The Unspent outputs table (3b): a tick box chooses a coin for Send selected
 * and a switch freezes it; a frozen row is dimmed and cannot be ticked.
 * `ticked` is null for a watch-only wallet, which sends nothing and so has no
 * tick boxes.
 */
function utxoTable(
  utxos: readonly Utxo[],
  ticked: ReadonlySet<string> | null,
  onTick: (u: Utxo, on: boolean) => void,
  onFreeze: (u: Utxo, frozen: boolean) => void,
): HTMLElement {
  if (utxos.length === 0) {
    return el("p", { className: "empty", text: "No unspent outputs. Sync to refresh." });
  }
  const head = el("tr", {}, [
    ticked ? el("th", { className: "coin-pick" }) : null,
    el("th", { text: "Outpoint" }),
    el("th", { text: "Address" }),
    el("th", { className: "num", text: "Value (sat)" }),
    el("th", { className: "num", text: "Conf." }),
    el("th", { className: "num", text: "Frozen" }),
  ]);
  const body = el("tbody");
  for (const u of utxos) {
    const pending = u.confirmations === null;
    body.appendChild(
      el("tr", { className: u.frozen ? "coin-frozen" : "" }, [
        ticked
          ? el("td", { className: "coin-pick" }, [
              el("label", { className: "tick" }, [
                tickInput(u, ticked.has(coinKey(u)), (on) => onTick(u, on)),
                tickBox(12),
              ]),
            ])
          : null,
        el("td", {
          className: "mono",
          text: shortOutpoint(u),
          attrs: { title: `${u.txid}:${u.vout}` },
        }),
        el("td", {
          className: "mono muted",
          text: shortAddress(u.address),
          attrs: { title: u.address },
        }),
        el("td", { className: "num mono", text: formatNumber(u.value) }),
        el("td", {
          className: `num mono ${pending ? "muted" : ""}`.trim(),
          text: pending ? "pending" : String(u.confirmations),
        }),
        el("td", { className: "num" }, [
          el("span", { className: "coin-freeze" }, [
            u.frozen ? el("span", { className: "coin-tag" }, [icon("lock", 12), "Frozen"]) : null,
            freezeSwitch(u, (frozen) => onFreeze(u, frozen)),
          ]),
        ]),
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

/**
 * What an open row can do besides copy and link: replace our own unconfirmed
 * send (Bump fee or Cancel, both starting from `rate`), give a payment a
 * child (Speed up, priced from `estimate`), or nothing.
 */
type Offer =
  | { kind: "replace"; rate: number }
  | { kind: "child"; estimate: FeeEstimate | null }
  | { kind: "none" };

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
  const onScreen = screenGuard();
  const sameWallet = sameWalletGuard();

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
    append(stats, [
      stat("Confirmed", formatSats(b.confirmed)),
      stat("Pending", formatSats(pendingSat(b)), "muted"),
      b.immature > 0 ? stat("Immature", formatSats(b.immature), "muted") : null,
      // Counted in the headline and in neither stat above, so it is said here.
      b.frozen > 0 ? stat("Frozen", formatSats(b.frozen), "muted") : null,
    ]);
  };

  // --- coins: ticked for Send selected, or frozen (3b) -----------------------
  //
  // The ticks are this page's own until Send selected hands them to Send. A
  // redraw after a sync or a freeze keeps those still unspent and unfrozen.
  let coins: Utxo[] = [];
  const ticked: Set<string> | null = wallet.is_watch_only ? null : new Set();
  const chosen = (): Utxo[] => coins.filter((u) => ticked?.has(coinKey(u)));
  const sendSelectedBtn = button("Send selected", () => sendFrom(chosen()), "primary", "sm", {
    name: "arrow",
    trailing: true,
  });
  sendSelectedBtn.hidden = true;

  const paintCoinCount = (): void => {
    const frozen = coins.filter((u) => u.frozen).length;
    const picked = chosen();
    const parts = [`${formatNumber(coins.length)} output${coins.length === 1 ? "" : "s"}`];
    if (frozen > 0) parts.push(`${formatNumber(frozen)} frozen`);
    if (picked.length > 0) {
      parts.push(`${formatNumber(picked.length)} selected, ${formatSats(coinsValue(picked))}`);
    }
    utxoCount.textContent = parts.join(" · ");
    // With none ticked, a send chooses its coins on its own, as it always has.
    sendSelectedBtn.hidden = picked.length === 0;
  };

  const tick = (u: Utxo, on: boolean): void => {
    if (on) ticked?.add(coinKey(u));
    else ticked?.delete(coinKey(u));
    paintCoinCount();
  };

  const freeze = async (u: Utxo, frozen: boolean): Promise<void> => {
    alert.hide();
    try {
      await api.setFrozen({ txid: u.txid, vout: u.vout }, frozen);
      if (!onScreen()) return;
      // The coin's value moves between Frozen and the stat it was counted in.
      const [balance, utxos] = await Promise.all([api.getBalance(), api.listUtxos()]);
      if (!onScreen()) return;
      renderBalance(balance);
      renderUtxos(utxos);
    } catch (e) {
      if (onScreen()) alert.show("error", errorMessage(e));
    }
  };

  const renderUtxos = (utxos: Utxo[]) => {
    coins = utxos;
    if (ticked) {
      // A coin spent or frozen since it was ticked is not one to send from.
      const open = new Set(utxos.filter((u) => !u.frozen).map(coinKey));
      for (const key of ticked) if (!open.has(key)) ticked.delete(key);
    }
    redrawKeepingFocus(
      utxoBox,
      utxoTable(utxos, ticked, tick, (u, frozen) => void freeze(u, frozen)),
    );
    paintCoinCount();
  };

  // --- one transaction open at a time, in a row of its own under its tx -----
  let open: { row: HTMLTableRowElement; detail: HTMLTableRowElement; chevron: HTMLElement } | null =
    null;

  // --- the preview an open row holds -----------------------------------------
  //
  // Speed up and Cancel each show a built preview before anything is signed.
  // One row is open at a time and it offers one or the other, so there is at
  // most one preview: dropped when it is replaced, when its row closes, when
  // the history is redrawn under it and when the screen goes. `previewGen`
  // moves on with every drop, so a build still running then is discarded when
  // it lands instead of being offered.
  let heldPreview: TxPreview | null = null;
  let previewGen = 0;

  const dropPreview = (): void => {
    previewGen += 1;
    if (heldPreview) void api.discardTx(heldPreview.psbt_id);
    heldPreview = null;
  };

  /**
   * Builds the preview `ownerDetail`'s row offers, in place of any held
   * before. `null` when the row, the screen or a newer build moved on first;
   * a failure is thrown only while this build is still the one that counts.
   */
  const holdPreview = async (
    build: () => Promise<TxPreview>,
    ownerDetail: HTMLTableRowElement,
  ): Promise<TxPreview | null> => {
    dropPreview();
    const gen = previewGen;
    const counts = () => gen === previewGen && onScreen() && open?.detail === ownerDetail;
    let preview: TxPreview;
    try {
      preview = await build();
    } catch (e) {
      if (counts()) throw e;
      return null;
    }
    if (!counts()) {
      void api.discardTx(preview.psbt_id);
      return null;
    }
    heldPreview = preview;
    return preview;
  };

  /** Hands the held preview over to be signed, which uses it up either way. */
  const takePreview = (): TxPreview | null => {
    const preview = heldPreview;
    heldPreview = null;
    return preview;
  };

  const closeDetail = () => {
    if (!open) return;
    dropPreview();
    open.detail.remove();
    open.chevron.classList.remove("tx-chevron-open");
    open.row.setAttribute("aria-expanded", "false");
    open = null;
  };

  /**
   * After a broadcast from an open row. It went out; what is left is who
   * hears of it. If the session has since moved to a different wallet, this
   * result is not that wallet's to show: recording it here would leave a
   * stale txid sitting where the new wallet's Result screen would read it as
   * its own, so only a still-current wallet gets it recorded at all. From
   * there, steal the screen only if this row's detail is still the one open —
   * the user may have opened a different transaction's detail on this same
   * dashboard while the broadcast was in flight.
   */
  const broadcastDone = (
    result: BroadcastResult,
    ownerDetail: HTMLTableRowElement,
    what: string,
  ): void => {
    if (!sameWallet()) return;
    session.lastResult = result;
    if (!onScreen()) return;
    if (open?.detail === ownerDetail) {
      closeDetail();
      navigate("result");
    } else {
      // The row that started it is no longer the open detail, and
      // closeDetail/navigate would steal a screen the user has since moved on
      // from. Confirm it landed some other way, or a silent success invites a
      // retry that does it twice.
      alert.show("ok", `${what} broadcast: ${shortTxid(result.txid)}.`);
    }
  };

  const bumpInline = (
    txid: string,
    suggested: number,
    ownerDetail: HTMLTableRowElement,
  ): HTMLElement => {
    const rate = textInput({ value: String(suggested), type: "number", mono: true });
    rate.id = `bump-rate-${txid.slice(0, 8)}`;
    rate.min = "1";
    rate.max = String(MAX_FEE_RATE_SAT_VB);
    rate.step = "0.1";
    rate.classList.add("bump-rate");
    const bumpBtn = button(
      "Bump fee",
      () =>
        withBusy(bumpBtn, async () => {
          alert.hide();
          const value = Number(rate.value);
          const rateErr = feeRateError(value);
          if (rateErr) {
            alert.show("error", rateErr);
            return;
          }
          try {
            const preview = await api.buildFeeBump(txid, value);
            broadcastDone(await api.signAndBroadcast(preview.psbt_id), ownerDetail, "Fee bump");
          } catch (e) {
            // A rate below the replacement rules is refused by the node; the
            // node's own wording is the most useful thing to show.
            if (onScreen() && open?.detail === ownerDetail) alert.show("error", errorMessage(e));
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

  /**
   * Cancel: a replacement that pays everything back to this wallet, at a fee
   * that outbids the original — the core raises it to what BIP125 asks. It
   * asks first, with the card M11c draws filled in from the preview, and the
   * bump folds away until it has an answer.
   */
  const cancelButton = (
    txid: string,
    rate: number,
    ownerDetail: HTMLTableRowElement,
    bump: HTMLElement,
    slot: HTMLElement,
  ): HTMLButtonElement => {
    const fold = () => {
      slot.replaceChildren();
      bump.classList.remove("hidden");
    };
    const confirm = async (): Promise<void> => {
      const preview = takePreview();
      if (!preview) {
        fold();
        return;
      }
      alert.hide();
      try {
        broadcastDone(await api.signAndBroadcast(preview.psbt_id), ownerDetail, "Cancellation");
      } catch (e) {
        if (!onScreen() || open?.detail !== ownerDetail) return;
        // Signing used the preview up whether or not it went out, so the card
        // has nothing left to send; asking again builds another.
        fold();
        alert.show("error", errorMessage(e));
      }
    };
    const ask = async (): Promise<void> => {
      alert.hide();
      try {
        const preview = await holdPreview(() => api.buildCancel(txid, rate), ownerDetail);
        if (!preview) return;
        const yes = button("Cancel transaction", () => withBusy(yes, confirm), "danger", "sm");
        const keep = () => {
          dropPreview();
          fold();
        };
        slot.replaceChildren(
          el("div", { className: "tx-card tx-card-danger" }, [
            sectionLabel("Cancel"),
            el("span", {
              className: "muted",
              text: `Replace it with a transaction that pays ${formatSats(preview.change_sat)} back to your wallet. Fee ${formatSats(preview.fee_sat)}.`,
            }),
            el("div", { className: "actions actions-end" }, [
              button("Keep it", keep, "quiet", "sm"),
              yes,
            ]),
          ]),
        );
        bump.classList.add("hidden");
        yes.focus();
      } catch (e) {
        alert.show("error", errorMessage(e));
      }
    };
    const cancelBtn = button("Cancel", () => withBusy(cancelBtn, ask), "danger", "sm");
    return cancelBtn;
  };

  /**
   * Speed up: a child that spends this payment on to us, with a fee that
   * brings the two to the chosen rate, so the fee comes out of the payment.
   * The preview is built as soon as the box shows and again for each target,
   * and the button sends the one on screen.
   */
  const speedUpBox = (
    d: TxDetail,
    estimate: FeeEstimate | null,
    ownerDetail: HTMLTableRowElement,
  ): HTMLElement => {
    let target: `${FeeTarget}` = "1";
    const rateHint = el("span", { className: "hint" });
    const numbers = el("span", { className: "mono tx-card-numbers" });

    const rebuild = async (): Promise<void> => {
      const blocks = Number(target);
      const rate = suggestPackageRate(estimate, blocks, d.fee_rate_sat_vb);
      let why = "";
      if (estimate === null) {
        why = " · estimate unavailable";
      } else if (rate > suggestPackageRate(estimate, blocks)) {
        // The estimate alone would offer a rate the transaction pays already.
        why = ` · raised above the ${(d.fee_rate_sat_vb ?? 0).toFixed(1)} sat/vB it pays alone`;
      }
      rateHint.textContent = `${rate.toFixed(1)} sat/vB for the two together${why}`;
      numbers.textContent = "Working out the fee…";
      try {
        const built = await holdPreview(() => api.buildCpfp(d.txid, rate), ownerDetail);
        if (!built) return;
        // The child spends our coins from this payment and nothing else, so
        // they come to what it keeps plus its fee.
        numbers.textContent = `Fee ${formatSats(built.fee_sat)} · you keep ${formatNumber(built.change_sat)} of the ${formatSats(built.change_sat + built.fee_sat)}`;
      } catch (e) {
        numbers.textContent = "";
        alert.show("error", errorMessage(e));
      }
    };

    const send = async (): Promise<void> => {
      const built = takePreview();
      // Nothing built to send: the last build failed, or is still running.
      if (!built) {
        await rebuild();
        return;
      }
      alert.hide();
      try {
        broadcastDone(await api.signAndBroadcast(built.psbt_id), ownerDetail, "Speed-up");
      } catch (e) {
        if (!onScreen() || open?.detail !== ownerDetail) return;
        alert.show("error", errorMessage(e));
        // Signing used the preview up whether or not it went out; build
        // another, so what the button would send is on screen again.
        await rebuild();
      }
    };

    const targets = radioGroup(
      "speedup_target",
      FEE_TARGETS.map((t) => ({
        value: `${t}` as `${FeeTarget}`,
        label: `${t} block${t > 1 ? "s" : ""}`,
      })),
      target,
      (value) => {
        target = value;
        alert.hide();
        void rebuild();
      },
      { label: "Fee target" },
    );
    const speedBtn = button("Speed up", () => withBusy(speedBtn, send), "primary", "sm");
    speedBtn.classList.add("push-end");
    void rebuild();
    return el("div", { className: "tx-card" }, [
      el("div", { className: "tx-card-head" }, [
        sectionLabel("Speed up"),
        el("span", {
          className: "hint",
          text: "Spends this payment on to yourself, with a fee that pulls the original into a block with it (CPFP).",
        }),
      ]),
      el("div", { className: "tx-card-row" }, [targets, rateHint]),
      el("div", { className: "tx-card-row" }, [numbers, speedBtn]),
    ]);
  };

  const detailBox = (
    d: TxDetail,
    explorer: string | null,
    offer: Offer,
    ownerDetail: HTMLTableRowElement,
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
    const box = el("div", { className: "tx-detail-box" }, [kv(rows), actions]);
    if (offer.kind === "replace") {
      const bump = bumpInline(d.txid, offer.rate, ownerDetail);
      // Cancel's card opens under the actions, and folds the bump away.
      const slot = el("div", { className: "slot" });
      bump.appendChild(cancelButton(d.txid, offer.rate, ownerDetail, bump, slot));
      actions.appendChild(bump);
      box.appendChild(slot);
    } else if (offer.kind === "child") {
      box.appendChild(speedUpBox(d, offer.estimate, ownerDetail));
    }
    return box;
  };

  /**
   * Nothing can be signed without a key, and nothing confirmed needs speeding
   * up. Our own unconfirmed send is sped up by replacing it, or taken back; a
   * child is for what replacement cannot reach, a payment someone else sent
   * above all.
   */
  const offerFor = async (d: TxDetail): Promise<Offer> => {
    if (wallet.is_watch_only || d.confirmations !== null) return { kind: "none" };
    if (isBumpable(d)) {
      // Without an estimate the original's own rate still sets the floor.
      const estimate = await api.estimateFee().catch(() => null);
      return { kind: "replace", rate: suggestBumpRate(estimate, d.fee_rate_sat_vb) };
    }
    if (!canPayForParent(d, await api.listUtxos())) return { kind: "none" };
    return { kind: "child", estimate: await api.estimateFee().catch(() => null) };
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
        const offer = await offerFor(d);
        if (onScreen() && open?.detail === detail) {
          cell.replaceChildren(detailBox(d, explorer, offer, detail));
        }
      } catch (e) {
        // Only this row's own failure may close this row. A slow request for a
        // transaction the user has already navigated past would otherwise shut
        // the detail they opened afterwards and show them the wrong error.
        if (onScreen() && open?.detail === detail) {
          alert.show("error", errorMessage(e));
          closeDetail();
        }
      }
    })();
  };

  const renderTxs = (txs: TxSummary[]) => {
    // The detail belongs to a row that is about to be replaced, and so does
    // any preview it held.
    dropPreview();
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
    if (!onScreen()) return;
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
      // A wallet swap while this was in flight must not stamp the new
      // wallet's session with a sync that was never for it.
      if (!onScreen()) return;
      session.lastSyncedAt = new Date();
      autoSyncFailed = false;
      renderBalance(balance);
      const [utxos, txs] = await Promise.all([api.listUtxos(), api.listTransactions()]);
      if (!onScreen()) return;
      renderUtxos(utxos);
      renderTxs(txs);
      renderSynced();
    } catch (e) {
      if (!onScreen()) return;
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
  });
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
  if (wallet.is_ranged) {
    const newAddressBtn = button(
      "New address",
      () =>
        withBusy(newAddressBtn, async () => {
          alert.hide();
          try {
            receiving = await api.newAddress();
            if (!onScreen()) return;
            addressBox.textContent = receiving;
            addressBox.setAttribute("title", receiving);
            await paintQr();
          } catch (e) {
            if (onScreen()) alert.show("error", errorMessage(e));
          }
        }),
      "default",
      "md",
      { name: "plus" },
    );
    addressActions.appendChild(newAddressBtn);
  }

  renderBalance({ confirmed: 0, trusted_pending: 0, untrusted_pending: 0, immature: 0, frozen: 0 });
  renderSynced();
  utxoBox.appendChild(el("p", { className: "empty", text: "Loading…" }));
  txBox.appendChild(el("p", { className: "empty", text: "Loading…" }));
  void refreshLocal().catch((e: unknown) => {
    if (onScreen()) alert.show("error", errorMessage(e));
  });
  void paintQr();

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
      el("div", { className: "card-head" }, [
        sectionLabel("Unspent outputs"),
        el("div", { className: "card-head-end" }, [utxoCount, ticked ? sendSelectedBtn : null]),
      ]),
      utxoBox,
      el("p", {
        className: "hint",
        text: "A frozen output stays out of every send, of Max and of the spendable balance until it is unfrozen.",
      }),
    ]),
    el("section", { className: "card" }, [
      el("div", { className: "card-head" }, [sectionLabel("Transactions"), txCount]),
      txBox,
    ]),
    // Rescan and the public keys are in Settings.
    el("div", { className: "actions actions-end" }, [closeBtn]),
  ]);

  // Screens are rebuilt on every navigation, so a preview an open row still
  // holds when this one goes away is unreachable, stranded in the core's
  // pending map.
  const discardOnLeave = (): void => {
    dropPreview();
    window.removeEventListener("hashchange", discardOnLeave);
  };
  window.addEventListener("hashchange", discardOnLeave);

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
