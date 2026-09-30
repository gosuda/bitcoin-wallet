/**
 * The browser's half of the platform seam.
 *
 * A tab has no OS keychain, so a remembered key is sealed under an app
 * password the user chooses — PBKDF2-SHA256 and AES-GCM from WebCrypto — and
 * kept in an IndexedDB database of its own (`sealedKeystore` over
 * `sealedSecrets`). Without "Remember" nothing secret is written, and the key
 * lives in memory for the life of the tab. The non-secret records — the app
 * config, the remembered wallet and the lock time — are kept in `localStorage`
 * under a versioned key.
 */

import type { Platform } from "@bitcoin-wallet/ui/platform";
import { sealedKeystore } from "@bitcoin-wallet/ui/sealed";
import { sealedSecrets } from "@bitcoin-wallet/ui/sealed-secrets";
import { type AppConfig, lockAfterFrom, type RememberedWallet } from "@bitcoin-wallet/ui/types";

const PREFIX = "bitcoin-wallet.v1.";
const CONFIG_KEY = `${PREFIX}config`;
const REMEMBERED_KEY = `${PREFIX}remembered`;
const LOCK_AFTER_KEY = `${PREFIX}lock_after`;

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

export const browserPlatform: Platform = {
  // WebCrypto is there only on a secure origin (https, or localhost). A page
  // served any other way cannot seal a key, so it keeps one for the tab only.
  canRememberWallet: crypto.subtle !== undefined,
  needsAppPassword: true,

  getConfig: async () => read<AppConfig>(CONFIG_KEY),
  setConfig: async (config) => write(CONFIG_KEY, config),

  getRemembered: async () => read<RememberedWallet>(REMEMBERED_KEY),
  setRemembered: async (record) => write(REMEMBERED_KEY, record),

  getLockAfter: async () => lockAfterFrom(read(LOCK_AFTER_KEY)),
  setLockAfter: async (choice) => write(LOCK_AFTER_KEY, choice),

  ...sealedKeystore(sealedSecrets),

  writeClipboard: (text) => navigator.clipboard.writeText(text),
  openUrl: async (url) => {
    window.open(url, "_blank", "noopener");
  },
};
