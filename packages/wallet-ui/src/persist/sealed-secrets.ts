/**
 * IndexedDB storage for the browser's remembered keys (6.12).
 *
 * One record per wallet id in `bitcoin-wallet-keystore` / `sealed_secrets`,
 * exactly as `sealedKeystore` hands it over: ciphertext, and the salt, IV and
 * round count that open it with the app password. Nothing here can read it.
 * A database of its own rather than a store beside the wallet state, so
 * neither's version or reset can reach the other.
 *
 * Raw IndexedDB wrapped in promises by `idb.ts`, as `indexeddb.ts` is; writes
 * resolve only once the transaction has committed.
 */

import type { SealedSecret, SealedStore } from "../platform/sealed";
import { objectStore } from "./idb";

const withStore = objectStore({
  db: "bitcoin-wallet-keystore",
  version: 1,
  // No key path: keyed by wallet id from outside, so a record is only ever the sealed secret.
  store: "sealed_secrets",
  host: "browser",
  database: "key store",
  records: "key store",
});

export const sealedSecrets: SealedStore = {
  get: (walletId) => withStore<unknown>("readonly", (store) => store.get(walletId)),
  async put(walletId: string, record: SealedSecret): Promise<void> {
    await withStore("readwrite", (store) => store.put(record, walletId));
  },
  // Deleting what is not there is not an error, as with the OS keystore.
  async delete(walletId: string): Promise<void> {
    await withStore("readwrite", (store) => store.delete(walletId));
  },
};
