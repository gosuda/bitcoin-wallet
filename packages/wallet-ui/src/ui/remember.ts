import { platform } from "../platform";
import { checkbox, el } from "./dom";

export const KEYCHAIN_NAME = navigator.platform.startsWith("Mac")
  ? "macOS Keychain"
  : "OS keychain";

/** Copy for shells that cannot keep a key past the session. */
export const NO_KEYSTORE_HINT = "This browser cannot store your key; it is kept for this tab only.";

export interface RememberControl {
  /** The checkbox, or an empty node where the shell has no key store. */
  readonly node: HTMLElement;
  /** Whether the user asked to remember. Always false without a key store. */
  checked(): boolean;
}

/**
 * "Remember on this device", offered only where a key store exists.
 *
 * Where it does not, the control renders nothing rather than a box that would
 * be silently ignored — `checked()` is then false and no key is ever saved.
 */
export function rememberCheckbox(): RememberControl {
  if (!platform().canRememberWallet) {
    return { node: el("div", { className: "hidden" }), checked: () => false };
  }
  const box = checkbox(
    "Remember on this device",
    `· stored in the ${KEYCHAIN_NAME}, unlocked with your login`,
    "remember",
  );
  return { node: box.node, checked: () => box.input.checked };
}
