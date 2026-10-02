/**
 * What Setup, Settings and Unlock do the same way on both shells: save the
 * chain settings, rescan, and forget the wallet remembered on this device.
 * Each shell draws its own controls around them.
 */

import { api, canUnlockHere } from "../api";
import { headlineSat } from "../balance";
import { navigate, type Route } from "../router";
import { session } from "../session";
import { type AddressType, type AppConfig, errorMessage, type Network } from "../types";
import { type Banner, button, el, withBusy } from "./dom";
import { formatSats } from "./format";
import { SERVER_REQUIRED } from "./text";

/** Setup's Continue: saves the settings chosen, then opens Unlock or Key. */
export async function saveSetup(
  alert: Banner,
  network: Network,
  url: string,
  addressType: AddressType,
): Promise<void> {
  alert.hide();
  const trimmed = url.trim();
  if (!trimmed) {
    // Saving it instead would only surface as a backend error when a wallet
    // is opened, several screens later.
    alert.show("error", SERVER_REQUIRED);
    return;
  }
  const config: AppConfig = {
    network,
    backend: { kind: "esplora", url: trimmed },
    address_type: addressType,
  };
  try {
    await api.setConfig(config);
    session.config = config;
    navigate(canUnlockHere() ? "unlock" : "key");
  } catch (e) {
    alert.show("error", errorMessage(e));
  }
}

/**
 * Rescan, at the gap chosen when it was asked for, which the banner names: the
 * gap chips stay live while it runs.
 */
export async function rescanAt(gap: string, alert: Banner, onScreen: () => boolean): Promise<void> {
  alert.hide();
  try {
    const balance = await api.rescan(Number(gap));
    if (!onScreen()) return;
    session.lastSyncedAt = new Date();
    alert.show(
      "ok",
      `Rescanned with a gap of ${gap}: ${formatSats(headlineSat(balance))} in this wallet.`,
    );
  } catch (e) {
    if (onScreen()) alert.show("error", errorMessage(e));
  }
}

/**
 * Deletes the saved key, the local history and the remembered record, then
 * opens `next`. A failure is said in the banner, and `failed` runs after it.
 */
export async function forgetThisWallet(
  alert: Banner,
  next: Route,
  failed?: () => void,
): Promise<void> {
  alert.hide();
  try {
    await api.forgetWallet();
    session.remembered = null;
    navigate(next);
  } catch (e) {
    alert.show("error", errorMessage(e));
    failed?.();
  }
}

/**
 * The desktop's second step for Forget, in `slot`: `warning`, then Keep it or
 * Delete it. Unlock closes it again when the delete fails (`closeOnFail`);
 * Settings leaves it open.
 */
export function askForget(
  slot: HTMLElement,
  trigger: HTMLElement | null,
  warning: string,
  alert: Banner,
  closeOnFail: boolean,
): void {
  // Focus goes back to the trigger: the button that had it is gone, and a
  // keyboard or screen reader was left at the page. Found by cubic.
  const close = (): void => {
    slot.replaceChildren();
    trigger?.focus();
  };
  const yes = button(
    "Delete it",
    () => withBusy(yes, () => forgetThisWallet(alert, "key", closeOnFail ? close : undefined)),
    "danger",
  );
  // Read out with the button, which alone says only "Delete it".
  yes.setAttribute("aria-describedby", "forget-warning");
  slot.replaceChildren(
    el("section", { className: "card danger-card" }, [
      el("span", { className: "muted", text: warning, attrs: { id: "forget-warning" } }),
      el("div", { className: "actions actions-end" }, [button("Keep it", close, "quiet"), yes]),
    ]),
  );
  yes.focus();
}
