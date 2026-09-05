import { api } from "../../api";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { session } from "../../session";
import { ADDRESS_TYPE_LABELS, errorMessage, NETWORK_LABELS } from "../../types";
import { banner, el } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { body, button, confirmDanger, header, spacer, withBusy } from "../ui";

function short(address: string): string {
  return address.length > 22 ? `${address.slice(0, 12)}…${address.slice(-6)}` : address;
}

export function renderUnlock(): HTMLElement {
  const record = session.remembered;
  const host = el("main");
  if (!record) {
    navigate("key");
    return host;
  }

  const alert = banner();
  const auth = platform().authenticate;

  const unlock = button(
    auth ? "Unlock" : "Open wallet",
    () =>
      withBusy(unlock, async () => {
        alert.hide();
        try {
          // The key lives in the OS key store either way; this only gates
          // reading it, so a device without biometrics still opens normally.
          if (auth) await auth("Unlock your wallet");
          await api.unlockWallet();
          navigate("dashboard");
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    { variant: "primary", block: true, icon: auth ? "faceid" : "key" },
  );

  // Two taps: this deletes the saved key and the local history, and the
  // desktop screen already asked twice.
  const forget = confirmDanger({
    trigger: "Forget this wallet",
    triggerVariant: "quiet",
    text: "The saved key and this device's copy of the wallet history will be deleted. Your recovery phrase still restores it.",
    confirm: "Delete it",
    onConfirm: async () => {
      alert.hide();
      try {
        await api.forgetWallet();
        session.remembered = null;
        navigate("key");
      } catch (e) {
        alert.show("error", errorMessage(e));
      }
    },
  });

  host.appendChild(header("Unlock"));
  host.appendChild(
    body(
      alert.node,
      el("div", { className: "m-centre" }, [
        el("span", { className: "m-badge" }, [icon(auth ? "faceid" : "key", 36)]),
        el("div", {}, [
          el("p", { className: "m-card-title", text: "Wallet saved on this device" }),
          el("p", { className: "m-address", text: short(record.address) }),
          el("p", {
            className: "m-txmeta",
            text: `${NETWORK_LABELS[record.network]} · ${ADDRESS_TYPE_LABELS[record.address_type]}`,
          }),
        ]),
      ]),
      spacer(),
      unlock,
      button("Use a different wallet", () => navigate("key"), { variant: "quiet" }),
      forget,
    ),
  );
  return host;
}
