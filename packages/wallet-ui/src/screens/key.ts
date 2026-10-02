import { api } from "../api";
import { platform } from "../platform";
import { navigate } from "../router";
import { redirect, routeGuard, screenHead } from "../screen";
import { session } from "../session";
import { backendHost, errorMessage, type GeneratedKey, NETWORK_LABELS } from "../types";
import { copyButton } from "../ui/clipboard";
import { banner, button, el, field, kv, mono, sectionLabel, textInput, withBusy } from "../ui/dom";
import { NO_KEYSTORE_HINT, rememberCheckbox } from "../ui/remember";
import { historyReset } from "../ui/reset";
import {
  KEY_SHOWN_ONCE,
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

  const openKey = async (reset = false): Promise<void> => {
    alert.hide();
    const value = secret.value.trim();
    if (!value) {
      alert.show("error", "Enter a private key (hex or WIF) or generate one.");
      return;
    }
    // Nothing is remembered without a confirmed app password. The button waits
    // for one, and so does a reset offered before the fields changed.
    if (!remember.ready()) return;
    // Read once: the checkbox stays live across the await, and asking it
    // again afterwards can disagree with what was actually stored.
    const willRemember = remember.checked();
    try {
      const open = reset ? api.resetHistoryAndOpen : api.openWallet;
      const info = await open(
        value,
        cfg.address_type,
        willRemember,
        undefined,
        remember.appPassword(),
      );
      secret.value = "";
      generated.replaceChildren();
      generated.className = "hidden";
      if (willRemember) session.remembered = info;
      // `onScreen` is `routeGuard`, not `screenGuard`: it has no
      // wallet-id check to misfire against the `session.wallet` that `api.openWallet` set.
      if (onScreen()) navigate("dashboard");
    } catch (e) {
      if (onScreen()) offer.report(e, () => openKey(true));
    }
  };
  // Open wallet waits for a ticked box's app password; `withBusy` enables the
  // button again, so that gate is put back once an attempt settles.
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

  // The single-key path is intact, just folded away: a recovery phrase is the
  // default, and one raw key is the escape hatch.
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
  const follow = async (reset = false): Promise<void> => {
    alert.hide();
    const value = watchSource.value.trim();
    if (!value) {
      alert.show("error", "Paste an xpub or a public descriptor.");
      return;
    }
    if (!watchRemember.ready()) return;
    const willRemember = watchRemember.checked();
    try {
      const open = reset ? api.resetHistoryAndOpen : api.openWallet;
      const info = await open(
        value,
        cfg.address_type,
        willRemember,
        undefined,
        watchRemember.appPassword(),
      );
      watchSource.value = "";
      // The wallet is already open here. Reading the record back could
      // fail and put an error over a wallet that opened fine, so take what
      // we know — the same shape the private-key path above uses.
      if (willRemember) session.remembered = info;
      // `onScreen` is `routeGuard`, not `screenGuard`: it has no
      // wallet-id check to misfire against the `session.wallet` that `api.openWallet` set.
      if (onScreen()) navigate("dashboard");
    } catch (e) {
      if (onScreen()) offer.report(e, () => follow(true));
    }
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
  // A screen can hold at most one of these at a time in practice, but
  // whichever the user typed into must not survive a route change. A
  // generated key is shown, not typed, so it needs the same treatment
  // through `also` rather than the input list `wipeOnLeave` clears itself —
  // the same reset `openBtn`'s own success path already does before it
  // navigates away with a key actually in use.
  wipeOnLeave(
    () => [secret, watchSource],
    () => {
      generated.replaceChildren();
      generated.className = "hidden";
    },
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
