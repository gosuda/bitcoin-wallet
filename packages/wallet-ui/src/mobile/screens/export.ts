import QRCode from "qrcode";

import { api } from "../../api";
import { navigate } from "../../router";
import { session } from "../../session";
import { errorMessage, type PublicDescriptors } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, sectionLabel } from "../../ui/dom";
import { body, card, header, lede, row } from "../ui";

export function renderExport(): HTMLElement {
  const info = session.wallet;
  const host = el("main");
  if (!info) {
    navigate("setup");
    return host;
  }

  const alert = banner();
  const content = body(alert.node, lede("Loading…"));
  host.appendChild(header("Public keys", { back: "settings" }));
  host.appendChild(content);

  const paint = async (d: PublicDescriptors): Promise<void> => {
    const sections: HTMLElement[] = [];
    if (d.account_xpub !== null) {
      const canvas = el("canvas") as HTMLCanvasElement;
      const xpub = d.account_xpub;
      const keys = card(
        sectionLabel(
          `Account xpub${d.fingerprint === null ? "" : ` · fingerprint ${d.fingerprint}`}`,
        ),
        el("div", { className: "m-qr" }, [canvas]),
        el("span", { className: "m-mono-block", text: xpub }),
        row(copyButton(() => xpub, "Copy xpub")),
      );
      keys.classList.add("m-centre-items");
      sections.push(keys);
      try {
        await QRCode.toCanvas(canvas, xpub, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 150,
          color: { dark: "#1a1a1aff", light: "#ffffffff" },
        });
      } catch (e) {
        alert.show("warn", errorMessage(e));
      }
    }
    const both = d.internal === null ? d.external : `${d.external}\n${d.internal}`;
    sections.push(
      card(
        sectionLabel(d.internal === null ? "Descriptor" : "Receive descriptor"),
        el("span", { className: "m-mono-block", text: d.external }),
        d.internal === null ? null : sectionLabel("Change descriptor"),
        d.internal === null ? null : el("span", { className: "m-mono-block", text: d.internal }),
        copyButton(() => both, d.internal === null ? "Copy" : "Copy both"),
      ),
    );
    content.replaceChildren(
      alert.node,
      lede(
        "These reveal your history, not your funds. Share them only with a watch-only wallet you trust.",
      ),
      ...sections,
    );
  };

  void (async () => {
    try {
      await paint(await api.publicDescriptors());
    } catch (e) {
      content.replaceChildren(alert.node);
      alert.show("error", errorMessage(e));
    }
  })();

  return host;
}
