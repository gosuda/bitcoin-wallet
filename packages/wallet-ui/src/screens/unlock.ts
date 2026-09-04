import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import { ADDRESS_TYPE_LABELS, backendHost, errorMessage, NETWORK_LABELS } from "../types";
import { banner, button, el, kv, mono, withBusy } from "../ui/dom";
import { icon } from "../ui/icons";
import { KEYCHAIN_NAME } from "../ui/remember";

export function renderUnlock(): HTMLElement {
  const cfg = session.config;
  const remembered = session.remembered;
  if (!cfg) {
    navigate("setup");
    return el("main");
  }
  if (!remembered) {
    navigate("key");
    return el("main");
  }

  const alert = banner();

  const unlockBtn = button(
    "Unlock",
    () =>
      withBusy(unlockBtn, async () => {
        alert.hide();
        try {
          const info = await api.unlockWallet();
          session.wallet = info;
          session.lastSyncedAt = null;
          navigate("dashboard");
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "primary",
    "md",
    { name: "key" },
  );

  // Two-step inline confirm: the slot swaps between the trigger and the prompt.
  const forgetSlot = el("span", { className: "push-end" });
  const showTrigger = () => {
    forgetSlot.replaceChildren(forgetBtn);
  };
  const forgetBtn = button("Forget this wallet", () => showConfirm(), "quiet");
  forgetBtn.classList.add("btn-quiet-danger");
  const showConfirm = () => {
    const yesBtn = button(
      "Yes, forget",
      () =>
        withBusy(yesBtn, async () => {
          alert.hide();
          try {
            await api.forgetWallet();
            session.remembered = null;
            session.wallet = null;
            session.lastSyncedAt = null;
            session.lastResult = null;
            navigate("key");
          } catch (e) {
            alert.show("error", errorMessage(e));
            showTrigger();
          }
        }),
      "danger",
      "sm",
    );
    forgetSlot.replaceChildren(
      el("span", { className: "confirm-inline", attrs: { role: "group" } }, [
        "Really forget? ",
        yesBtn,
        button("Cancel", showTrigger, "quiet", "sm"),
      ]),
    );
    yesBtn.focus();
  };
  showTrigger();

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Unlock" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[cfg.network]} · ${backendHost(cfg.backend)}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card unlock-card" }, [
      el("div", { className: "unlock-head" }, [
        el("span", { className: "key-circle" }, [icon("key", 18)]),
        el("div", { className: "stack-2" }, [
          el("span", { className: "unlock-title", text: "Wallet saved on this device" }),
          el("span", {
            className: "hint",
            text: `The key is kept in the ${KEYCHAIN_NAME}. Unlocking may ask for your login password.`,
          }),
        ]),
      ]),
      kv([
        ["Address", mono(remembered.address)],
        [
          "Network",
          `${NETWORK_LABELS[remembered.network]} · ${ADDRESS_TYPE_LABELS[remembered.address_type]}`,
        ],
        ["Wallet id", mono(remembered.wallet_id)],
      ]),
      el("div", { className: "actions" }, [
        unlockBtn,
        button("Use a different key", () => navigate("key")),
        forgetSlot,
      ]),
    ]),
  ]);
}
