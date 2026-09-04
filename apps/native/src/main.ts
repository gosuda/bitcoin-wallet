import { boot } from "@bitcoin-wallet/ui";
import { setPlatform } from "@bitcoin-wallet/ui/platform";
import { keystoreAvailable, tauriPlatform } from "./platform-tauri";

// Whether a key can outlive the session is a runtime fact here, not a build-time
// one: the same binary has a working keychain on desktop and none on an unsigned
// iOS build. Ask before anything renders, so the UI never offers to remember a
// key it would then drop.
async function main(): Promise<void> {
  setPlatform(tauriPlatform(await keystoreAvailable()));
  await boot();
}

void main();
