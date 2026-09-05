import { api } from "../api";
import { platform } from "../platform";
import { navigate } from "../router";
import { session } from "../session";
import { backendHost, errorMessage, type GeneratedKey, NETWORK_LABELS } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, el, field, kv, mono, sectionLabel, textInput, withBusy } from "../ui/dom";
import { NO_KEYSTORE_HINT, rememberCheckbox } from "../ui/remember";

/**
 * Whether the single-key disclosure is expanded. Sticky for the session so the
 * screen reopens where the user left it — and so "Advanced: use a single key"
 * on the Create screen lands on an open panel.
 */
let advancedOpen = false;

/** Expands the single-key disclosure on the next render of this screen. */
export function showKeyAdvanced(): void {
  advancedOpen = true;
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
  const remember = rememberCheckbox();

  const showGenerated = (key: GeneratedKey) => {
    generated.className = "card secret-box";
    generated.replaceChildren(
      el("div", { className: "card-head" }, [
        sectionLabel("New key — shown once"),
        el("span", { className: "secret-note", text: "Copy it now; it is not stored anywhere." }),
      ]),
      kv([
        ["Address", mono(key.address)],
        ["Private key (hex)", mono(key.priv_hex)],
        ["WIF", mono(key.wif)],
      ]),
      el("div", { className: "actions" }, [
        copyButton(() => key.priv_hex, "Copy hex", "sm"),
        copyButton(() => key.wif, "Copy WIF", "sm"),
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
          const info = await api.openWallet(value, cfg.address_type, remember.checked());
          secret.value = "";
          generated.replaceChildren();
          generated.className = "hidden";
          session.wallet = info;
          if (remember.checked()) session.remembered = info;
          session.lastSyncedAt = null;
          navigate("dashboard");
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "primary",
    "md",
    { name: "key" },
  );

  secret.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") openBtn.click();
  });

  // P2PK has no BIP32 account layout, so no phrase can describe one: offering
  // the phrase screens here would only dead-end in the core's refusal.
  const hdCapable = cfg.address_type !== "p2pk";
  const newWalletBtn = button("New wallet", () => navigate("create"), "primary", "md", {
    name: "plus",
  });
  const restoreBtn = button("Restore wallet", () => navigate("restore"), "default", "md", {
    name: "key",
  });
  newWalletBtn.disabled = !hdCapable;
  restoreBtn.disabled = !hdCapable;

  // The single-key path is intact, just folded away: a recovery phrase is the
  // default, and one raw key is the escape hatch.
  const advanced = el("details", { className: "disclosure" }, [
    el("summary", {
      className: "disclosure-summary",
      text: "Advanced: use a single key",
    }),
    el("div", { className: "disclosure-body" }, [
      field(
        "Private key",
        secret,
        "Hex (64 chars) or WIF for the selected network. Kept in memory only.",
      ),
      remember.node,
      el("div", { className: "actions" }, [openBtn, generateBtn]),
      generated,
    ]),
  ]);
  advanced.open = advancedOpen || !hdCapable;
  advanced.addEventListener("toggle", () => {
    advancedOpen = advanced.open;
  });

  // The public half of a wallet: an account xpub, or a descriptor another
  // wallet exported. The core reads it the way it reads a key; what differs
  // is what the user is told it can do.
  const watchSource = el("textarea", {
    className: "mono",
    attrs: {
      rows: "2",
      name: "descriptor",
      placeholder: "wpkh([fingerprint/84h/1h/0h]tpub…/0/*) — or just the tpub",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
    },
  }) as HTMLTextAreaElement;
  const watchRemember = rememberCheckbox();
  const followBtn = button(
    "Follow this wallet",
    () =>
      withBusy(followBtn, async () => {
        alert.hide();
        const value = watchSource.value.trim();
        if (!value) {
          alert.show("error", "Paste an xpub or a public descriptor.");
          return;
        }
        try {
          const info = await api.openWallet(value, cfg.address_type, watchRemember.checked());
          watchSource.value = "";
          session.wallet = info;
          session.remembered = await api.getRemembered();
          session.lastSyncedAt = null;
          navigate("dashboard");
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "default",
    "md",
    { name: "eye" },
  );
  const watchOnly = el("section", { className: "card" }, [
    el("div", { className: "card-head" }, [
      sectionLabel("Watch-only"),
      el("span", {
        className: "hint",
        text: "Follows a wallet without its keys: balance, history and receiving, no sending.",
      }),
    ]),
    field(
      "xpub or descriptor",
      watchSource,
      "A bare xpub is expanded with the address type chosen in Setup.",
    ),
    watchRemember.node,
    el("div", { className: "actions" }, [followBtn]),
  ]);

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Key" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[cfg.network]} · ${backendHost(cfg.backend)}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card card-loose" }, [
      sectionLabel("Start a wallet"),
      el("div", { className: "actions" }, [
        newWalletBtn,
        restoreBtn,
        button("Back", () => navigate("setup"), "quiet"),
      ]),
      el("p", {
        className: "hint",
        text: hdCapable
          ? "A recovery phrase backs up every address this wallet will ever use. Restoring one brings its history back."
          : "P2PK has no BIP32 account layout, so it cannot be backed up by a recovery phrase. Choose another address type in Setup, or use a single key below.",
      }),
      platform().canRememberWallet ? null : el("p", { className: "hint", text: NO_KEYSTORE_HINT }),
    ]),
    advanced,
    watchOnly,
  ]);
}
