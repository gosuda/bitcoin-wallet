import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import { backendHost, errorMessage, type GeneratedKey, NETWORK_LABELS } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, el, field, mono, textInput, withBusy } from "../ui/dom";

function secretLine(label: string, value: string): HTMLElement {
  return el("div", { className: "secret-line" }, [
    el("span", { className: "muted small", text: label }),
    mono(value),
    copyButton(() => value),
  ]);
}

export function renderKey(): HTMLElement {
  const cfg = session.config;
  if (!cfg) {
    navigate("setup");
    return el("main");
  }

  const alert = banner();
  const secret = textInput({
    type: "password",
    placeholder: "64-char hex or WIF",
    mono: true,
    name: "secret",
  });
  const generated = el("div", { className: "hidden" });

  const showGenerated = (key: GeneratedKey) => {
    generated.className = "secret-box";
    generated.replaceChildren(
      el("p", {
        className: "small",
        text: "Shown once. Copy the private key now; it is not stored anywhere.",
      }),
      secretLine("priv hex", key.priv_hex),
      secretLine("WIF", key.wif),
      secretLine("address", key.address),
      el("div", { className: "actions" }, [
        button(
          "Use this key",
          () => {
            secret.value = key.priv_hex;
            secret.focus();
          },
          "default",
          "sm",
        ),
      ]),
    );
  };

  const generateBtn = button("Generate new key", () =>
    withBusy(generateBtn, async () => {
      alert.hide();
      try {
        const key = await api.generateKey(cfg.network, cfg.address_type);
        showGenerated(key);
        alert.show(
          "warn",
          "Back up the private key before funding this address. Losing it loses the funds.",
        );
      } catch (e) {
        alert.show("error", errorMessage(e));
      }
    }),
  );

  const openBtn = button(
    "Open wallet",
    () =>
      withBusy(openBtn, async () => {
        alert.hide();
        const value = secret.value.trim();
        if (!value) {
          alert.show("error", "Enter a private key (hex or WIF) or generate one.");
          return;
        }
        try {
          const info = await api.openWallet(value, cfg.address_type);
          secret.value = "";
          generated.replaceChildren();
          generated.className = "hidden";
          session.wallet = info;
          session.lastSyncedAt = null;
          navigate("dashboard");
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "primary",
  );

  secret.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") openBtn.click();
  });

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Key" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[cfg.network]} · ${backendHost(cfg.backend)}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card" }, [
      field(
        "Private key",
        secret,
        "Hex (64 chars) or WIF for the selected network. Kept in memory only.",
      ),
      generated,
      el("div", { className: "actions" }, [
        openBtn,
        generateBtn,
        button("Back", () => navigate("setup")),
      ]),
    ]),
  ]);
}
