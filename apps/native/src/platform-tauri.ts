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

/**
 * Asks the native side whether the OS credential store actually works here.
 *
 * Answering this at startup, rather than assuming, is what stops the app
 * offering "Remember on this device" on a build that cannot honour it — an
 * unsigned iOS build has empty entitlements, so every keychain call fails.
 * Any failure to ask is itself treated as "no".
 */
export async function keystoreAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>("keystore_available");
  } catch {
    return false;
  }
}

/**
 * Reads one QR code with the camera, or `null` when the user backs out.
 *
 * The plugin is imported lazily so the desktop bundle never loads it, and a
 * cancel is reported by the plugin as an error rather than a value — hence the
 * message check rather than a plain rethrow.
 */
async function scanQr(): Promise<string | null> {
  const { scan, Format, cancel } = await import("@tauri-apps/plugin-barcode-scanner");
  try {
    const result = await scan({ windowed: false, formats: [Format.QRCode] });
    return result.content;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(message)) return null;
    throw e;
  } finally {
    // Leaving the camera running would keep the preview over the next screen.
    await cancel().catch(() => undefined);
  }
}

async function authenticate(reason: string): Promise<void> {
  const { authenticate: prompt, checkStatus } = await import("@tauri-apps/plugin-biometric");
  const status = await checkStatus();
  // No enrolled biometrics is not a failure to authenticate — it just means
  // there is nothing to ask, and the OS key store is still the boundary.
  if (!status.isAvailable) return;
  await prompt(reason, { allowDeviceCredential: true });
}

export function tauriPlatform(canRememberWallet: boolean, mobile: boolean): Platform {
  return {
    canRememberWallet,
    ...(mobile ? { scanQr, authenticate } : {}),

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
}
