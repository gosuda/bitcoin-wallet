/**
 * Browser keystore and active-wallet metadata, stored together in IndexedDB.
 *
 * Each successful save clears any previous sealed keys and writes the new
 * encrypted key and its discoverable wallet record in ONE transaction. A
 * failed or aborted transaction preserves the previous saved wallet.
 *
 * Older builds kept only sealed keys here and their pointer in localStorage.
 * The first read migrates a referenced key; without a usable old pointer,
 * any unreachable keys are deleted instead of left on disk indefinitely.
 */

import type { SealedSecret, SealedStore } from "../platform/sealed";
import { ADDRESS_TYPES, NETWORKS, type RememberedWallet } from "../types";
import { objectStore } from "./idb";

const ACTIVE_KEY = "__bitcoin_wallet_active__";

const withStore = objectStore({
  db: "bitcoin-wallet-keystore",
  version: 1,
  store: "sealed_secrets",
  host: "browser",
  database: "key store",
  records: "key store",
});

/** A persisted pointer is untrusted, whether it came from IDB or localStorage. */
function remembered(value: unknown): value is RememberedWallet {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.wallet_id === "string" &&
    r.wallet_id.length > 0 &&
    r.wallet_id !== ACTIVE_KEY &&
    typeof r.address === "string" &&
    NETWORKS.some((network) => network === r.network) &&
    ADDRESS_TYPES.some((addressType) => addressType === r.address_type)
  );
}

export const sealedSecrets: SealedStore = {
  get: (walletId) => withStore<unknown>("readonly", (store) => store.get(walletId)),
  async put(walletId: string, record: SealedSecret): Promise<void> {
    await withStore("readwrite", (store) => store.put(record, walletId));
  },
  async delete(walletId: string): Promise<void> {
    await withStore("readwrite", (store) => store.delete(walletId));
  },
};

/** Clears the active record AND every sealed key, including legacy orphans. */
export async function clearRememberedSecrets(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}

/**
 * Makes one remembered wallet authoritative. The clear and both puts commit
 * or abort together, so no secret can survive without its active pointer.
 */
export async function saveRememberedSecret(
  record: RememberedWallet,
  sealed: SealedSecret,
): Promise<void> {
  if (!remembered(record)) throw new Error("invalid remembered wallet");
  await withStore("readwrite", (store) => {
    try {
      store.clear();
      store.put(sealed, record.wallet_id);
      return store.put(record, ACTIVE_KEY);
    } catch (e) {
      // An IndexedDB request failure aborts automatically, but a synchronous
      // put exception does not. Abort so a prior clear or put cannot commit.
      store.transaction.abort();
      throw e;
    }
  });
}

/**
 * Reads the active record, importing a v1 localStorage pointer if necessary.
 * With no valid pointer, old sealed keys cannot be unlocked through the UI;
 * clear them now to avoid retaining inaccessible ciphertext.
 */
export async function readRememberedSecret(legacy: unknown): Promise<RememberedWallet | null> {
  const active = await withStore<unknown>("readonly", (store) => store.get(ACTIVE_KEY));
  if (active !== undefined) {
    if (remembered(active)) return active;
    await clearRememberedSecrets();
    return null;
  }

  if (remembered(legacy)) {
    const oldKey = await sealedSecrets.get(legacy.wallet_id);
    if (oldKey !== undefined && oldKey !== null) {
      await saveRememberedSecret(legacy, oldKey as SealedSecret);
      return legacy;
    }
  }

  await clearRememberedSecrets();
  return null;
}
