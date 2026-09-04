/**
 * The Tauri shell's half of the platform seam.
 *
 * The native side owns exactly two things: the config store (`get_config` /
 * `set_config`, plus the plugin store that holds the remembered-wallet record)
 * and the OS keystore (`remember_secret` / `load_secret` / `forget_secret`).
 * Nothing wallet-shaped crosses the IPC boundary.
 */

import type { Platform } from "@bitcoin-wallet/ui/platform";
import type { AppConfig, RememberedWallet, StoredSecret } from "@bitcoin-wallet/ui/types";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load as loadStore } from "@tauri-apps/plugin-store";

const STORE_FILE = "config.json";
const REMEMBERED_KEY = "remembered_wallet";

export const tauriPlatform: Platform = {
  canRememberWallet: true,

  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (config) => invoke<void>("set_config", { config }),

  async getRemembered(): Promise<RememberedWallet | null> {
    const store = await loadStore(STORE_FILE);
    return (await store.get<RememberedWallet>(REMEMBERED_KEY)) ?? null;
  },

  async setRemembered(record): Promise<void> {
    const store = await loadStore(STORE_FILE);
    if (record) await store.set(REMEMBERED_KEY, record);
    else await store.delete(REMEMBERED_KEY);
    await store.save();
  },

  rememberSecret: (walletId, secret, passphrase) =>
    invoke<void>("remember_secret", { walletId, secret, passphrase: passphrase ?? null }),
  loadSecret: (walletId) => invoke<StoredSecret | null>("load_secret", { walletId }),
  forgetSecret: (walletId) => invoke<void>("forget_secret", { walletId }),

  writeClipboard: (text) => writeText(text),
  openUrl: (url) => openUrl(url),
};
