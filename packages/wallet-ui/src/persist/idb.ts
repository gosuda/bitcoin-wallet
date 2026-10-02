/**
 * Raw IndexedDB wrapped in promises, for the app's two databases: the public
 * wallet state (`indexeddb.ts`) and the browser's sealed keys
 * (`sealed-secrets.ts`). No dependency, and writes resolve only once the
 * transaction has committed.
 */

/** A database holding one object store, and the words its errors name it by. */
export interface StoreSpec {
  /** The database's name. */
  db: string;
  version: number;
  /** The object store's name. */
  store: string;
  options?: IDBObjectStoreParameters;
  /** Where the app runs: "IndexedDB is not available in this …". */
  host: string;
  /** "could not open the …", "… upgrade is blocked by another window". */
  database: string;
  /** "… request failed", "… transaction failed", "… transaction was aborted". */
  records: string;
}

function connect(spec: StoreSpec): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error(`IndexedDB is not available in this ${spec.host}`));
      return;
    }
    const request = indexedDB.open(spec.db, spec.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(spec.store)) {
        db.createObjectStore(spec.store, spec.options);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error(`could not open the ${spec.database}`));
    request.onblocked = () =>
      reject(new Error(`${spec.database} upgrade is blocked by another window`));
  });
}

/** `withStore` for the store `spec` names; nothing is opened until it is first called. */
export function objectStore(
  spec: StoreSpec,
): <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => Promise<T> {
  let handle: Promise<IDBDatabase> | null = null;

  /** Opens the database once; a failed attempt is retried on the next call. */
  function database(): Promise<IDBDatabase> {
    handle ??= connect(spec).catch((e: unknown) => {
      handle = null;
      throw e;
    });
    return handle;
  }

  /** Runs one request and resolves after the transaction commits. */
  return async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(spec.store, mode);
      const fail = (e: DOMException | null, what: string) => reject(e ?? new Error(what));
      let result: T | undefined;
      const request = run(tx.objectStore(spec.store));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => fail(request.error, `${spec.records} request failed`);
      tx.oncomplete = () => resolve(result as T);
      tx.onerror = () => fail(tx.error, `${spec.records} transaction failed`);
      tx.onabort = () => fail(tx.error, `${spec.records} transaction was aborted`);
    });
  };
}
