import { boot } from "@bitcoin-wallet/ui";
import { setPlatform } from "@bitcoin-wallet/ui/platform";
import { keystoreAvailable, tauriPlatform } from "./platform-tauri";

/**
 * Tauri sets this for the `beforeDev`/`beforeBuild` command, and the Vite
 * config exposes the `TAURI_ENV_*` prefix, so the target platform is a
 * build-time constant here. That matters: it lets the desktop bundle drop the
 * phone screens entirely instead of shipping both and choosing at runtime.
 */
const PLATFORM = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;
const MOBILE = PLATFORM === "ios" || PLATFORM === "android";

// Whether a key can outlive the session is a runtime fact here, not a build-time
// one: the same binary has a working keychain on desktop and none on an unsigned
// iOS build. Ask before anything renders, so the UI never offers to remember a
// key it would then drop.
/**
 * Routes a `bitcoin:` URI to the Send screen with the payment filled in.
 *
 * Both entries matter: `getCurrent` covers a link that launched the app, and
 * `onOpenUrl` covers one that arrives while it is already running. A link that
 * lands before a wallet is open is deliberately dropped rather than queued —
 * the route guard would bounce it to setup anyway, and a payment silently
 * reappearing several screens later is worse than nothing.
 */
async function wireDeepLinks(): Promise<void> {
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const { parsePaymentUri } = await import("@bitcoin-wallet/ui/bip21");
  const { prefillSend } = await import("@bitcoin-wallet/ui/mobile-send");

  const handle = (urls: readonly string[] | null): void => {
    const payment = urls?.map(parsePaymentUri).find((p) => p !== null);
    if (!payment) return;
    prefillSend({
      address: payment.address,
      ...(payment.amountSat === undefined ? {} : { amountSat: payment.amountSat }),
    });
    window.location.hash = "#/send";
  };

  await onOpenUrl((urls) => handle(urls));
  handle(await getCurrent());
}

async function main(): Promise<void> {
  setPlatform(tauriPlatform(await keystoreAvailable(), MOBILE));
  if (MOBILE) {
    // Imported here, behind a build-time constant, so the desktop bundle does
    // not merely skip the phone shell at runtime — it never contains it.
    const { mount } = await import("@bitcoin-wallet/ui/mobile-shell");
    await boot({ mount });
  } else {
    await boot();
  }
  // After boot: the handler navigates, so the shell must already be listening.
  if (MOBILE) await wireDeepLinks().catch(() => undefined);
}

void main();
