import { platform } from "../../platform";
import { navigate } from "../../router";
import { session } from "../../session";
import { errorMessage } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, sectionLabel } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { body, button, card, header, spacer } from "../ui";

export function renderResult(): HTMLElement {
  const result = session.lastResult;
  const host = el("main");
  if (!result) {
    navigate("dashboard");
    return host;
  }

  const alert = banner();

  host.appendChild(header("Sent"));
  host.appendChild(
    body(
      alert.node,
      el("div", { className: "m-centre" }, [
        el("span", { className: "m-badge" }, [icon("check", 36)]),
        el("div", {}, [
          el("p", { className: "m-card-title", text: "Broadcast" }),
          el("p", { className: "m-lede", text: "The network has the transaction." }),
        ]),
      ]),
      card(
        sectionLabel("Transaction id"),
        el("p", {
          className: "m-address",
          text: result.txid,
        }),
      ),
      // A local persistence failure is not a failed send, and saying so plainly
      // matters: the money moved either way.
      result.persist_error
        ? el("p", {
            className: "hint",
            text: `Sent, but this device could not save it locally: ${result.persist_error}. A sync will pick it up.`,
          })
        : null,
      spacer(),
      copyButton(() => result.txid, "Copy txid"),
      // Regtest has no public explorer: no link rather than a dead one.
      result.explorer_url
        ? button(
            "Open in explorer",
            async () => {
              try {
                await platform().openUrl(result.explorer_url ?? "");
              } catch (e) {
                alert.show("warn", errorMessage(e));
              }
            },
            { icon: "external" },
          )
        : null,
      button("Back to wallet", () => navigate("dashboard"), { variant: "primary", block: true }),
    ),
  );
  return host;
}
