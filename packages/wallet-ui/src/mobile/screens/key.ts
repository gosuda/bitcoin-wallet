import { platform } from "../../platform";
import { navigate } from "../../router";
import { el } from "../../ui/dom";
import { NO_KEYSTORE_HINT } from "../../ui/remember";
import { body, button, card, header, spacer } from "../ui";
import { setRestoreMode } from "./restore";

export function renderKey(): HTMLElement {
  // Every type this screen can be reached with has an account layout: a config
  // naming P2PK, which has none, is sent back to Setup by the route guard.
  const open = (mode: "phrase" | "key" | "watch") => () => {
    setRestoreMode(mode);
    navigate("restore");
  };

  return el("main", {}, [
    header("Start a wallet", { back: "setup" }),
    body(
      card(
        el("span", { className: "m-card-title", text: "New wallet" }),
        el("p", {
          className: "m-lede",
          text: "Generates a 12-word recovery phrase. Write it down — it is the only way back in.",
        }),
        button("Create new wallet", () => navigate("create"), {
          variant: "primary",
          block: true,
        }),
      ),
      card(
        el("span", { className: "m-card-title", text: "Restore" }),
        el("p", {
          className: "m-lede",
          text: "Already have a recovery phrase from this or another wallet.",
        }),
        button("Restore from phrase", open("phrase"), { block: true }),
      ),
      card(
        el("span", { className: "m-card-title", text: "Watch-only" }),
        el("p", {
          className: "m-lede",
          text: "Follow a wallet by its xpub or descriptor. It shows balance and history and can receive, but cannot send.",
        }),
        button("Add watch-only wallet", open("watch"), { block: true, icon: "eye" }),
      ),
      platform().canRememberWallet ? null : el("p", { className: "hint", text: NO_KEYSTORE_HINT }),
      spacer(),
      button("Advanced: use a single key", open("key"), { variant: "quiet" }),
    ),
  ]);
}
