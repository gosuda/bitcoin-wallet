/**
 * The browser's half of the platform seam.
 *
 * A tab has no OS keychain, so this shell deliberately stores no key material:
 * `canRememberWallet` is false and the three secret methods reject. Keys live in
 * memory for the life of the tab and are gone when it closes. Only the two
 * non-secret records — the app config and (for shape parity) the remembered
 * wallet — are kept, in `localStorage` under a versioned key.
 */

import type { Platform } from "@bitcoin-wallet/ui/platform";
import type { AppConfig, RememberedWallet } from "@bitcoin-wallet/ui/types";

const PREFIX = "bitcoin-wallet.v1.";
const CONFIG_KEY = `${PREFIX}config`;
const REMEMBERED_KEY = `${PREFIX}remembered`;

/**
 * Reads one JSON record. A missing key, a browser that refuses storage
 * (private mode, blocked site data) and a corrupt value are all the same
 * answer: nothing is stored.
 */
function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience here, never a correctness requirement: a tab
    // that cannot persist the config simply asks for it again next time.
  }
}

function noKeystore(): Promise<never> {
  return Promise.reject(
    new Error("this browser has no key store; the wallet is open for this tab only"),
  );
}

export const browserPlatform: Platform = {
  canRememberWallet: false,

  getConfig: async () => read<AppConfig>(CONFIG_KEY),
  setConfig: async (config) => write(CONFIG_KEY, config),

  getRemembered: async () => read<RememberedWallet>(REMEMBERED_KEY),
  setRemembered: async (record) => write(REMEMBERED_KEY, record),

  rememberSecret: noKeystore,
  loadSecret: noKeystore,
  forgetSecret: noKeystore,

  writeClipboard: (text) => navigator.clipboard.writeText(text),
  openUrl: async (url) => {
    window.open(url, "_blank", "noopener");
  },
};
