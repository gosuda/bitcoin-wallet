import { platform } from "../../platform";
import { navigate } from "../../router";
import { redirect } from "../../screen";
import { session } from "../../session";
import { errorMessage } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, sectionLabel } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { explorerFailed, SENT_LINE, SENT_TITLE, sentNotSaved } from "../../ui/text";
import { body, button, card, header, lede, spacer } from "../ui";

export function renderResult(): HTMLElement {
  const result = session.lastResult;
  if (!result) return redirect("dashboard");
  const host = el("main");

  const alert = banner();

  host.appendChild(header("Sent"));
  host.appendChild(
    body(
      alert.node,
      el("div", { className: "m-centre" }, [
        el("span", { className: "m-badge" }, [icon("check", 36)]),
        el("div", {}, [el("p", { className: "m-card-title", text: SENT_TITLE }), lede(SENT_LINE)]),
      ]),
      card(
        sectionLabel("Transaction id"),
        el("p", {
          className: "m-mono-block",
          text: result.txid,
        }),
      ),
      // A local persistence failure is not a failed send, and saying so plainly
      // matters: the money moved either way.
      result.persist_error
        ? el("p", {
            className: "hint",
            text: sentNotSaved(result.persist_error),
          })
        : null,
      spacer(),
      copyButton(() => result.txid, "Copy transaction id"),
      // Regtest has no public explorer: no link rather than a dead one.
      result.explorer_url
        ? button(
            "Open in explorer",
            async () => {
              try {
                await platform().openUrl(result.explorer_url ?? "");
              } catch (e) {
                alert.show("warn", explorerFailed(errorMessage(e)));
              }
            },
            { icon: "external" },
          )
        : null,
      button(
        "Back to wallet",
        () => {
          // Spent, as on the desktop: the result route has nothing to show again.
          session.lastResult = null;
          navigate("dashboard");
        },
        { variant: "primary", block: true },
      ),
    ),
  );
  return host;
}
