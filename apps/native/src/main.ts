import { boot } from "@bitcoin-wallet/ui";
import { setPlatform } from "@bitcoin-wallet/ui/platform";
import { tauriPlatform } from "./platform-tauri";

setPlatform(tauriPlatform);
void boot();
