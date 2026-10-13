/**
 * The browser's half of the platform seam.
 *
 * A tab has no OS keychain, so a remembered key is sealed under an app
 * password the user chooses — PBKDF2-SHA256 and AES-GCM from WebCrypto — and
 * kept in IndexedDB alongside its active-wallet metadata. Without "Remember"
 * nothing secret is written, and the key lives in memory for the tab. Config
 * and lock time stay in localStorage; old remembered pointers are migrated and
 * then discarded.
 */

import type { Platform } from "@bitcoin-wallet/ui/platform";
import { seal, sealedKeystore } from "@bitcoin-wallet/ui/sealed";
import {
  clearRememberedSecrets,
  readRememberedSecret,
  saveRememberedSecret,
  sealedSecrets,
} from "@bitcoin-wallet/ui/sealed-secrets";
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
    // Only config, lock time and removal of an obsolete legacy pointer use
    // this helper. The active wallet pointer is committed with the secret in
    // IndexedDB, where failures are never ignored.
  }
}

async function forgetRemembered(): Promise<void> {
  await clearRememberedSecrets();
  // A failed legacy-pointer removal cannot retain ciphertext after the
  // IndexedDB clear, and the next read will refuse that stale pointer.
  write(REMEMBERED_KEY, null);
}

export const browserPlatform: Platform = {
  // Sealing needs WebCrypto, there only on a secure origin (https, or
  // localhost), and the sealed key is kept in IndexedDB. A page without
  // either keeps the key for the tab only.
  canRememberWallet: crypto.subtle !== undefined && typeof indexedDB !== "undefined",
  needsAppPassword: true,

  getConfig: async () => read<AppConfig>(CONFIG_KEY),
  setConfig: async (config) => write(CONFIG_KEY, config),

  getRemembered: async () => {
    const record = await readRememberedSecret(read<unknown>(REMEMBERED_KEY));
    if (record) write(REMEMBERED_KEY, null);
    return record;
  },
  setRemembered: async (record) => {
    if (record !== null) throw new Error("remembered secrets must be saved atomically");
    await forgetRemembered();
  },
  rememberedWalletStore: {
    async save(record, secret, passphrase, appPassword) {
      const sealed = await seal(
        record.wallet_id,
        { secret, passphrase: passphrase ?? null },
        appPassword ?? "",
      );
      await saveRememberedSecret(record, sealed);
      write(REMEMBERED_KEY, null);
    },
    forget: forgetRemembered,
  },

  getLockAfter: async () => lockAfterFrom(read(LOCK_AFTER_KEY)),
  setLockAfter: async (choice) => write(LOCK_AFTER_KEY, choice),

  ...sealedKeystore(sealedSecrets),

  writeClipboard: (text) => navigator.clipboard.writeText(text),
  // Refused (`NotAllowedError`) until the site is allowed to read it, which a
  // browser lets the user change; missing altogether away from https.
  readClipboard: async () => navigator.clipboard.readText(),
  openUrl: async (url) => {
    window.open(url, "_blank", "noopener");
  },
};
