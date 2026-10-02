import { api } from "../../api";
import { canPayForParent, isBumpable, suggestBumpRate, suggestPackageRate } from "../../feebump";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { redirect, sameWalletGuard, screenGuard } from "../../screen";
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
  type TxOutput,
} from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, formatNumber, kv, sectionLabel, textInput } from "../../ui/dom";
import {
  counted,
  feeLine,
  formatConfirmations,
  formatDateTime,
  formatRate,
  formatSats,
  outputRole,
  typeableRate,
} from "../../ui/format";
import { icon } from "../../ui/icons";
import { heldPreview } from "../../ui/preview";
import { estimateUnavailable, explorerFailed, FETCHING_ESTIMATE, whoseInputs } from "../../ui/text";
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

/**
 * Said under an output in a transaction's detail, in the words the desktop's
 * detail labels it with: an output of this wallet's on a receipt is
 * "received". Import PSBT says "to this wallet", since nothing is received yet.
 */
function detailNote(d: TxDetail, o: TxOutput): string | null {
  return outputRole(d, o) === "ours" ? "received" : outputNote(d, o);
}

export function renderTransaction(): HTMLElement {
  const onScreen = screenGuard();
  const sameWallet = sameWalletGuard();
  const info = session.wallet;
  const txid = current;
  if (!info || !txid) return redirect("dashboard");
  const host = el("main");

  const alert = banner();
  const content = body(alert.node, lede("Loading…"));
  host.appendChild(header("Transaction", { back: "dashboard" }));
  host.appendChild(content);

  // --- the preview this screen holds -----------------------------------------
  //
  // Speed up and Cancel each show a built preview before anything is signed,
  // and a transaction offers one or the other, so there is at most one
  // preview: dropped when it is replaced, when Cancel is called off and when
  // the screen goes. What it builds counts only while this screen is shown.
  const preview = heldPreview(alert);

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
    // Pending, as the pill above says: not a count of 0.
    const confirmations = pending
      ? formatConfirmations(null)
      : `${formatNumber(d.confirmations ?? 0)}${d.block_height === null ? "" : ` · block ${formatNumber(d.block_height)}`}`;
    const facts = listCard(item("Fee", fee, undefined), item("Confirmations", confirmations));

    const from = `${counted(d.inputs.length, "input")} · ${whoseInputs(d.inputs)}`;
    const flow = listCard(item("From", from));
    // Each output whole, as Import PSBT lists them: this is where a payee is checked.
    const outputs = card(
      sectionLabel(`Outputs · ${formatNumber(d.outputs.length)}`),
      ...d.outputs.map((o) =>
        ioLine(o.address ?? "script", `${formatSats(o.value_sat)}`, detailNote(d, o)),
      ),
    );
    outputs.classList.add("m-io-card");

    // Resolved before the button is offered, the way Result and the desktop
    // dashboard do it: on regtest there is no explorer, and a button that only
    // ever explains itself is worse than no button.
    const explorer = explorerUrl
      ? button(
          "Open in explorer",
          async () => {
            alert.hide();
            try {
              await platform().openUrl(explorerUrl);
            } catch (e) {
              alert.show("warn", explorerFailed(errorMessage(e)));
            }
          },
          { icon: "external" },
        )
      : null;
    // One per line, as on Sent: side by side, "Open in explorer" broke in two.
    const ident = card(
      sectionLabel("Transaction id"),
      el("span", { className: "m-mono-block", text: d.txid }),
      copyButton(() => d.txid, "Copy transaction id"),
      explorer,
    );

    const actions: HTMLElement[] = [];
    if (offer === "replace") {
      const bump = bumpCard(d.txid, d.fee_rate_sat_vb);
      actions.push(bump, cancelControl(d, bump));
    } else if (offer === "child") {
      actions.push(speedUpCard(d));
    }
    // Above the outputs and the Transaction id card, so an action shows
    // without scrolling (M11b): whole addresses make the outputs tall.
    content.replaceChildren(alert.node, hero, facts, flow, ...actions, outputs, ident);
  };

  const bumpCard = (id: string, originalRate: number | null): HTMLElement => {
    const rate = textInput({ value: "1", type: "number", mono: true, name: "bump_rate" });
    // The card's heading names the action, not the field.
    rate.setAttribute("aria-label", "Fee rate, in sat/vB");
    rate.min = "1";
    rate.max = String(MAX_FEE_RATE_SAT_VB);
    rate.step = "0.1";
    rate.setAttribute("inputmode", "decimal");
    const note = el("span", { className: "hint", text: FETCHING_ESTIMATE });
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
            const built = await api.buildFeeBump(id, value);
            session.lastResult = await api.signAndBroadcast(built.psbt_id);
            navigate("result");
          } catch (e) {
            // A rate below the replacement rules is refused by the node; its
            // own wording is the most useful thing to show.
            alert.show("error", errorMessage(e));
          }
        }),
      { variant: "primary", block: true },
    );
    let rateTouched = false;
    rate.addEventListener("input", () => {
      rateTouched = true;
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
        text = estimateUnavailable(suggested);
      }
      // The note is information either way, but the field belongs to whoever
      // typed in it: an estimate arriving after that is stale advice, not a
      // correction, and replacing the number would bump at a rate the user
      // never chose.
      note.textContent = text;
      if (rateTouched) return;
      rate.value = String(suggested);
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
      preview.drop();
      host.replaceChildren(trigger);
      folded.replaceWith(bump);
    };
    folded.addEventListener("click", close);

    // Signing used the preview up whether or not it went out, so after a
    // failure the card has nothing left to send; asking again builds another.
    const confirm = () => preview.send(onScreen, broadcastDone, close);

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
        const built = await preview.hold(
          () => api.buildCancel(d.txid, suggestBumpRate(estimate, d.fee_rate_sat_vb)),
          onScreen,
        );
        if (!built) return;
        const go = button("Cancel transaction", () => withBusy(go, confirm), {
          variant: "danger",
          block: true,
        });
        const sheet = card(
          sectionLabel("Cancel"),
          lede(
            `Replace it with a transaction that pays ${formatSats(built.change_sat)} back to this wallet. Fee ${formatSats(built.fee_sat)}.`,
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

    const note = el("span", { className: "hint", text: FETCHING_ESTIMATE });
    const custom = textInput({ type: "number", mono: true, name: "speedup_rate" });
    custom.min = "1";
    custom.max = String(MAX_FEE_RATE_SAT_VB);
    custom.step = "0.1";
    custom.setAttribute("inputmode", "decimal");
    custom.setAttribute("aria-label", "Rate for the two together, in sat/vB");
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
      preview.drop();
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
        // Rounded up to a tenth, as it is shown: found by cubic, 7.55 showed
        // "7.5 sat/vB" and built at 7.55.
        const at = typeableRate(typed);
        const problem =
          feeRateError(typed) ??
          (parentRate !== null && at <= parentRate
            ? `It pays ${formatRate(parentRate)} alone already; a child helps only above that.`
            : null);
        if (problem !== null) {
          customErr.textContent = problem;
          blank("—");
          return;
        }
        rate = at;
        shown = formatRate(at);
      } else if (estimate === undefined) {
        // Built once the estimate answers.
        note.textContent = FETCHING_ESTIMATE;
        blank("…");
        return;
      } else {
        const blocks = Number(choice);
        rate = suggestPackageRate(estimate, blocks, parentRate);
        shown = formatRate(rate);
        if (estimate === null) {
          note.textContent = estimateUnavailable(rate);
        } else if (rate > suggestPackageRate(estimate, blocks)) {
          // The estimate alone would offer a rate the transaction pays already.
          note.textContent = `Raised above the ${formatRate(parentRate ?? 0)} it pays alone`;
        } else {
          note.textContent = `${blocks}-block estimate ${shown}`;
        }
      }
      pays.textContent = `${shown} for the two together`;
      fee.textContent = "…";
      keep.textContent = "…";
      const at = rate;
      try {
        const built = await preview.hold(() => api.buildCpfp(d.txid, at), onScreen);
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

    // Nothing built to send — the last build failed, or is still running — or
    // signing used it up: build another, so what the button would send is on
    // screen again.
    const send = () => preview.send(onScreen, broadcastDone, refresh);
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
        text: "Spends this payment on to this wallet, with a fee that pulls the original into a block with it (CPFP).",
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
