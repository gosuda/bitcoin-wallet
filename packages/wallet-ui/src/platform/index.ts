/**
 * The one seam between the shared wallet UI and the shell it runs in.
 *
 * Everything wallet-shaped — keys, sync, PSBTs, chain state — runs in the
 * webview against the WASM core, so the shell is only asked for what a page
 * cannot do on its own: durable config, the remembered-wallet record, the
 * key store, the clipboard and opening a link. A Tauri window supplies all of
 * them, its key store being the OS one; a browser tab seals the key under an
 * app password instead, and says so through `needsAppPassword`.
 */

import type { AppConfig, LockAfter, RememberedWallet, StoredSecret } from "../types";

export interface Platform {
  /**
   * Whether this shell can keep a key across runs. False where no key store
   * works — a native build whose OS keystore is unusable, or a browser page
   * without WebCrypto: the "Remember on this device" choice is not offered, no
   * remembered record is written, and `unlock` is unreachable.
   */
  readonly canRememberWallet: boolean;

  /**
   * Whether remembering and unlocking a wallet take an app password. Only the
   * browser sets it: with no OS keychain there, its key store seals the key
   * under a password the user chooses (`platform/sealed.ts`). An OS keystore
   * guards the key with the device's own login, so absent means no.
   */
  readonly needsAppPassword?: boolean;

  /** The stored app config, or `null` when the shell has none yet. */
  getConfig(): Promise<AppConfig | null>;
  setConfig(config: AppConfig): Promise<void>;

  /** The non-secret description of the remembered wallet; the key is separate. */
  getRemembered(): Promise<RememberedWallet | null>;
  /** Writes the record, or clears it when given `null`. */
  setRemembered(record: RememberedWallet | null): Promise<void>;

  /**
   * How long the app may sit in the background before a remembered wallet
   * closes to Unlock. Nothing saved, or a value this build does not offer,
   * reads as the default (`lockAfterFrom`).
   */
  getLockAfter(): Promise<LockAfter>;
  setLockAfter(choice: LockAfter): Promise<void>;

  /**
   * Rejects where `canRememberWallet` is false. Where `needsAppPassword` is
   * set, the key is sealed under `appPassword` and nothing is stored without
   * one; elsewhere it is ignored.
   */
  rememberSecret(
    walletId: string,
    secret: string,
    passphrase?: string,
    appPassword?: string,
  ): Promise<void>;
  /**
   * Rejects where `canRememberWallet` is false. Where `needsAppPassword` is
   * set, `appPassword` opens the sealed key, and any other rejects with
   * `wrong_password`.
   */
  loadSecret(walletId: string, appPassword?: string): Promise<StoredSecret | null>;
  /** Rejects where `canRememberWallet` is false. */
  forgetSecret(walletId: string): Promise<void>;

  writeClipboard(text: string): Promise<void>;
  /**
   * The clipboard's text, for a Paste button: `""` when it holds none, and a
   * rejection when it cannot be read at all. A Tauri webview refuses the
   * page's own `navigator.clipboard` read, with nothing the user could allow,
   * so the apps read it through the shell.
   */
  readClipboard(): Promise<string>;
  openUrl(url: string): Promise<void>;

  /**
   * Reads a QR code with the camera, or resolves `null` if the user cancels.
   *
   * The camera is drawn behind the webview, so the screen that calls this has
   * to be see-through while it runs. Aborting `signal` stops the camera and
   * resolves `null` — the way out when the user leaves that screen, since the
   * camera itself offers none.
   *
   * Optional because only a phone has one. Screens must check for it rather
   * than assume: the browser and desktop shells leave it undefined, and the
   * Scan tab is hidden where it is missing.
   */
  scanQr?(signal?: AbortSignal): Promise<string | null>;

  /**
   * Asks the OS to confirm the user is present, rejecting if it cannot.
   *
   * Optional for the same reason. It authenticates and nothing more — the key
   * still lives in the OS key store; this only gates reading it.
   */
  authenticate?(reason: string): Promise<void>;
}

let current: Platform | null = null;

/** Installed by the app entry point before anything renders. */
export function setPlatform(impl: Platform): void {
  current = impl;
}

export function platform(): Platform {
  if (!current) throw new Error("no platform installed; call setPlatform() before boot()");
  return current;
}
