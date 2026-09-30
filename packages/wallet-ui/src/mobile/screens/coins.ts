import { api } from "../../api";
import { navigate } from "../../router";
import { screenGuard } from "../../screen";
import { session } from "../../session";
import { errorMessage, type Utxo } from "../../types";
import {
  coinKey,
  coinsValue,
  freezeSwitch,
  redrawKeepingFocus,
  sendFrom,
  tickBox,
  tickInput,
} from "../../ui/coins";
import { banner, el, formatNumber, formatSats, sectionLabel } from "../../ui/dom";
import { shortOutpoint } from "../../ui/format";
import { icon } from "../../ui/icons";
import { body, button, card, header, lede, listCard, spacer } from "../ui";

/**
 * One coin as M13 draws it: the tick, or a lock once frozen; its value and
 * confirmations over its outpoint; and the Frozen switch. `ticked` is null for
 * a watch-only wallet, which sends nothing and so ticks nothing.
 */
function coinRow(
  u: Utxo,
  ticked: boolean | null,
  onTick: (u: Utxo, on: boolean) => void,
  onFreeze: (u: Utxo, frozen: boolean) => void,
): HTMLElement {
  const about = el("span", { className: "m-coin-main" }, [
    el("span", { className: "m-coin-line" }, [
      el("span", { className: "m-coin-value" }, [
        `${formatNumber(u.value)} `,
        el("span", { className: "m-coin-unit", text: "sat" }),
      ]),
      u.confirmations === null
        ? el("span", { className: "m-pending", text: "pending" })
        : el("span", { className: "m-coin-age", text: `${formatNumber(u.confirmations)} conf.` }),
    ]),
    el("span", { className: "m-coin-outpoint", text: shortOutpoint(u) }),
  ]);
  // The coin's text is part of the tick's label, so a thumb can tick it anywhere there.
  const pick =
    ticked === null
      ? about
      : el("label", { className: "m-coin-pick" }, [
          tickInput(u, ticked, (on) => onTick(u, on)),
          u.frozen ? el("span", { className: "m-coin-lock" }, [icon("lock", 18)]) : tickBox(16),
          about,
        ]);
  return el("div", { className: u.frozen ? "m-coin m-coin-frozen" : "m-coin" }, [
    pick,
    el("span", { className: "m-coin-freeze" }, [
      u.frozen ? el("span", { className: "m-coin-tag", text: "Frozen" }) : null,
      freezeSwitch(u, (frozen) => onFreeze(u, frozen)),
    ]),
  ]);
}

/**
 * M13, from Settings: every unspent output, to freeze or to choose for a send.
 * A frozen coin is dimmed and cannot be ticked. Send selected opens Send held
 * to the ticked coins; with none ticked it is not shown.
 */
export function renderCoins(): HTMLElement {
  const info = session.wallet;
  const host = el("main");
  if (!info) {
    navigate("setup");
    return host;
  }
  const onScreen = screenGuard();
  const alert = banner();

  // The ticks are this screen's own until Send selected hands them to Send. A
  // redraw after a freeze keeps those still unspent and unfrozen.
  let coins: Utxo[] = [];
  const ticked: Set<string> | null = info.is_watch_only ? null : new Set();
  const chosen = (): Utxo[] => coins.filter((u) => ticked?.has(coinKey(u)));

  const list = el("div", {}, [listCard(el("div", { className: "m-empty", text: "Loading…" }))]);
  const send = button("Send selected", () => sendFrom(chosen()), {
    variant: "primary",
    block: true,
  });
  send.hidden = true;

  const paintSend = (): void => {
    const picked = chosen();
    const n = picked.length;
    send.textContent = `Send selected (${formatNumber(n)} coin${n === 1 ? "" : "s"} · ${formatSats(coinsValue(picked))})`;
    send.hidden = n === 0;
  };

  const tick = (u: Utxo, on: boolean): void => {
    if (on) ticked?.add(coinKey(u));
    else ticked?.delete(coinKey(u));
    paintSend();
  };

  const show = (utxos: Utxo[]): void => {
    coins = utxos;
    if (ticked) {
      // A coin spent or frozen since it was ticked is not one to send from.
      const open = new Set(utxos.filter((u) => !u.frozen).map(coinKey));
      for (const key of ticked) if (!open.has(key)) ticked.delete(key);
    }
    let listed: HTMLElement;
    if (utxos.length === 0) {
      listed = listCard(el("div", { className: "m-empty", text: "No unspent coins." }));
    } else {
      const n = utxos.length;
      listed = card(
        el("div", { className: "m-coins-head" }, [
          sectionLabel(
            `${formatNumber(n)} coin${n === 1 ? "" : "s"} · ${formatSats(coinsValue(utxos))}`,
          ),
          sectionLabel("Freeze"),
        ]),
        ...utxos.map((u) =>
          coinRow(
            u,
            ticked ? ticked.has(coinKey(u)) : null,
            tick,
            (c, frozen) => void freeze(c, frozen),
          ),
        ),
      );
      listed.classList.add("m-coins");
    }
    redrawKeepingFocus(list, listed);
    paintSend();
  };

  const freeze = async (u: Utxo, frozen: boolean): Promise<void> => {
    alert.hide();
    try {
      await api.setFrozen({ txid: u.txid, vout: u.vout }, frozen);
      if (!onScreen()) return;
      const utxos = await api.listUtxos();
      if (onScreen()) show(utxos);
    } catch (e) {
      if (onScreen()) alert.show("error", errorMessage(e));
    }
  };

  host.append(
    header("Coins", { back: "settings" }),
    body(
      alert.node,
      lede(
        ticked
          ? "Tick coins to spend only those. A frozen coin stays out of every send until you unfreeze it."
          : "A frozen coin stays out of every send until you unfreeze it.",
      ),
      list,
      el("p", {
        className: "hint m-coins-hint",
        text: "Frozen coins also stay out of Max and of the spendable balance.",
      }),
      spacer(),
      ticked ? send : null,
    ),
  );

  void (async () => {
    try {
      const utxos = await api.listUtxos();
      if (onScreen()) show(utxos);
    } catch (e) {
      if (onScreen()) alert.show("error", errorMessage(e));
    }
  })();

  return host;
}
