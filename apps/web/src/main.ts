import { boot, showBootFailure } from "@bitcoin-wallet/ui";
import { installChainFetch } from "@bitcoin-wallet/ui/net";
import { setPlatform } from "@bitcoin-wallet/ui/platform";
import { browserPlatform } from "./platform-browser";

// Before the core can send anything: each chain request gets its time limit here.
installChainFetch();
setPlatform(browserPlatform);
boot().catch(showBootFailure);
