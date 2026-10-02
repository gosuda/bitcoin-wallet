import { api } from "../../api";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { redirect, routeGuard } from "../../screen";
import { session } from "../../session";
import { ADDRESS_TYPE_LABELS, NETWORK_LABELS } from "../../types";
import { banner, el } from "../../ui/dom";
import { shortId } from "../../ui/format";
import { icon } from "../../ui/icons";
import { forgetThisWallet } from "../../ui/settings";
import { forgetWarning } from "../../ui/text";
import { body, button, confirmDanger, header, historyReset, spacer, withBusy } from "../ui";

export function renderUnlock(): HTMLElement {
  const record = session.remembered;
  if (!record) return redirect("key");
  const host = el("main");

  // `routeGuard`, not `screenGuard`: unlocking is what sets `session.wallet`.
  const onScreen = routeGuard();
  const alert = banner();
  const offer = historyReset(alert);
  const auth = platform().authenticate;

  const attempt = async (reset = false): Promise<void> => {
    alert.hide();
    try {
      // The key lives in the OS key store either way; this only gates
      // reading it, so a device without biometrics still opens normally.
      if (auth) await auth("Unlock this wallet");
      await (reset ? api.resetHistoryAndUnlock() : api.unlockWallet());
      if (onScreen()) navigate("dashboard");
    } catch (e) {
      if (!onScreen()) return;
      // Unlocking again would fail the same way, so the reset stands where
      // Unlock was, as the canvas draws it.
      if (offer.report(e, () => attempt(true))) unlock.replaceWith(offer.node);
      else offer.node.replaceWith(unlock);
    }
  };
  // Unlock with or without biometrics, as the desktop's says.
  const unlock = button("Unlock", () => withBusy(unlock, attempt), {
    variant: "primary",
    block: true,
    icon: auth ? "faceid" : "key",
  });

  // Two taps: this deletes the saved key and the local history, and the
  // desktop screen already asked twice.
  const forget = confirmDanger({
    trigger: "Forget this wallet",
    triggerVariant: "quiet",
    // No wallet is open here and the remembered record does not say which kind
    // this is, so it names every way back rather than promising a recovery
    // phrase a single-key or watch-only wallet never had. A passphrase and a
    // bare xpub are two of those ways, and the app offers both.
    text: forgetWarning(null),
    confirm: "Delete it",
    onConfirm: () => forgetThisWallet(alert, "key"),
  });

  host.appendChild(header("Unlock"));
  host.appendChild(
    body(
      alert.node,
      el("div", { className: "m-centre" }, [
        el("span", { className: "m-badge" }, [icon(auth ? "faceid" : "key", 36)]),
        el("div", {}, [
          el("p", { className: "m-card-title", text: "Wallet saved on this device" }),
          el("p", { className: "m-address", text: shortId(record.address) }),
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
