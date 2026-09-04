import { api } from "../../api";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { session } from "../../session";
import { ADDRESS_TYPE_LABELS, backendHost, errorMessage, NETWORK_LABELS } from "../../types";
import { banner, el } from "../../ui/dom";
import { body, button, header, item, listCard, spacer } from "../ui";

export function renderSettings(): HTMLElement {
  const info = session.wallet;
  const cfg = session.config;
  const host = el("main");
  if (!info || !cfg) {
    navigate("setup");
    return host;
  }

  const alert = banner();

  // Two-step, because forgetting is the one action here that destroys
  // something: the keystore entry and the local chain state both go.
  const forgetHost = el("div");
  const forget = button(
    "Forget this wallet",
    () => {
      forgetHost.replaceChildren(
        el("p", {
          className: "m-lede",
          text: "The saved key and this device's copy of the wallet history will be deleted. Your recovery phrase still restores it.",
        }),
        button(
          "Delete it",
          async () => {
            try {
              await api.forgetWallet();
              session.remembered = null;
              navigate("setup");
            } catch (e) {
              alert.show("error", errorMessage(e));
            }
          },
          { variant: "danger", block: true },
        ),
        button("Keep it", () => forgetHost.replaceChildren(), { variant: "quiet" }),
      );
    },
    { variant: "danger", block: true },
  );

  host.appendChild(header("Settings"));
  host.appendChild(
    body(
      alert.node,
      listCard(
        item("Network", NETWORK_LABELS[cfg.network]),
        item("Esplora server", backendHost(cfg.backend)),
        item("Address type", ADDRESS_TYPE_LABELS[cfg.address_type]),
        item("Wallet", info.is_hd ? "Recovery phrase (HD)" : "Single key"),
      ),
      listCard(
        item(
          "Remembered on this device",
          platform().canRememberWallet ? (session.remembered ? "Yes" : "No") : "Not available here",
        ),
      ),
      listCard(
        item("Close wallet", null, async () => {
          await api.closeWallet();
          navigate("setup");
        }),
      ),
      spacer(),
      forgetHost,
      forget,
      el("p", { className: "m-txmeta", text: info.wallet_id }),
    ),
  );
  return host;
}
