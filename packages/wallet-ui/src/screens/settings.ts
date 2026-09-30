import { api } from "../api";
import { headlineSat } from "../balance";
import { platform } from "../platform";
import { navigate } from "../router";
import { screenGuard } from "../screen";
import { session } from "../session";
import {
  ADDRESS_TYPE_LABELS,
  errorMessage,
  LOCK_AFTER_CHOICES,
  LOCK_AFTER_LABELS,
  lockAfterFrom,
  NETWORK_LABELS,
  type PublicDescriptors,
  RESCAN_GAPS,
} from "../types";
import { chooseLockAfter, lockAfter } from "../ui/autolock";
import { copyButton } from "../ui/clipboard";
import {
  banner,
  button,
  el,
  formatSats,
  kv,
  mono,
  radioGroup,
  sectionLabel,
  withBusy,
} from "../ui/dom";
import { icon } from "../ui/icons";
import { rememberedWhere } from "../ui/remember";
import { forgetWarning } from "../ui/text";

/** A setting: what it is, what it is set to, and what can be done about it. */
function settingRow(label: string, value: Node | string, action?: HTMLElement): HTMLElement {
  return el("div", { className: "setting-row" }, [
    el("span", { className: "setting-key", text: label }),
    el("span", {}, [value]),
    action ?? null,
  ]);
}

/**
 * "Lock after" as the board draws it: a select whose own arrow gives way to
 * the app's chevron, turned down. A choice applies at once and is saved.
 */
function lockSelect(onSaveFailed: (e: unknown) => void): HTMLElement {
  const select = el("select", { attrs: { name: "lock_after", "aria-label": "Lock after" } });
  for (const choice of LOCK_AFTER_CHOICES) {
    const label = LOCK_AFTER_LABELS[choice];
    const option = el("option", {
      text: choice === "never" ? label : `${label} in background`,
      attrs: { value: `${choice}` },
    });
    option.selected = choice === lockAfter();
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    void chooseLockAfter(lockAfterFrom(select.value)).catch(onSaveFailed);
  });
  return el("span", { className: "select-box" }, [select, icon("chevron", 14)]);
}

/**
 * The desktop's Settings: what the phone's Settings offers, on one page.
 *
 * Changing the chain closes the wallet and opens Setup, and asks first, as on
 * the phone. Rescan and the public keys live here and not on the Wallet page.
 */
export function renderSettings(): HTMLElement {
  const wallet = session.wallet;
  const cfg = session.config;
  if (!wallet || !cfg) {
    navigate("setup");
    return el("main");
  }
  const onScreen = screenGuard();
  const alert = banner();

  // --- chain: any change means Setup, and Setup means closing this wallet ---
  const changeSlot = el("div", { className: "slot" });
  const change = (what: string) => () => {
    const go = button(
      "Continue",
      () =>
        withBusy(go, async () => {
          await api.closeWallet();
          navigate("setup");
        }),
      "primary",
    );
    changeSlot.replaceChildren(
      el("section", { className: "card review-card" }, [
        el("span", {
          text: `Changing the ${what} closes this wallet. You will open it again from Setup.`,
        }),
        el("div", { className: "actions actions-end" }, [
          button("Keep it", () => changeSlot.replaceChildren(), "quiet"),
          go,
        ]),
      ]),
    );
    go.focus();
  };
  const changeButton = (what: string) => button("Change…", change(what), "default", "sm");

  // --- security: where a remembered key is kept, and when it locks -----------
  // The keystore holds one wallet; "remembered" is about this one or nothing.
  const canRemember = platform().canRememberWallet;
  const remembered = session.remembered?.wallet_id === wallet.wallet_id;
  const rememberedValue = !canRemember
    ? "Not available here"
    : remembered
      ? el("span", {}, ["Yes ", el("span", { className: "hint", text: `· ${rememberedWhere()}` })])
      : "No";
  // Only a remembered wallet is ever locked, so without a keystore there is
  // nothing to choose.
  const lockValue = canRemember
    ? lockSelect((e) => {
        if (onScreen()) {
          alert.show(
            "error",
            `The lock time could not be saved (${errorMessage(e)}). It holds until the app closes.`,
          );
        }
      })
    : "Not available here";

  // --- rescan: for a restore that shows too little ----------------------------
  let gap = `${RESCAN_GAPS[0]}`;
  const gapChips = radioGroup(
    "rescan_gap",
    // Only the first chip says what the numbers are.
    RESCAN_GAPS.map((g, i) => ({ value: `${g}`, label: i === 0 ? `gap ${g}` : `${g}` })),
    gap,
    (v) => {
      gap = v;
    },
    { label: "Address gap" },
  );
  const rescanBtn = button(
    "Rescan",
    () =>
      withBusy(rescanBtn, async () => {
        alert.hide();
        try {
          const balance = await api.rescan(Number(gap));
          if (!onScreen()) return;
          session.lastSyncedAt = new Date();
          alert.show(
            "ok",
            `Rescanned with a gap of ${gap}: ${formatSats(headlineSat(balance))} in this wallet.`,
          );
        } catch (e) {
          if (onScreen()) alert.show("error", errorMessage(e));
        }
      }),
    "default",
    "md",
    { name: "refresh" },
  );

  // --- public keys: shown on request, enough to watch this wallet elsewhere ---
  const keysSlot = el("div");
  const renderKeys = (d: PublicDescriptors) => {
    const rows: [string, Node][] = [];
    if (d.account_xpub !== null) rows.push(["Account xpub", mono(d.account_xpub, "small")]);
    rows.push([d.internal === null ? "Descriptor" : "Receive", mono(d.external, "small")]);
    if (d.internal !== null) rows.push(["Change", mono(d.internal, "small")]);
    const actions = el("div", { className: "actions" });
    if (d.account_xpub !== null) {
      const xpub = d.account_xpub;
      actions.appendChild(copyButton(() => xpub, "Copy xpub", "sm"));
    }
    const both = d.internal === null ? d.external : `${d.external}\n${d.internal}`;
    actions.appendChild(
      copyButton(() => both, d.internal === null ? "Copy descriptor" : "Copy descriptors", "sm"),
    );
    keysSlot.replaceChildren(kv(rows), actions);
  };
  const showKeys = el(
    "button",
    {
      className: "link-button",
      attrs: { type: "button" },
      on: {
        click: () => {
          showKeys.disabled = true;
          void api
            .publicDescriptors()
            .then((d) => {
              if (onScreen()) renderKeys(d);
            })
            .catch((e: unknown) => {
              showKeys.disabled = false;
              if (onScreen()) alert.show("error", errorMessage(e));
            });
        },
      },
    },
    ["Export public keys", icon("arrow", 14)],
  );
  keysSlot.appendChild(showKeys);

  // --- leaving: close, or forget this device's copy altogether ---------------
  const closeBtn = button("Close wallet", () =>
    withBusy(closeBtn, async () => {
      try {
        await api.closeWallet();
      } finally {
        navigate(session.remembered ? "unlock" : "key");
      }
    }),
  );
  const forgetSlot = el("div", { className: "slot" });
  const showForget = () => {
    const yes = button(
      "Delete it",
      () =>
        withBusy(yes, async () => {
          alert.hide();
          try {
            await api.forgetWallet();
            session.remembered = null;
            navigate("key");
          } catch (e) {
            alert.show("error", errorMessage(e));
          }
        }),
      "danger",
    );
    forgetSlot.replaceChildren(
      el("section", { className: "card danger-card" }, [
        el("span", {
          className: "muted",
          text: forgetWarning(wallet),
        }),
        el("div", { className: "actions actions-end" }, [
          button("Keep it", () => forgetSlot.replaceChildren(), "quiet"),
          yes,
        ]),
      ]),
    );
    yes.focus();
  };
  // Without a working keystore there is no saved key to delete, and a stale
  // record can still say "remembered" on such a build.
  const forgetBtn =
    remembered && canRemember ? button("Forget this wallet", showForget, "danger") : null;

  const kind = wallet.is_watch_only ? " · Watch-only" : "";
  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Settings" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[wallet.network]} · ${ADDRESS_TYPE_LABELS[wallet.address_type]}${kind} · ${wallet.wallet_id}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card card-rows" }, [
      el("div", { className: "card-head" }, [
        sectionLabel("Chain"),
        el("span", {
          className: "hint",
          text: "Changing any of these closes the wallet and opens Setup. It asks first.",
        }),
      ]),
      el("div", {}, [
        settingRow("Network", NETWORK_LABELS[cfg.network], changeButton("network")),
        settingRow("Esplora server", mono(cfg.backend.url), changeButton("server")),
        settingRow(
          "Address type",
          ADDRESS_TYPE_LABELS[cfg.address_type],
          changeButton("address type"),
        ),
      ]),
    ]),
    changeSlot,
    el("section", { className: "card card-rows" }, [
      sectionLabel("Security"),
      el("div", {}, [
        settingRow("Remembered on this device", rememberedValue),
        settingRow("Lock after", lockValue),
      ]),
      canRemember
        ? el("span", {
            className: "hint",
            text: "After this long in the background a remembered wallet closes to Unlock — never in the middle of a sync or a broadcast.",
          })
        : null,
    ]),
    el("section", { className: "card" }, [
      el("div", { className: "card-head" }, [
        sectionLabel("Rescan"),
        el("span", {
          className: "hint",
          text: "Looks further past the last used address — for a restore that shows too little.",
        }),
      ]),
      el("div", { className: "actions" }, [rescanBtn, gapChips]),
    ]),
    el("div", { className: "settings-pair" }, [
      el("section", { className: "card pubkeys" }, [
        sectionLabel("Public keys"),
        el("span", {
          className: "hint",
          text: "Reveal your history, not your funds — for a watch-only copy elsewhere.",
        }),
        keysSlot,
      ]),
      el("section", { className: "card" }, [
        sectionLabel("PSBT"),
        el("span", {
          className: "hint",
          text: "Sign or send a transaction that another wallet or device made.",
        }),
        el("a", { className: "link-button", attrs: { href: "#/psbt" } }, [
          "Import PSBT",
          icon("arrow", 14),
        ]),
      ]),
    ]),
    el("div", { className: "actions actions-split" }, [closeBtn, forgetBtn]),
    forgetSlot,
  ]);
}
