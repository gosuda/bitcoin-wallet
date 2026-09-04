/**
 * The one seam between the shared wallet UI and the shell it runs in.
 *
 * Everything wallet-shaped — keys, sync, PSBTs, chain state — runs in the
 * webview against the WASM core, so the shell is only asked for what a page
 * cannot do on its own: durable config, the remembered-wallet record, the
 * key store, the clipboard and opening a link. A Tauri window supplies all of
 * them; a browser tab supplies all but the key store, and says so through
 * `canRememberWallet`.
 */

import type { AppConfig, RememberedWallet, StoredSecret } from "../types";

export interface Platform {
  /**
   * Whether this shell can keep a key across runs. False in a browser, where
   * there is no OS keychain: the "Remember on this device" choice is not
   * offered, no remembered record is written, and `unlock` is unreachable.
   */
  readonly canRememberWallet: boolean;

  /** The stored app config, or `null` when the shell has none yet. */
  getConfig(): Promise<AppConfig | null>;
  setConfig(config: AppConfig): Promise<void>;

  /** The non-secret description of the remembered wallet; the key is separate. */
  getRemembered(): Promise<RememberedWallet | null>;
  /** Writes the record, or clears it when given `null`. */
  setRemembered(record: RememberedWallet | null): Promise<void>;

  /** Rejects where `canRememberWallet` is false. */
  rememberSecret(walletId: string, secret: string, passphrase?: string): Promise<void>;
  /** Rejects where `canRememberWallet` is false. */
  loadSecret(walletId: string): Promise<StoredSecret | null>;
  /** Rejects where `canRememberWallet` is false. */
  forgetSecret(walletId: string): Promise<void>;

  writeClipboard(text: string): Promise<void>;
  openUrl(url: string): Promise<void>;
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
