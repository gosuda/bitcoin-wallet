import { openUrl } from "@tauri-apps/plugin-opener";
import { navigate } from "../router";
import { session } from "../session";
import { errorMessage } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, el, mono, withBusy } from "../ui/dom";

export function renderResult(): HTMLElement {
  const result = session.lastResult;
  if (!result) {
    navigate("dashboard");
    return el("main");
  }

  const alert = banner();
  alert.show("ok", "Transaction broadcast. It will appear as pending until confirmed.");

  const openBtn = button("Open in explorer", () =>
    withBusy(openBtn, async () => {
      try {
        await openUrl(result.explorer_url);
      } catch (e) {
        alert.show("error", `Could not open ${result.explorer_url}: ${errorMessage(e)}`);
      }
    }),
  );

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [el("h1", { text: "Sent" })]),
    alert.node,
    el("section", { className: "card" }, [
      el("h2", { text: "Transaction id" }),
      el("div", { className: "address-row" }, [mono(result.txid), copyButton(() => result.txid)]),
      el("p", { className: "muted small mono break", text: result.explorer_url }),
      el("div", { className: "actions" }, [
        openBtn,
        button(
          "Back to wallet",
          () => {
            session.lastResult = null;
            navigate("dashboard");
          },
          "primary",
        ),
      ]),
    ]),
  ]);
}
