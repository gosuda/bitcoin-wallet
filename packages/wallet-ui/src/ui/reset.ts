/**
 * What a screen offers when a wallet's saved history on this device cannot be
 * read (`historyResetFixes`): the error, and a reset of that history in two
 * steps, as Forget has. That history is deleted, and with it which coins are
 * frozen, since freezing is saved in the same record; the key and the
 * settings stay. Both shells use the words below, and the phone draws them
 * with its own `historyReset` in `mobile/ui.ts`.
 */

import { errorMessage, historyResetFixes } from "../types";
import { type Banner, button, el, withBusy } from "./dom";
import { icon } from "./icons";
import { sentence } from "./text";

export const RESET_TRIGGER = "Reset this device's history";
export const RESET_TEXT =
  "The key stays on this device. The history saved here is deleted and downloaded again on the next sync, and any coin you froze is unfrozen.";
export const RESET_CONFIRM = "Reset history";

export interface HistoryReset {
  /** Where the offer appears. Empty, it takes no room. */
  readonly node: HTMLElement;
  /**
   * Says why a wallet did not open: in the offer when a reset fixes it, in
   * the screen's banner otherwise. Confirming the reset runs `reset`, which
   * opens the same wallet again through the api's reset. True when the reset
   * is offered.
   */
  report(error: unknown, reset: () => Promise<void>): boolean;
}

/** The desktop's: a danger card with the error, then a second step like Settings' Forget. */
export function historyReset(alert: Banner): HistoryReset {
  const node = el("div", { className: "reset-offer" });
  return {
    node,
    report(error, reset) {
      if (!historyResetFixes(error)) {
        node.replaceChildren();
        alert.show("error", errorMessage(error));
        return false;
      }
      alert.hide();
      const step = el("div", { className: "slot" });
      const trigger = button(RESET_TRIGGER, () => {
        const yes = button(RESET_CONFIRM, () => withBusy(yes, reset), "primary");
        const keep = button(
          "Keep it",
          () => {
            step.replaceChildren();
            trigger.focus();
          },
          "quiet",
        );
        step.replaceChildren(
          el("section", { className: "card accent-card" }, [
            el("span", { className: "muted", text: RESET_TEXT }),
            el("div", { className: "actions actions-end" }, [keep, yes]),
          ]),
        );
        yes.focus();
      });
      node.replaceChildren(
        el("section", { className: "card danger-card" }, [
          el("p", { className: "reset-message", attrs: { role: "alert" } }, [
            icon("alert", 16),
            el("span", { text: sentence(errorMessage(error)) }),
          ]),
          el("div", { className: "actions" }, [trigger]),
        ]),
        step,
      );
      return true;
    },
  };
}
