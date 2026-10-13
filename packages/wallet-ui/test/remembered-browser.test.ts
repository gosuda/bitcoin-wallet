/** @vitest-environment jsdom */
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Model a transaction with a private draft. Aborting any request discards all
// writes, including the clear that runs before the two put requests.
const idb = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  failPut: null as string | null,
  aborts: 0,
}));

vi.mock("../src/persist/idb", () => ({
  objectStore: () =>
    async <T>(
      mode: IDBTransactionMode,
      run: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> => {
      const draft = new Map(idb.records);
      const request = <U>(value: U): IDBRequest<U> => ({ result: value }) as IDBRequest<U>;
      const store = {
        transaction: { abort: () => { idb.aborts++; } },
        get: (key: IDBValidKey) => request(draft.get(String(key))),
        put: (value: unknown, key: IDBValidKey) => {
          if (idb.failPut === String(key)) throw new Error("transaction aborted");
          draft.set(String(key), value);
          return request(key);
        },
        delete: (key: IDBValidKey) => {
          draft.delete(String(key));
          return request(undefined);
        },
        clear: () => {
          draft.clear();
          return request(undefined);
        },
      } as IDBObjectStore;
      const result = run(store).result;
      if (mode === "readwrite") {
        idb.records.clear();
        for (const [key, value] of draft) idb.records.set(key, value);
      }
      return result;
    },
}));

import { browserPlatform } from "../../../apps/web/src/platform-browser";
import {
  readRememberedSecret,
  saveRememberedSecret,
  sealedSecrets,
} from "../src/persist/sealed-secrets";
import { seal } from "../src/platform/sealed";
import type { RememberedWallet } from "../src/types";

const LOCAL_KEY = "bitcoin-wallet.v1.remembered";
const ACTIVE_KEY = "__bitcoin_wallet_active__";
const A: RememberedWallet = {
  wallet_id: "testnet4-p2wpkh-a",
  address: "tb1a",
  network: "testnet4",
  address_type: "p2wpkh",
};
const B: RememberedWallet = { ...A, wallet_id: "testnet4-p2wpkh-b", address: "tb1b" };
const lifecycle = browserPlatform.rememberedWalletStore;
if (!lifecycle) throw new Error("browser has no atomic remembered store");

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  idb.records.clear();
  idb.failPut = null;
  idb.aborts = 0;
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function sealed(walletId: string) {
  return seal(walletId, { secret: "only-in-ciphertext", passphrase: null }, "password", 1_000);
}

describe("browser remembered-wallet durability", () => {
  it("remembers a discoverable secret when localStorage refuses all writes", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("localStorage blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("localStorage blocked");
    });

    await lifecycle.save(A, "secret-a", undefined, "password");

    expect(await browserPlatform.getRemembered()).toEqual(A);
    expect(await browserPlatform.loadSecret(A.wallet_id, "password")).toEqual({
      secret: "secret-a",
      passphrase: null,
    });
    expect([...idb.records.keys()].sort()).toEqual([ACTIVE_KEY, A.wallet_id].sort());

    await lifecycle.forget();
    expect(idb.records.size).toBe(0);
  });

  it("rolls back both keys when the metadata write fails", async () => {
    await saveRememberedSecret(A, await sealed(A.wallet_id));
    idb.failPut = ACTIVE_KEY;

    await expect(saveRememberedSecret(B, await sealed(B.wallet_id))).rejects.toThrow(
      "transaction aborted",
    );
    expect(await readRememberedSecret(null)).toEqual(A);
    expect([...idb.records.keys()].sort()).toEqual([ACTIVE_KEY, A.wallet_id].sort());
    expect(idb.aborts).toBe(1);
  });

  it("does not retain any key when the first metadata write throws", async () => {
    idb.failPut = ACTIVE_KEY;

    await expect(saveRememberedSecret(A, await sealed(A.wallet_id))).rejects.toThrow(
      "transaction aborted",
    );
    expect(idb.aborts).toBe(1);
    expect(idb.records.size).toBe(0);
  });

  it("replaces A with B and deletes A in the same commit", async () => {
    await saveRememberedSecret(A, await sealed(A.wallet_id));
    await saveRememberedSecret(B, await sealed(B.wallet_id));

    expect(await readRememberedSecret(null)).toEqual(B);
    expect([...idb.records.keys()].sort()).toEqual([ACTIVE_KEY, B.wallet_id].sort());
  });

  it("migrates the legacy pointer and clears pre-existing orphans", async () => {
    await sealedSecrets.put(A.wallet_id, await sealed(A.wallet_id));
    await sealedSecrets.put(B.wallet_id, await sealed(B.wallet_id));
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(A));

    expect(await browserPlatform.getRemembered()).toEqual(A);
    expect([...idb.records.keys()].sort()).toEqual([ACTIVE_KEY, A.wallet_id].sort());
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  it.each(["missing", "malformed", "stale"] as const)(
    "clears an unreachable legacy key when its pointer is %s",
    async (kind) => {
      await sealedSecrets.put(A.wallet_id, await sealed(A.wallet_id));
      if (kind === "malformed") window.localStorage.setItem(LOCAL_KEY, "{broken");
      if (kind === "stale") window.localStorage.setItem(LOCAL_KEY, JSON.stringify(B));

      expect(await browserPlatform.getRemembered()).toBeNull();
      expect(idb.records.size).toBe(0);
    },
  );

  it("Forget clears all keys despite valid metadata pointing to the wrong wallet", async () => {
    await sealedSecrets.put(B.wallet_id, await sealed(B.wallet_id));
    idb.records.set(ACTIVE_KEY, A);

    await lifecycle.forget();

    expect(idb.records.size).toBe(0);
    expect(await browserPlatform.getRemembered()).toBeNull();
  });

  it("clears a corrupt IndexedDB pointer and its orphaned key", async () => {
    await sealedSecrets.put(A.wallet_id, await sealed(A.wallet_id));
    idb.records.set(ACTIVE_KEY, { wallet_id: "__bitcoin_wallet_active__" });

    expect(await browserPlatform.getRemembered()).toBeNull();
    expect(idb.records.size).toBe(0);
  });
});
