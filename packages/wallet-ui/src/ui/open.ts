/**
 * Opening a wallet the user entered, the same on both shells' Create, Restore
 * and Key: each screen checks what it was given, then opens through here.
 */

import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import type { AppConfig } from "../types";
import type { Banner } from "./dom";
import type { RememberControl } from "./remember";
import type { HistoryReset } from "./reset";
import type { Wipeable } from "./words";

/** What an open uses of the screen it is pressed on. */
export interface Door {
  cfg: AppConfig;
  alert: Banner;
  offer: HistoryReset;
  /** The screen's `routeGuard`: the open itself sets `session.wallet`. */
  onScreen: () => boolean;
  remember: RememberControl;
  /** The secret fields, emptied once the wallet is open; `also` runs after. */
  fields: () => Iterable<Wipeable>;
  also?: () => void;
}

/**
 * Opens the wallet for `secret`, through the api's history reset when `reset`
 * is set. Nothing is remembered without a confirmed app password, and the box
 * is read once, as it stays live across the await; the session's record is
 * the open's, and only when it remembered. The wallet is open once this
 * returns, whatever screen is up by then, but only a screen still shown moves
 * on to it, or offers a reset for a failure, which runs `again`.
 */
export async function openAndEnter(
  secret: string,
  passphrase: string | undefined,
  { cfg, alert, offer, onScreen, remember, fields, also }: Door,
  reset: boolean,
  again: () => Promise<void>,
): Promise<void> {
  alert.hide();
  if (!remember.ready()) return;
  const willRemember = remember.checked();
  try {
    const open = reset ? api.resetHistoryAndOpen : api.openWallet;
    const info = await open(
      secret,
      cfg.address_type,
      willRemember,
      passphrase,
      remember.appPassword(),
    );
    for (const field of fields()) field.value = "";
    also?.();
    if (willRemember) session.remembered = info;
    if (onScreen()) navigate("dashboard");
  } catch (e) {
    if (onScreen()) offer.report(e, again);
  }
}
