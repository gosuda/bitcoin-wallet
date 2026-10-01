import { api } from "../api";
import { platform } from "../platform";
import { navigate } from "../router";
import { routeGuard } from "../screen";
import { session } from "../session";
import {
  ADDRESS_TYPE_LABELS,
  backendHost,
  errorMessage,
  isAppError,
  NETWORK_LABELS,
} from "../types";
import { banner, button, el, kv, mono, withBusy } from "../ui/dom";
import { shortId } from "../ui/format";
import { icon } from "../ui/icons";
import { appPasswordField, KEYCHAIN_NAME } from "../ui/remember";
import { historyReset } from "../ui/reset";
import { forgetWarning, OPENED_WITH, sentence } from "../ui/text";

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

  // `routeGuard`, not `screenGuard`: unlocking is what sets `session.wallet`.
  const onScreen = routeGuard();
  const alert = banner();
  const offer = historyReset(alert);

  // The browser seals the key under the app password, asked for here every
  // time (2e). An OS keystore asks for nothing (2b).
  const password = platform().needsAppPassword
    ? appPasswordField("App password", "app_password")
    : null;
  password?.node.classList.add("unlock-password");

  const unlock = async (reset = false): Promise<void> => {
    alert.hide();
    password?.setError(null);
    const appPassword = password?.input.value;
    try {
      await (reset ? api.resetHistoryAndUnlock(appPassword) : api.unlockWallet(appPassword));
      if (onScreen()) navigate("dashboard");
    } catch (e) {
      if (!onScreen()) return;
      // A wrong password is said under its field, and nothing else changes.
      if (password && isAppError(e) && e.code === "wrong_password") {
        password.setError(sentence(errorMessage(e)));
        password.input.focus();
        password.input.select();
      } else {
        offer.report(e, () => unlock(true));
      }
    }
  };
  // A password is needed before there is anything to try.
  const gate = () => {
    unlockBtn.disabled = password !== null && password.input.value === "";
  };
  // `withBusy` enables the button again, so the gate is put back once it settles.
  const unlockBtn = button(
    "Unlock",
    () => void withBusy(unlockBtn, unlock).finally(gate),
    "primary",
    "md",
    { name: "key" },
  );
  if (password) {
    password.input.addEventListener("input", () => {
      password.setError(null);
      gate();
    });
    password.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") unlockBtn.click();
    });
    gate();
  }

  // Two-step inline confirm: the slot swaps between the trigger and the prompt.
  const forgetSlot = el("span", { className: "push-end" });
  const showTrigger = () => {
    forgetSlot.replaceChildren(forgetBtn);
  };
  const forgetBtn = button("Forget this wallet", () => showConfirm(), "quiet");
  forgetBtn.classList.add("btn-quiet-danger");
  // The second step Settings has, in the same words: what is deleted and
  // what brings the wallet back, then Keep it or Delete it.
  const confirmSlot = el("div", { className: "slot" });
  // Focus goes back to the trigger: the button that had it is gone, and a
  // keyboard or screen reader was left at the page. Found by cubic.
  const closeConfirm = () => {
    confirmSlot.replaceChildren();
    forgetBtn.focus();
  };
  const showConfirm = () => {
    const yes = button(
      "Delete it",
      () =>
        withBusy(yes, async () => {
          alert.hide();
          try {
            await api.forgetWallet();
            session.remembered = null;
            navigate("key");
          } catch (e) {
            alert.show("error", errorMessage(e));
            closeConfirm();
          }
        }),
      "danger",
    );
    // Read out with the button, which alone says only "Delete it".
    yes.setAttribute("aria-describedby", "forget-warning");
    confirmSlot.replaceChildren(
      el("section", { className: "card danger-card" }, [
        el("span", {
          className: "muted",
          text: forgetWarning(null),
          attrs: { id: "forget-warning" },
        }),
        el("div", { className: "actions actions-end" }, [
          button("Keep it", closeConfirm, "quiet"),
          yes,
        ]),
      ]),
    );
    yes.focus();
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
    offer.node,
    el("section", { className: "card unlock-card" }, [
      el("div", { className: "unlock-head" }, [
        el("span", { className: "key-circle" }, [icon("key", 18)]),
        el("div", { className: "stack-2" }, [
          el("span", {
            className: "unlock-title",
            text: password ? "Wallet saved in this browser" : "Wallet saved on this device",
          }),
          el("span", {
            className: "hint",
            text: password
              ? "Its key is encrypted with your app password and kept in this browser's storage."
              : `The key is kept in the ${KEYCHAIN_NAME}. Unlocking may ask for your login password.`,
          }),
        ]),
      ]),
      kv([
        ["Address", mono(shortId(remembered.address))],
        [
          "Network",
          `${NETWORK_LABELS[remembered.network]} · ${ADDRESS_TYPE_LABELS[remembered.address_type]}`,
        ],
        ["Wallet id", mono(remembered.wallet_id)],
      ]),
      password?.node,
      el("div", { className: "actions" }, [
        unlockBtn,
        button("Use a different wallet", () => navigate("key")),
        forgetSlot,
      ]),
      confirmSlot,
      password
        ? el("span", {
            className: "hint",
            text: `Forgotten it? It cannot be reset. Forget this wallet here, and open it again with ${OPENED_WITH}.`,
          })
        : null,
    ]),
  ]);
}
