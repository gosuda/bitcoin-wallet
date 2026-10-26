import { api } from "../api";
import { platform } from "../platform";
import { navigate } from "../router";
import { redirect, routeGuard, screenHead } from "../screen";
import { session } from "../session";
import { backendHost, errorMessage, type GeneratedKey, NETWORK_LABELS } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, el, field, kv, mono, sectionLabel, textInput, withBusy } from "../ui/dom";
import { openAndEnter } from "../ui/open";
import { NO_KEYSTORE_HINT, rememberCheckbox } from "../ui/remember";
import { historyReset } from "../ui/reset";
import {
  KEY_SHOWN_ONCE,
  NO_PRIVATE_KEY,
  NO_WATCH_SOURCE,
  PRIVATE_KEY_HINT,
  PRIVATE_KEY_PLACEHOLDER,
  watchPlaceholder,
} from "../ui/text";
import { wipeOnLeave } from "../ui/words";

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
  if (!cfg) return redirect("setup");
  const onScreen = routeGuard();

  const alert = banner();
  const offer = historyReset(alert);
  const secret = textInput({
    type: "password",
    placeholder: PRIVATE_KEY_PLACEHOLDER,
    mono: true,
    name: "secret",
  });
  const generated = el("div", { className: "hidden" });
  const hideGenerated = () => {
    generated.replaceChildren();
    generated.className = "hidden";
  };
  const remember = rememberCheckbox(() => gateOpen());

  const showGenerated = (key: GeneratedKey) => {
    generated.className = "card secret-box";
    generated.replaceChildren(
      // The banner above says what to do with it, in the phone's words too.
      el("div", { className: "card-head" }, [sectionLabel("New key — shown once")]),
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
        if (!onScreen()) return;
        showGenerated(key);
        alert.show("warn", KEY_SHOWN_ONCE);
      } catch (e) {
        if (onScreen()) alert.show("error", errorMessage(e));
      }
    }),
  );

  const keyDoor = { cfg, alert, offer, onScreen, remember, fields: () => [secret] };
  const openKey = async (reset = false): Promise<void> => {
    const value = secret.value.trim();
    if (!value) return alert.show("error", NO_PRIVATE_KEY);
    await openAndEnter(value, undefined, { ...keyDoor, also: hideGenerated }, reset, () =>
      openKey(true),
    );
  };
  // Open wallet waits for a ticked box's app password.
  const gateOpen = () => {
    openBtn.disabled = !remember.ready();
  };
  const openBtn = button(
    "Open wallet",
    () => void withBusy(openBtn, openKey).finally(gateOpen),
    "primary",
    "md",
    { name: "key" },
  );

  secret.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") openBtn.click();
  });

  // Every type this screen can be reached with has an account layout: a config
  // naming P2PK, which has none, is sent back to Setup by the route guard.
  const newWalletBtn = button("Create new wallet", () => navigate("create"), "primary", "md", {
    name: "plus",
  });
  const restoreBtn = button("Restore from phrase", () => navigate("restore"), "default", "md", {
    name: "key",
  });

  // A recovery phrase is the default; one raw key is folded away here.
  const advanced = el("details", { className: "disclosure" }, [
    el("summary", {
      className: "disclosure-summary",
      text: "Advanced: use a single key",
    }),
    el("div", { className: "disclosure-body" }, [
      field("Private key", secret, PRIVATE_KEY_HINT),
      remember.node,
      el("div", { className: "actions" }, [openBtn, generateBtn]),
      generated,
    ]),
  ]);
  advanced.open = advancedOpen;
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
      placeholder: watchPlaceholder(cfg.network),
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
    },
  });
  const watchRemember = rememberCheckbox(() => gateFollow());
  const watchDoor = {
    cfg,
    alert,
    offer,
    onScreen,
    remember: watchRemember,
    fields: () => [watchSource],
  };
  const follow = async (reset = false): Promise<void> => {
    const value = watchSource.value.trim();
    if (!value) return alert.show("error", NO_WATCH_SOURCE);
    await openAndEnter(value, undefined, watchDoor, reset, () => follow(true));
  };
  const gateFollow = () => {
    followBtn.disabled = !watchRemember.ready();
  };
  const followBtn = button(
    "Follow this wallet",
    () => void withBusy(followBtn, follow).finally(gateFollow),
    "default",
    "md",
    { name: "eye" },
  );
  // Whichever field was typed into must not survive a route change, and nor
  // must a generated key, which is shown rather than typed.
  wipeOnLeave(() => [secret, watchSource], hideGenerated);

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
    screenHead("Start a wallet", `${NETWORK_LABELS[cfg.network]} · ${backendHost(cfg.backend)}`),
    alert.node,
    offer.node,
    el("section", { className: "card card-loose" }, [
      sectionLabel("Recovery phrase"),
      el("div", { className: "actions" }, [
        newWalletBtn,
        restoreBtn,
        button("Back", () => navigate("setup"), "quiet"),
      ]),
      el("p", {
        className: "hint",
        text: "A recovery phrase backs up every address this wallet will ever use. Restoring one brings its history back.",
      }),
      platform().canRememberWallet ? null : el("p", { className: "hint", text: NO_KEYSTORE_HINT }),
    ]),
    advanced,
    watchOnly,
  ]);
}
