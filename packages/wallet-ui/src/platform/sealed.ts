/**
 * A remembered secret sealed under an app password, for the one shell with no
 * OS keystore: the browser (6.12).
 *
 * A key is derived from the password with PBKDF2-HMAC-SHA256 over a fresh
 * random salt, and encrypts the secret with AES-256-GCM under a fresh random
 * IV, all through WebCrypto. What is kept is a versioned record of the
 * ciphertext and what it takes to derive that key again: never the password,
 * never the secret. GCM authenticates what it decrypts, and the wallet id with
 * it, so a wrong password fails outright instead of yielding garbage, and says
 * so as its own error.
 *
 * Where records are kept is handed in (`SealedStore`), so all of this runs, and
 * is tested, without IndexedDB.
 */

import { type StoredSecret, WalletError } from "../types";
import type { Platform } from "./index";

/**
 * PBKDF2 rounds for a newly sealed secret: OWASP's current recommendation for
 * PBKDF2-HMAC-SHA256, as decided on 2026-09-30. Every record carries its own
 * count, so raising this later leaves the records already written readable.
 */
export const PBKDF2_ITERATIONS = 600_000;

/** A damaged record could name any count, and deriving with a huge one would hang Unlock. */
const MAX_ITERATIONS = 10 * PBKDF2_ITERATIONS;

const VERSION = 1;
const KDF = "PBKDF2-SHA256";
const SALT_BYTES = 16;
/** 96 bits: the IV length GCM is specified for. */
const IV_BYTES = 12;
/** GCM appends a 128-bit tag, so no ciphertext of ours is shorter. */
const TAG_BYTES = 16;

/**
 * What is kept for one remembered wallet. The binary fields are base64.
 *
 * The ciphertext is bound to the wallet's id, as GCM's additional data, so a
 * record copied into another wallet's slot fails the tag instead of opening
 * there. Version 1 does so from the start, since no record was written before.
 */
export interface SealedSecret {
  version: typeof VERSION;
  kdf: typeof KDF;
  iterations: number;
  salt: string;
  iv: string;
  /** AES-256-GCM over the JSON of a `StoredSecret`, tag included. */
  ciphertext: string;
}

/** Where sealed records live, by wallet id: IndexedDB in the browser, a map in tests. */
export interface SealedStore {
  /** Whatever is kept for `walletId`, unchecked, or `undefined` when nothing is. */
  get(walletId: string): Promise<unknown>;
  put(walletId: string, record: SealedSecret): Promise<void>;
  delete(walletId: string): Promise<void>;
}

function wrongPassword(): WalletError {
  return new WalletError(
    "wrong_password",
    "the app password does not open the key saved in this browser",
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The bytes `value` encodes, or `null` when it is not a base64 string. */
function fromBase64(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string") return null;
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The AES key for `appPassword`. The password is NFC-normalized first, so a
 * letter typed composed one time and decomposed the next is the same password.
 */
async function deriveKey(
  appPassword: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appPassword.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seals `secret` for `walletId` under `appPassword`, with a salt and an IV of
 * its own. `iterations` is there for tests, which cannot wait for the real
 * count.
 *
 * An empty password is refused, not sealed under: nothing kept in this browser
 * may open without one.
 */
export async function seal(
  walletId: string,
  secret: StoredSecret,
  appPassword: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<SealedSecret> {
  if (appPassword === "") {
    throw new WalletError(
      "no_app_password",
      "Choose an app password to remember this wallet in this browser.",
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(appPassword, salt, iterations);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ secret: secret.secret, passphrase: secret.passphrase }),
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(walletId) },
    key,
    plaintext,
  );
  return {
    version: VERSION,
    kdf: KDF,
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/** `record`'s parts, decoded, when it is a record this version wrote; `null` otherwise. */
function parse(record: unknown) {
  if (typeof record !== "object" || record === null) return null;
  const r = record as Record<string, unknown>;
  if (r.version !== VERSION || r.kdf !== KDF) return null;
  const iterations = r.iterations;
  if (
    typeof iterations !== "number" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_ITERATIONS
  ) {
    return null;
  }
  const salt = fromBase64(r.salt);
  const iv = fromBase64(r.iv);
  const ciphertext = fromBase64(r.ciphertext);
  if (salt?.length !== SALT_BYTES || iv?.length !== IV_BYTES) return null;
  if (!ciphertext || ciphertext.length < TAG_BYTES) return null;
  return { iterations, salt, iv, ciphertext };
}

/**
 * The secret sealed in `record`, when it was sealed for `walletId` and
 * `appPassword` is the password it was sealed under.
 *
 * The record is checked before anything is derived from it: one in a format
 * this version does not know — written by a newer one, or damaged — is refused
 * as such (`unknown_secret_format`), never decrypted into garbage or blamed on
 * the password. Past that, GCM's tag decides. A wrong password, a changed
 * ciphertext and another wallet's record fail it alike and nothing can tell
 * them apart, so all are `wrong_password`.
 */
export async function unseal(
  walletId: string,
  record: unknown,
  appPassword: string,
): Promise<StoredSecret> {
  const parts = parse(record);
  if (!parts) {
    throw new WalletError(
      "unknown_secret_format",
      "The key saved in this browser can't be read by this version of the app.",
    );
  }
  // `seal` refuses an empty password, so none opens a record.
  if (appPassword === "") throw wrongPassword();
  const key = await deriveKey(appPassword, parts.salt, parts.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: parts.iv, additionalData: new TextEncoder().encode(walletId) },
      key,
      parts.ciphertext,
    );
  } catch {
    throw wrongPassword();
  }
  // The tag passed, so these are the bytes `seal` encrypted.
  return JSON.parse(new TextDecoder().decode(plaintext)) as StoredSecret;
}

/**
 * The platform's three key-store calls over `store`: each wallet's secret is
 * sealed for its id under the app password it was remembered with, and opens
 * only in that wallet's slot, with that password.
 */
export function sealedKeystore(
  store: SealedStore,
  iterations = PBKDF2_ITERATIONS,
): Pick<Platform, "rememberSecret" | "loadSecret" | "forgetSecret"> {
  return {
    async rememberSecret(walletId, secret, passphrase, appPassword) {
      const record = await seal(
        walletId,
        { secret, passphrase: passphrase ?? null },
        appPassword ?? "",
        iterations,
      );
      await store.put(walletId, record);
    },
    async loadSecret(walletId, appPassword) {
      const record = await store.get(walletId);
      if (record === undefined || record === null) return null;
      return unseal(walletId, record, appPassword ?? "");
    },
    forgetSecret: (walletId) => store.delete(walletId),
  };
}
