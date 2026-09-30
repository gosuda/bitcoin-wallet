import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS,
  type SealedSecret,
  type SealedStore,
  seal,
  sealedKeystore,
  unseal,
} from "../src/platform/sealed";
import { errorMessage, type StoredSecret } from "../src/types";

/**
 * Far fewer rounds than the real count, which takes most of a second each
 * time. A record carries its own count, and `unseal` reads it from there.
 */
const ROUNDS = 1_000;

const WALLET = "testnet4-p2wpkh-3f0c9a1b";
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const STORED: StoredSecret = { secret: PHRASE, passphrase: "TREZOR" };
const PASSWORD = "correct horse battery staple";

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function base64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

/** `field` of `record` with one bit of its first byte flipped. */
function flipped(record: SealedSecret, field: "salt" | "iv" | "ciphertext"): SealedSecret {
  const data = bytes(record[field]);
  data[0] = (data[0] ?? 0) ^ 1;
  return { ...record, [field]: base64(data) };
}

/** Where IndexedDB would keep the records. */
function memoryStore(): SealedStore & { records: Map<string, unknown> } {
  const records = new Map<string, unknown>();
  return {
    records,
    get: async (walletId) => records.get(walletId),
    put: async (walletId, record) => {
      records.set(walletId, record);
    },
    delete: async (walletId) => {
      records.delete(walletId);
    },
  };
}

describe("a secret sealed under an app password (6.12)", () => {
  it("opens with that password, passphrase and all", async () => {
    const record = await seal(WALLET, STORED, PASSWORD, ROUNDS);
    expect(await unseal(WALLET, record, PASSWORD)).toEqual(STORED);

    const single: StoredSecret = { secret: "11".repeat(32), passphrase: null };
    const sealedSingle = await seal(WALLET, single, PASSWORD, ROUNDS);
    expect(await unseal(WALLET, sealedSingle, PASSWORD)).toEqual(single);
  });

  it("keeps a versioned record that holds neither the secret nor the password", async () => {
    const record = await seal(WALLET, STORED, PASSWORD, ROUNDS);

    expect(record).toMatchObject({ version: 1, kdf: "PBKDF2-SHA256", iterations: ROUNDS });
    expect(bytes(record.salt)).toHaveLength(16);
    expect(bytes(record.iv)).toHaveLength(12);
    const kept = JSON.stringify(record);
    for (const secret of ["abandon", "TREZOR", PASSWORD]) expect(kept).not.toContain(secret);
  });

  it("refuses a wrong password as its own error, in the canvas's words", async () => {
    const record = await seal(WALLET, STORED, PASSWORD, ROUNDS);

    for (const wrong of [`${PASSWORD}!`, "Correct horse battery staple", ""]) {
      const refused = await unseal(WALLET, record, wrong).catch((e: unknown) => e);
      expect(refused).toMatchObject({ code: "wrong_password" });
      expect(errorMessage(refused)).toBe("Wrong password.");
    }
  });

  it("draws a fresh salt and IV for every seal", async () => {
    const first = await seal(WALLET, STORED, PASSWORD, ROUNDS);
    const second = await seal(WALLET, STORED, PASSWORD, ROUNDS);

    expect(second.salt).not.toBe(first.salt);
    expect(second.iv).not.toBe(first.iv);
    expect(second.ciphertext).not.toBe(first.ciphertext);
    expect(await unseal(WALLET, second, PASSWORD)).toEqual(STORED);
  });

  it("fails a record whose ciphertext, IV or salt was changed", async () => {
    const record = await seal(WALLET, STORED, PASSWORD, ROUNDS);

    for (const field of ["ciphertext", "iv", "salt"] as const) {
      await expect(unseal(WALLET, flipped(record, field), PASSWORD)).rejects.toMatchObject({
        code: "wrong_password",
      });
    }
  });

  it("refuses a record in a format it does not know, whatever the password", async () => {
    const record = await seal(WALLET, STORED, PASSWORD, ROUNDS);
    const saltless = Object.fromEntries(Object.entries(record).filter(([k]) => k !== "salt"));
    const unknown: unknown[] = [
      { ...record, version: 2 },
      { ...record, version: "1" },
      { ...record, kdf: "scrypt" },
      { ...record, iterations: 0 },
      { ...record, iterations: 1.5 },
      { ...record, iv: base64(new Uint8Array(16)) },
      { ...record, ciphertext: base64(new Uint8Array(8)) },
      { ...record, salt: "not base64!" },
      saltless,
      null,
      "sealed",
      42,
    ];
    for (const other of unknown) {
      const refused = await unseal(WALLET, other, PASSWORD).catch((e: unknown) => e);
      expect(refused).toMatchObject({ code: "unknown_secret_format" });
      expect(errorMessage(refused)).toBe(
        "The key saved in this browser can't be read by this version of the app.",
      );
    }
  });

  it("refuses a round count past its ceiling instead of deriving with it", async () => {
    const record = await seal(WALLET, STORED, PASSWORD, ROUNDS);

    // Ten times the real count is the most a record may ask for. Past that it
    // is refused at once, not derived for as long as it asks.
    for (const iterations of [10 * PBKDF2_ITERATIONS + 1, Number.MAX_SAFE_INTEGER]) {
      await expect(unseal(WALLET, { ...record, iterations }, PASSWORD)).rejects.toMatchObject({
        code: "unknown_secret_format",
      });
    }
  });

  // One derivation at the real count: about a second alone, and past the
  // 5 s default on a machine busy running every other test file at once.
  it("seals with 600,000 rounds, and opens a record with the count it carries", {
    timeout: 30_000,
  }, async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect((await seal(WALLET, STORED, PASSWORD)).iterations).toBe(PBKDF2_ITERATIONS);

    // Derived with any other count, the key is another key.
    const record = await seal(WALLET, STORED, PASSWORD, ROUNDS);
    await expect(
      unseal(WALLET, { ...record, iterations: ROUNDS + 1 }, PASSWORD),
    ).rejects.toMatchObject({ code: "wrong_password" });
  });

  it("takes a password typed with a composed or a decomposed letter as the same", async () => {
    const composed = "café au lait".normalize("NFC");
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);

    const record = await seal(WALLET, STORED, composed, ROUNDS);
    expect(await unseal(WALLET, record, decomposed)).toEqual(STORED);
  });

  it("is never sealed under an empty password", async () => {
    await expect(seal(WALLET, STORED, "", ROUNDS)).rejects.toMatchObject({
      code: "no_app_password",
    });
  });
});

describe("the key store over sealed records (6.12)", () => {
  it("remembers, loads and forgets a wallet's secret", async () => {
    const store = memoryStore();
    const keystore = sealedKeystore(store, ROUNDS);

    await keystore.rememberSecret("wallet-a", PHRASE, "TREZOR", PASSWORD);
    expect(store.records.get("wallet-a")).toMatchObject({ version: 1, iterations: ROUNDS });
    expect(await keystore.loadSecret("wallet-a", PASSWORD)).toEqual(STORED);
    expect(await keystore.loadSecret("wallet-b", PASSWORD)).toBeNull();

    await keystore.forgetSecret("wallet-a");
    expect(store.records.size).toBe(0);
    expect(await keystore.loadSecret("wallet-a", PASSWORD)).toBeNull();
    // Forgetting what is not there is not an error, as with the OS keystore.
    await keystore.forgetSecret("wallet-a");
  });

  it("keeps a single key's missing passphrase as none", async () => {
    const keystore = sealedKeystore(memoryStore(), ROUNDS);
    await keystore.rememberSecret("wallet-a", "11".repeat(32), undefined, PASSWORD);
    expect(await keystore.loadSecret("wallet-a", PASSWORD)).toEqual({
      secret: "11".repeat(32),
      passphrase: null,
    });
  });

  it("does not open one wallet's record in another's place", async () => {
    const store = memoryStore();
    const keystore = sealedKeystore(store, ROUNDS);
    await keystore.rememberSecret("wallet-a", PHRASE, "TREZOR", PASSWORD);

    // The same password and an intact record, under the wrong id: GCM's tag
    // covers the id, and cannot say which part failed.
    store.records.set("wallet-b", store.records.get("wallet-a"));
    await expect(keystore.loadSecret("wallet-b", PASSWORD)).rejects.toMatchObject({
      code: "wrong_password",
    });
    expect(await keystore.loadSecret("wallet-a", PASSWORD)).toEqual(STORED);
  });

  it("stores nothing without an app password, and opens nothing without the right one", async () => {
    const store = memoryStore();
    const keystore = sealedKeystore(store, ROUNDS);

    await expect(keystore.rememberSecret("wallet-a", PHRASE)).rejects.toMatchObject({
      code: "no_app_password",
    });
    expect(store.records.size).toBe(0);

    await keystore.rememberSecret("wallet-a", PHRASE, undefined, PASSWORD);
    await expect(keystore.loadSecret("wallet-a")).rejects.toMatchObject({
      code: "wrong_password",
    });
    await expect(keystore.loadSecret("wallet-a", "hunter2")).rejects.toMatchObject({
      code: "wrong_password",
    });
  });
});
