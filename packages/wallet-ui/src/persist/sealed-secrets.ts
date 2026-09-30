/**
 * IndexedDB storage for the browser's remembered keys (6.12).
 *
 * One record per wallet id in `bitcoin-wallet-keystore` / `sealed_secrets`,
 * exactly as `sealedKeystore` hands it over: ciphertext, and the salt, IV and
 * round count that open it with the app password. Nothing here can read it.
 * A database of its own rather than a store beside the wallet state, so
 * neither's version or reset can reach the other.
 *
 * Raw IndexedDB wrapped in promises, as `indexeddb.ts` does; writes resolve
 * only once the transaction has committed.
 */

import type { SealedSecret, SealedStore } from "../platform/sealed";

const DB_NAME = "bitcoin-wallet-keystore";
const DB_VERSION = 1;
const STORE_NAME = "sealed_secrets";

let handle: Promise<IDBDatabase> | null = null;

function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Keyed by wallet id from outside, so a record is only ever the sealed secret.
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the key store"));
    request.onblocked = () => reject(new Error("key store upgrade is blocked by another window"));
  });
}

/** Opens the database once; a failed attempt is retried on the next call. */
function database(): Promise<IDBDatabase> {
  handle ??= connect().catch((e: unknown) => {
    handle = null;
    throw e;
  });
  return handle;
}

/** Runs one request and resolves after the transaction commits. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const fail = (e: DOMException | null, what: string) => reject(e ?? new Error(what));
    let result: T | undefined;
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => fail(request.error, "key store request failed");
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => fail(tx.error, "key store transaction failed");
    tx.onabort = () => fail(tx.error, "key store transaction was aborted");
  });
}

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
