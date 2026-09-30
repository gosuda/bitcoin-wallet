import { api } from "../../api";
import { canPayForParent, isBumpable, suggestBumpRate, suggestPackageRate } from "../../feebump";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { sameWalletGuard, screenGuard } from "../../screen";
import { session } from "../../session";
import {
  type BroadcastResult,
  errorMessage,
  FEE_TARGETS,
  type FeeEstimate,
  type FeeTarget,
  feeRateError,
  MAX_FEE_RATE_SAT_VB,
  type TxDetail,
  type TxPreview,
} from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, formatNumber, kv, sectionLabel, textInput } from "../../ui/dom";
import {
  feeLine,
  formatConfirmations,
  formatDateTime,
  formatRate,
  formatSats,
} from "../../ui/format";
import { icon } from "../../ui/icons";
import {
  body,
  button,
  card,
  chips,
  header,
  ioLine,
  item,
  lede,
  listCard,
  outputNote,
  row,
  withBusy,
} from "../ui";

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

/**
 * What the screen offers besides copy and link: replace our own unconfirmed
 * send (Bump fee or Cancel), give a payment a child (Speed up), or nothing.
 */
type Offer = "replace" | "child" | "none";

type SpeedChoice = `${FeeTarget}` | "custom";

export function renderTransaction(): HTMLElement {
  const onScreen = screenGuard();
  const sameWallet = sameWalletGuard();
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

  // --- the preview this screen holds -----------------------------------------
  //
  // Speed up and Cancel each show a built preview before anything is signed,
  // and a transaction offers one or the other, so there is at most one
  // preview: dropped when it is replaced, when Cancel is called off and when
  // the screen goes. `previewGen` moves on with every drop, so a build still
  // running then is discarded when it lands instead of being offered.
  let heldPreview: TxPreview | null = null;
  let previewGen = 0;

  const dropPreview = (): void => {
    previewGen += 1;
    if (heldPreview) void api.discardTx(heldPreview.psbt_id);
    heldPreview = null;
  };

  /**
   * Builds the preview the screen offers, in place of any held before. `null`
   * when the screen or a newer build moved on first; a failure is thrown only
   * while this build is still the one that counts.
   */
  const holdPreview = async (build: () => Promise<TxPreview>): Promise<TxPreview | null> => {
    dropPreview();
    const gen = previewGen;
    const counts = () => gen === previewGen && onScreen();
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

  /**
   * After a broadcast from this screen. It went out, so it is recorded for
   * this wallet whichever screen is on top by now — never for another wallet,
   * whose Result screen would read it as its own — and shown only while this
   * screen is still the one open.
   */
  const broadcastDone = (result: BroadcastResult): void => {
    if (!sameWallet()) return;
    session.lastResult = result;
    if (onScreen()) navigate("result");
  };

  const paint = (d: TxDetail, explorerUrl: string | null, offer: Offer): void => {
    const incoming = d.net_sat >= 0;
    const dot = el("span", { className: "m-dirdot" }, [icon(incoming ? "down" : "up", 22)]);
    dot.classList.add(incoming ? "m-tx-in" : "m-tx-out");
    const pending = d.confirmations === null;
    const status = el("span", { className: pending ? "pill m-pill-pending" : "pill" }, [
      el("span", { className: "pill-dot" }),
      pending
        ? `Pending${d.timestamp === null ? "" : ` · seen ${formatDateTime(d.timestamp)}`}`
        : `${formatConfirmations(d.confirmations)}${
            d.timestamp === null ? "" : ` · ${formatDateTime(d.timestamp)}`
          }`,
    ]);
    const hero = card(
      dot,
      // Money in is green here as in both lists.
      el("span", { className: incoming ? "m-hero m-tx-amount m-tx-in" : "m-hero m-tx-amount" }, [
        `${incoming ? "+" : "−"}${formatNumber(Math.abs(d.net_sat))} `,
        el("span", { className: "m-tx-unit", text: "sat" }),
      ]),
      status,
    );
    hero.classList.add("m-tx-hero");

    const fee = feeLine(d.fee_sat, d.vsize, d.fee_rate_sat_vb);
    const confirmations = pending
      ? "0 — in the mempool"
      : `${formatNumber(d.confirmations ?? 0)}${d.block_height === null ? "" : ` · block ${formatNumber(d.block_height)}`}`;
    const facts = listCard(item("Fee", fee, undefined), item("Confirmations", confirmations));

    const ownInputs = d.inputs.filter((i) => i.ours).length;
    const from = `${d.inputs.length} input${d.inputs.length === 1 ? "" : "s"}${
      ownInputs === d.inputs.length ? " · yours" : ownInputs > 0 ? ` · ${ownInputs} yours` : ""
    }`;
    const flow = listCard(item("From", from));
    // Each output whole, as Import PSBT lists them: this is where a payee is checked.
    const outputs = card(
      sectionLabel(`Outputs · ${formatNumber(d.outputs.length)}`),
      ...d.outputs.map((o) =>
        ioLine(o.address ?? "script", `${formatSats(o.value_sat)}`, outputNote(d, o)),
      ),
    );
    outputs.classList.add("m-io-card");

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

    const actions: HTMLElement[] = [];
    if (offer === "replace") {
      const bump = bumpCard(d.txid, d.fee_rate_sat_vb);
      actions.push(bump, cancelControl(d, bump));
    } else if (offer === "child") {
      actions.push(speedUpCard(d));
    }
    // Above the Transaction id card, so an action shows without scrolling (M11b).
    content.replaceChildren(alert.node, hero, facts, flow, outputs, ...actions, ident);
  };

  const bumpCard = (id: string, originalRate: number | null): HTMLElement => {
    const rate = textInput({ value: "1", type: "number", mono: true, name: "bump_rate" });
    rate.min = "1";
    rate.max = String(MAX_FEE_RATE_SAT_VB);
    rate.step = "0.1";
    rate.setAttribute("inputmode", "decimal");
    const note = el("span", { className: "hint", text: "Fetching the 1-block estimate…" });
    const bump = button(
      "Bump fee",
      () =>
        withBusy(bump, async () => {
          alert.hide();
          const value = Number(rate.value);
          const rateErr = feeRateError(value);
          if (rateErr) {
            return alert.show("error", rateErr);
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
        text = `1-block estimate ${formatRate(suggested)}`;
      } catch {
        // Name the rate actually prefilled: with the original's rate known,
        // the floor is above 1 sat/vB and saying otherwise misreports the field.
        text = `Estimate unavailable — starting at ${formatRate(suggested)}`;
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

  /**
   * Cancel (M11c): a replacement that pays everything back to this wallet, at
   * a fee that outbids the original — the core raises it to what BIP125 asks.
   * Two taps, like Forget: the first builds the preview the card shows, the
   * second sends it. Bump fee folds away while the card is open, and opening
   * it again calls the cancel off.
   */
  const cancelControl = (d: TxDetail, bump: HTMLElement): HTMLElement => {
    const host = el("div");
    const folded = el(
      "button",
      { className: "m-card m-fold", attrs: { type: "button", "aria-expanded": "false" } },
      [
        sectionLabel("Bump fee"),
        el("span", { className: "m-fold-hint" }, [
          el("span", { className: "hint", text: "Pay more to confirm sooner" }),
          el("span", { className: "m-fold-chev" }, [icon("chevron", 17)]),
        ]),
      ],
    );

    /** Back to Bump fee and the Cancel button, with nothing held. */
    const close = (): void => {
      dropPreview();
      host.replaceChildren(trigger);
      folded.replaceWith(bump);
    };
    folded.addEventListener("click", close);

    const confirm = async (): Promise<void> => {
      const built = takePreview();
      if (!built) {
        close();
        return;
      }
      alert.hide();
      try {
        broadcastDone(await api.signAndBroadcast(built.psbt_id));
      } catch (e) {
        if (!onScreen()) return;
        // Signing used the preview up whether or not it went out, so the card
        // has nothing left to send; asking again builds another.
        close();
        alert.show("error", errorMessage(e));
      }
    };

    const ask = async (): Promise<void> => {
      alert.hide();
      let estimate: FeeEstimate | null = null;
      try {
        estimate = await api.estimateFee();
      } catch {
        // The original's own rate still sets the floor.
      }
      if (!onScreen()) return;
      try {
        const built = await holdPreview(() =>
          api.buildCancel(d.txid, suggestBumpRate(estimate, d.fee_rate_sat_vb)),
        );
        if (!built) return;
        const go = button("Cancel transaction", () => withBusy(go, confirm), {
          variant: "danger",
          block: true,
        });
        const sheet = card(
          sectionLabel("Cancel"),
          lede(
            `Replace it with a transaction that pays ${formatSats(built.change_sat)} back to your wallet. Fee ${formatSats(built.fee_sat)}.`,
          ),
          go,
          button("Keep it", close, { variant: "quiet" }),
        );
        sheet.classList.add("m-confirm", "m-cancel");
        host.replaceChildren(sheet);
        bump.replaceWith(folded);
      } catch (e) {
        alert.show("error", errorMessage(e));
      }
    };

    const trigger = button("Cancel", () => withBusy(trigger, ask), {
      variant: "danger",
      block: true,
    });
    host.appendChild(trigger);
    return host;
  };

  /**
   * Speed up (M11b): a child that spends this payment on to us, with a fee
   * that brings the two to the chosen rate, so the fee comes out of the
   * payment. The preview is built as soon as the card shows and again for
   * each choice, and the button sends the one on screen.
   */
  const speedUpCard = (d: TxDetail): HTMLElement => {
    const parentRate = d.fee_rate_sat_vb;
    // `undefined` until the estimate answers, `null` if it could not.
    let estimate: FeeEstimate | null | undefined;
    // What the last build asked for; Custom starts from it.
    let rate = suggestPackageRate(null, 1, parentRate);

    const note = el("span", { className: "hint", text: "Fetching the estimate…" });
    const custom = textInput({ type: "number", mono: true, name: "speedup_rate" });
    custom.min = "1";
    custom.max = String(MAX_FEE_RATE_SAT_VB);
    custom.step = "0.1";
    custom.setAttribute("inputmode", "decimal");
    custom.setAttribute("aria-label", "Rate for both, in sat/vB");
    const customRow = el("div", { className: "m-rate-row" }, [
      custom,
      el("span", { className: "m-rate-unit", text: "sat/vB" }),
    ]);
    // Holds the rate field only while Custom is chosen.
    const customSlot = el("div", { className: "slot" });
    const customErr = el("span", { className: "m-err", attrs: { role: "status" } });
    const fee = el("span", { className: "mono" });
    const pays = el("span", { className: "mono" });
    const keep = el("span", { className: "mono" });
    const numbers = kv([
      ["Fee", fee],
      ["Rate", pays],
      ["You keep", keep],
    ]);
    numbers.classList.add("m-kv");

    /** Nothing on screen that could be sent, yet or at all. */
    const blank = (mark: string): void => {
      dropPreview();
      fee.textContent = mark;
      pays.textContent = mark;
      keep.textContent = mark;
    };

    /** Works out the rate the choice stands for and builds at it, or says why not. */
    const refresh = async (): Promise<void> => {
      customErr.textContent = "";
      const choice = target.value();
      let shown: string;
      if (choice === "custom") {
        note.textContent = "Your rate";
        const typed = Number(custom.value);
        const problem =
          feeRateError(typed) ??
          (parentRate !== null && typed <= parentRate
            ? `It pays ${formatRate(parentRate)} alone already; a child helps only above that.`
            : null);
        if (problem !== null) {
          customErr.textContent = problem;
          blank("—");
          return;
        }
        rate = typed;
        shown = formatRate(typed);
      } else if (estimate === undefined) {
        // Built once the estimate answers.
        note.textContent = "Fetching the estimate…";
        blank("…");
        return;
      } else {
        const blocks = Number(choice);
        rate = suggestPackageRate(estimate, blocks, parentRate);
        shown = formatRate(rate);
        if (estimate === null) {
          note.textContent = `Estimate unavailable — starting at ${shown}`;
        } else if (rate > suggestPackageRate(estimate, blocks)) {
          // The estimate alone would offer a rate the transaction pays already.
          note.textContent = `Raised above the ${formatRate(parentRate ?? 0)} it pays alone`;
        } else {
          note.textContent = `${blocks}-block estimate ${shown}`;
        }
      }
      pays.textContent = `${shown} for both`;
      fee.textContent = "…";
      keep.textContent = "…";
      const at = rate;
      try {
        const built = await holdPreview(() => api.buildCpfp(d.txid, at));
        if (!built) return;
        fee.textContent = `${formatSats(built.fee_sat)}`;
        // The child spends our coins from this payment and nothing else, so
        // they come to what it keeps plus its fee.
        keep.textContent = `${formatNumber(built.change_sat)} of ${formatSats(built.change_sat + built.fee_sat)}`;
      } catch (e) {
        fee.textContent = "—";
        keep.textContent = "—";
        alert.show("error", errorMessage(e));
      }
    };

    const target = chips<SpeedChoice>(
      [
        ...FEE_TARGETS.map((t) => ({
          value: `${t}` as SpeedChoice,
          label: `${t} block${t > 1 ? "s" : ""}`,
        })),
        { value: "custom", label: "Custom" },
      ],
      "1",
      (choice) => {
        alert.hide();
        if (choice === "custom") {
          // Starts from the rate on screen, as Send's Custom does.
          custom.value = String(rate);
          customSlot.replaceChildren(customRow);
        } else {
          customSlot.replaceChildren();
        }
        void refresh();
      },
      { tight: true, label: "Fee target" },
    );
    custom.addEventListener("input", () => void refresh());

    const send = async (): Promise<void> => {
      const built = takePreview();
      // Nothing built to send: the last build failed, or is still running.
      if (!built) {
        await refresh();
        return;
      }
      alert.hide();
      try {
        broadcastDone(await api.signAndBroadcast(built.psbt_id));
      } catch (e) {
        if (!onScreen()) return;
        alert.show("error", errorMessage(e));
        // Signing used the preview up whether or not it went out; build
        // another, so what the button would send is on screen again.
        await refresh();
      }
    };
    const go = button("Speed up", () => withBusy(go, send), { variant: "primary", block: true });

    void refresh();
    void (async () => {
      try {
        estimate = await api.estimateFee();
      } catch {
        estimate = null;
      }
      // A rate typed into Custom meanwhile stands; the estimate is for the chips.
      if (onScreen() && target.value() !== "custom") await refresh();
    })();

    const sheet = card(
      el("div", { className: "m-bump-head" }, [sectionLabel("Speed up"), note]),
      el("p", {
        className: "m-card-text",
        text: "Spends this payment on to yourself, with a fee that pulls the original into a block with it (CPFP).",
      }),
      target.node,
      customSlot,
      customErr,
      numbers,
      go,
    );
    // M11b frames it exactly as M11 frames Bump fee.
    sheet.classList.add("m-bump");
    return sheet;
  };

  /**
   * Nothing can be signed without a key, and nothing confirmed needs speeding
   * up. Our own unconfirmed send is sped up by replacing it, or taken back; a
   * child is for what replacement cannot reach, a payment someone else sent
   * above all.
   */
  const offerFor = async (d: TxDetail): Promise<Offer> => {
    if (info.is_watch_only || d.confirmations !== null) return "none";
    if (isBumpable(d)) return "replace";
    return canPayForParent(d, await api.listUtxos()) ? "child" : "none";
  };

  // Screens are rebuilt on every navigation, so a preview still held when
  // this one goes away is unreachable, stranded in the core's pending map.
  const discardOnLeave = (): void => {
    dropPreview();
    window.removeEventListener("hashchange", discardOnLeave);
  };
  window.addEventListener("hashchange", discardOnLeave);

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
      const offer = await offerFor(detail);
      if (!onScreen()) return;
      paint(detail, explorerUrl, offer);
    } catch (e) {
      content.replaceChildren(alert.node);
      alert.show("error", errorMessage(e));
    }
  })();

  return host;
}
