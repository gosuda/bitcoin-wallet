/**
 * Coin control as both shells show it: the desktop's Unspent outputs card
 * (3b) and the phone's Coins screen (M13). A switch freezes a coin; a tick box
 * chooses it for Send selected, which hands the ticked coins to Send through
 * the session. Send takes them as it opens, so they last one send: sent, or
 * left without sending, the next send chooses its coins on its own again.
 */

import { navigate } from "../router";
import { session } from "../session";
import type { CoinId, Utxo } from "../types";
import { el, formatSats } from "./dom";
import { shortOutpoint } from "./format";
import { icon } from "./icons";

/** What Send offers for handing the choice of coins back to the wallet. */
export const LET_WALLET_CHOOSE = "Let the wallet choose";

/** A coin's name among the ticked ones. */
export function coinKey(coin: CoinId): string {
  return `${coin.txid}:${coin.vout}`;
}

export function coinsValue(coins: readonly Utxo[]): number {
  return coins.reduce((sum, coin) => sum + coin.value, 0);
}

/** What a build is held to: exactly these coins, or none named when the wallet chooses. */
export function heldTo(coins: readonly Utxo[] | null): CoinId[] | undefined {
  return coins?.map(({ txid, vout }) => ({ txid, vout }));
}

/** Send's line for a send held to chosen coins. */
export function payingFrom(coins: readonly Utxo[]): string {
  const n = coins.length;
  return `Paying from ${n} chosen coin${n === 1 ? "" : "s"} · ${formatSats(coinsValue(coins))}`;
}

/** Send selected: opens Send held to `coins`. */
export function sendFrom(coins: readonly Utxo[]): void {
  session.chosenCoins = coins;
  navigate("send");
}

/**
 * The coins Send selected handed over, or null. Taking them clears the
 * session, so only the Send that opens next is held to them.
 */
export function takeChosenCoins(): readonly Utxo[] | null {
  const coins = session.chosenCoins;
  session.chosenCoins = null;
  return coins !== null && coins.length > 0 ? coins : null;
}

/**
 * A coin's tick: a real checkbox, kept in the tab order to drive `:checked`,
 * with `tickBox` right after it as its skin. A frozen coin cannot be ticked.
 */
export function tickInput(
  coin: Utxo,
  ticked: boolean,
  onChange: (ticked: boolean) => void,
): HTMLInputElement {
  const input = el("input", {
    className: "tick-input",
    attrs: {
      type: "checkbox",
      "aria-label": `Choose ${shortOutpoint(coin)}, ${formatSats(coin.value)}`,
      "data-coin": coinKey(coin),
    },
  });
  input.checked = ticked && !coin.frozen;
  input.disabled = coin.frozen;
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

/** The box a tick is drawn in; its check shows only while ticked. */
export function tickBox(size: number): HTMLElement {
  return el("span", { className: "tick-box", attrs: { "aria-hidden": "true" } }, [
    icon("check", size),
  ]);
}

/**
 * The Frozen switch: on while the coin is frozen. A press asks for the state
 * the switch does not show, so pressing twice before the redraw asks for the
 * same thing twice rather than undoing it.
 */
export function freezeSwitch(coin: Utxo, onToggle: (frozen: boolean) => void): HTMLButtonElement {
  return el("button", {
    className: "switch",
    attrs: {
      type: "button",
      role: "switch",
      "aria-checked": String(coin.frozen),
      "aria-label": `Freeze ${shortOutpoint(coin)}`,
      "data-coin": coinKey(coin),
    },
    on: { click: () => onToggle(!coin.frozen) },
  });
}

/**
 * Shows `next` in `host` in place of what was there, keeping keyboard focus
 * on the same coin's tick or switch. A freeze or a sync redraws every coin,
 * and focus would otherwise fall back to the page after each press.
 */
export function redrawKeepingFocus(host: HTMLElement, next: Node): void {
  const active = document.activeElement;
  let control: string | null = null;
  if (active instanceof HTMLElement && host.contains(active) && active.dataset.coin) {
    control = `${active.tagName.toLowerCase()}[data-coin="${active.dataset.coin}"]`;
  }
  host.replaceChildren(next);
  if (control) host.querySelector<HTMLElement>(control)?.focus();
}
