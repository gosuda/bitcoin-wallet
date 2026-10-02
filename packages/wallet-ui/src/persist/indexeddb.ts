/**
 * IndexedDB storage for public wallet state.
 *
 * One record per wallet id in `bitcoin-wallet` / `wallet_state`, holding the
 * aggregated BDK changeset as JSON exactly as the core hands it over. Nothing
 * secret is written here — keys live in the OS keystore, behind Tauri, or in
 * the browser sealed under the app password, in a database of their own
 * (`sealed-secrets.ts`).
 *
 * Raw IndexedDB wrapped in promises by `idb.ts`; writes resolve only once the
 * transaction has committed.
 */

import type { WalletPersister } from "../wasm";
import { objectStore } from "./idb";

interface StateRecord {
  wallet_id: string;
  /** Aggregated changeset JSON, opaque to the app. */
  changeset: string;
  updated_at: number;
}

const withStore = objectStore({
  db: "bitcoin-wallet",
  version: 1,
  store: "wallet_state",
  options: { keyPath: "wallet_id" },
  host: "webview",
  database: "wallet database",
  records: "wallet state",
});

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

/** Drops a wallet's stored state: when it is forgotten, or reset because it cannot be read. */
export async function deleteWalletState(walletId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(walletId));
}
