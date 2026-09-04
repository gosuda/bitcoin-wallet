import { platform } from "../platform";
import { checkbox, el } from "./dom";

/** What this platform calls the thing a remembered key is kept in. */
function keychainName(): string {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "Android Keystore";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS Keychain";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS Keychain";
  if (/Windows/.test(ua)) return "Windows Credential Manager";
  return "OS keychain";
}

export const KEYCHAIN_NAME = keychainName();

/**
 * Copy for shells that cannot keep a key past the session.
 *
 * Two different situations end up here: a browser tab, which has no key store
 * at all, and a native build whose key store exists but is unusable — an
 * unsigned iOS build, where the keychain needs an entitlement it lacks.
 */
export const NO_KEYSTORE_HINT =
  "No key store is available here; the key is kept for this session only.";

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
