import { platform } from "../platform";
import { navigate } from "../router";
import { session } from "../session";
import { errorMessage } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, el, readout, sectionLabel, withBusy } from "../ui/dom";
import { icon } from "../ui/icons";

export function renderResult(): HTMLElement {
  const result = session.lastResult;
  if (!result) {
    navigate("dashboard");
    return el("main");
  }

  const alert = banner();
  if (result.persist_error) {
    alert.show(
      "warn",
      `Broadcast succeeded, but local wallet state was not saved (${result.persist_error}). It will reconcile on the next sync.`,
    );
  }

  const openBtn = button(
    "Open in explorer",
    () =>
      withBusy(openBtn, async () => {
        try {
          await platform().openUrl(result.explorer_url);
        } catch (e) {
          alert.show("error", `Could not open ${result.explorer_url}: ${errorMessage(e)}`);
        }
      }),
    "primary",
    "md",
    { name: "external" },
  );

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [el("h1", { text: "Sent" })]),
    alert.node,
    el("section", { className: "card result-card" }, [
      el("div", { className: "result-head" }, [
        el("span", { className: "check-circle" }, [icon("check", 18)]),
        el("div", { className: "stack-2" }, [
          el("span", { className: "result-title", text: "Transaction broadcast" }),
          el("span", { className: "hint", text: "It will show as pending until it confirms." }),
        ]),
      ]),
      el("div", { className: "stack-6" }, [
        sectionLabel("Transaction id"),
        el("div", { className: "address-row" }, [
          readout(result.txid, "readout-sm"),
          copyButton(() => result.txid),
        ]),
        el("span", { className: "hint mono break", text: result.explorer_url }),
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
