import { boot, showBootFailure } from "@bitcoin-wallet/ui";
import { setPlatform } from "@bitcoin-wallet/ui/platform";
import { browserPlatform } from "./platform-browser";

setPlatform(browserPlatform);
boot().catch(showBootFailure);
