/**
 * IndexedDB storage for public wallet state.
 *
 * One record per wallet id in `bitcoin-wallet` / `wallet_state`, holding the
 * aggregated BDK changeset as JSON exactly as the core hands it over. Nothing
 * secret is written here — keys live in the OS keystore, behind Tauri.
 *
 * Raw IndexedDB wrapped in promises; no dependency, and writes resolve only
 * once the transaction has committed.
 */

import type { WalletPersister } from "../wasm";

const DB_NAME = "bitcoin-wallet";
const DB_VERSION = 1;
const STORE_NAME = "wallet_state";
const KEY_PATH = "wallet_id";

interface StateRecord {
  wallet_id: string;
  /** Aggregated changeset JSON, opaque to the app. */
  changeset: string;
  updated_at: number;
}

let handle: Promise<IDBDatabase> | null = null;

function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this webview"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: KEY_PATH });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("could not open the wallet database"));
    request.onblocked = () =>
      reject(new Error("wallet database upgrade is blocked by another window"));
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
    request.onerror = () => fail(request.error, "wallet state request failed");
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => fail(tx.error, "wallet state transaction failed");
    tx.onabort = () => fail(tx.error, "wallet state transaction was aborted");
  });
}

/** Persister for `Wallet.open`: reads and replaces this wallet's single record. */
export function makePersister(walletId: string): WalletPersister {
  return {
    async initialize(): Promise<string | null> {
      const record = await withStore("readonly", (store) => {
        return store.get(walletId) as IDBRequest<StateRecord | undefined>;
      });
      return record?.changeset ?? null;
    },
    async persist(json: string): Promise<void> {
      const record: StateRecord = {
        wallet_id: walletId,
        changeset: json,
        updated_at: Date.now(),
      };
      await withStore("readwrite", (store) => store.put(record));
    },
  };
}

/** Drops a wallet's stored state; used when the wallet is forgotten. */
export async function deleteWalletState(walletId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(walletId));
}
