import { api } from "../../api";
import { redirect, screenGuard } from "../../screen";
import { session } from "../../session";
import { errorMessage, type PublicDescriptors } from "../../types";
import { copyButton } from "../../ui/clipboard";
import { banner, el, sectionLabel } from "../../ui/dom";
import { drawQr } from "../../ui/qr";
import { copyDescriptorsLabel, PUBLIC_KEYS_NOTE } from "../../ui/text";
import { body, card, header, lede, row } from "../ui";

export function renderExport(): HTMLElement {
  const info = session.wallet;
  if (!info) return redirect("setup");
  const host = el("main");
  const onScreen = screenGuard();

  const alert = banner();
  const content = body(alert.node, lede("Loading…"));
  host.appendChild(header("Public keys", { back: "settings" }));
  host.appendChild(content);

  const paint = async (d: PublicDescriptors): Promise<void> => {
    const sections: HTMLElement[] = [];
    if (d.account_xpub !== null) {
      const canvas = el("canvas");
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
      await drawQr(canvas, xpub, 150, alert);
      if (!onScreen()) return;
    }
    const both = d.internal === null ? d.external : `${d.external}\n${d.internal}`;
    sections.push(
      card(
        sectionLabel(d.internal === null ? "Descriptor" : "Receive descriptor"),
        el("span", { className: "m-mono-block", text: d.external }),
        d.internal === null ? null : sectionLabel("Change descriptor"),
        d.internal === null ? null : el("span", { className: "m-mono-block", text: d.internal }),
        copyButton(() => both, copyDescriptorsLabel(d.internal !== null)),
      ),
    );
    content.replaceChildren(alert.node, lede(PUBLIC_KEYS_NOTE), ...sections);
  };

  void (async () => {
    try {
      const descriptors = await api.publicDescriptors();
      if (!onScreen()) return;
      await paint(descriptors);
    } catch (e) {
      if (!onScreen()) return;
      content.replaceChildren(alert.node);
      alert.show("error", errorMessage(e));
    }
  })();

  return host;
}
