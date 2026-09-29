/**
 * The Tauri shell's half of the platform seam.
 *
 * The native side owns exactly two things: the config store (`get_config` /
 * `set_config`, plus the plugin store that holds the remembered-wallet record)
 * and the OS keystore (`remember_secret` / `load_secret` / `forget_secret`).
 * Nothing wallet-shaped crosses the IPC boundary.
 */

import type { Platform } from "@bitcoin-wallet/ui/platform";
import {
  type AppConfig,
  messageOf,
  type RememberedWallet,
  type StoredSecret,
} from "@bitcoin-wallet/ui/types";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load as loadStore } from "@tauri-apps/plugin-store";

/**
 * Sends chain requests through Rust instead of the webview.
 *
 * The wallet core runs as WASM in this webview and reqwest's browser backend
 * calls the global `fetch`, so every Esplora request is cross-origin and obeys
 * CORS. mempool.space and blockstream.info send `Access-Control-Allow-Origin`;
 * most self-hosted instances do not, and the browser then discards the reply
 * before the wallet sees it — the endpoint looks broken when it is fine. A
 * native app has no reason to be bound by a browser rule, so requests that
 * leave this origin are handed to the HTTP plugin, which performs them in Rust.
 *
 * Only cross-origin http(s) is diverted. App assets, the dev server and
 * anything relative stay on the webview's own `fetch`.
 *
 * The browser build has no such escape and still needs the header from the
 * server, which is why the wallet cannot simply assume every endpoint works.
 */
export function installNativeFetch(): void {
  const webFetch = globalThis.fetch.bind(globalThis);

  const leavesThisOrigin = (url: string): boolean => {
    try {
      const target = new URL(url, globalThis.location.href);
      return (
        (target.protocol === "https:" || target.protocol === "http:") &&
        target.origin !== globalThis.location.origin
      );
    } catch {
      return false;
    }
  };

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    return leavesThisOrigin(url) ? nativeFetch(input, init) : webFetch(input, init);
  };
}

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
 * message check rather than a plain rethrow. That error is a plain
 * `{ message }` object, not an `Error`, so it is read with `messageOf`.
 *
 * The camera permission is asked for here because on Android the plugin's
 * `scan` never asks: without the permission it fails at once, so the first
 * scan on a new install could never open the camera.
 *
 * `windowed` puts the camera behind the webview. Without it the plugin lays the
 * camera over the whole app with no control of its own, so nothing short of a
 * readable QR code could end a scan: Android's back key only moved the hidden
 * page, and iOS has no back key at all. Behind the page, the Scan screen stays
 * usable, and leaving it aborts `signal`, which is what stops the camera.
 *
 * Only a failure is cancelled on the way out. A read or a cancel has already put
 * the camera away, and `cancel` stops whatever scan is running: sent after every
 * scan, the one from a Scan screen that was just replaced (its tab tapped again)
 * could land after the new screen's scan had started, and stop it. On Android a
 * cancelled scan never settles at all — the plugin drops the call before it
 * rejects it — which costs nothing, since the screen waiting on it has gone.
 */
async function scanQr(signal?: AbortSignal): Promise<string | null> {
  const { scan, Format, cancel, checkPermissions, requestPermissions } = await import(
    "@tauri-apps/plugin-barcode-scanner"
  );
  let camera = await checkPermissions();
  if (camera !== "granted") camera = await requestPermissions();
  if (camera !== "granted") {
    throw new Error(
      "Camera access was refused. Allow it in Settings and try again, or paste the address.",
    );
  }
  // The permission prompt can outlast the screen that asked for it.
  if (signal?.aborted) return null;
  const stop = (): void => void cancel().catch(() => undefined);
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const result = await scan({ windowed: true, formats: [Format.QRCode] });
    return result.content;
  } catch (e) {
    if (/cancel/i.test(messageOf(e) ?? "")) return null;
    // A scan that failed may have left the camera running behind the page.
    await cancel().catch(() => undefined);
    throw e;
  } finally {
    signal?.removeEventListener("abort", stop);
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
