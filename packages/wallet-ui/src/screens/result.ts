import { platform } from "../platform";
import { navigate } from "../router";
import { redirect, screenHead } from "../screen";
import { session } from "../session";
import { errorMessage } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, el, readout, sectionLabel, withBusy } from "../ui/dom";
import { icon } from "../ui/icons";
import { explorerFailed, SENT_LINE, SENT_TITLE, sentNotSaved } from "../ui/text";

export function renderResult(): HTMLElement {
  const result = session.lastResult;
  if (!result) return redirect("dashboard");

  const alert = banner();
  if (result.persist_error) {
    alert.show("warn", sentNotSaved(result.persist_error));
  }

  // Regtest has no public explorer: no link rather than a dead one.
  const explorer = result.explorer_url;
  let openBtn: HTMLButtonElement | null = null;
  openBtn = explorer
    ? button(
        "Open in explorer",
        () =>
          withBusy(openBtn as HTMLButtonElement, async () => {
            try {
              await platform().openUrl(explorer);
            } catch (e) {
              alert.show("warn", explorerFailed(errorMessage(e)));
            }
          }),
        "primary",
        "md",
        { name: "external" },
      )
    : null;

  return el("main", { className: "screen" }, [
    screenHead("Sent"),
    alert.node,
    el("section", { className: "card result-card" }, [
      el("div", { className: "result-head" }, [
        el("span", { className: "check-circle" }, [icon("check", 18)]),
        el("div", { className: "stack-2" }, [
          el("span", { className: "result-title", text: SENT_TITLE }),
          el("span", { className: "hint", text: SENT_LINE }),
        ]),
      ]),
      el("div", { className: "stack-6" }, [
        sectionLabel("Transaction id"),
        el("div", { className: "address-row" }, [
          readout(result.txid, "readout-sm"),
          copyButton(() => result.txid, "Copy transaction id"),
        ]),
        explorer ? el("span", { className: "hint mono break", text: explorer }) : null,
      ]),
      el("div", { className: "actions" }, [
        openBtn,
        button("Back to wallet", () => {
          session.lastResult = null;
          navigate("dashboard");
        }),
      ]),
    ]),
  ]);
}
