import { api } from "../../api";
import { headlineSat } from "../../balance";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { session } from "../../session";
import { ADDRESS_TYPE_LABELS, backendHost, errorMessage, NETWORK_LABELS } from "../../types";
import { banner, el, formatNumber } from "../../ui/dom";
import {
  body,
  button,
  card,
  chips,
  confirmDanger,
  header,
  item,
  lede,
  listCard,
  spacer,
  withBusy,
} from "../ui";

type Gap = "20" | "100" | "500";

export function renderSettings(): HTMLElement {
  const info = session.wallet;
  const cfg = session.config;
  const host = el("main");
  if (!info || !cfg) {
    navigate("setup");
    return host;
  }

  const alert = banner();

  // Network, endpoint and address type live in Setup, and Setup rewrites the
  // wallet's identity — so changing any of them means closing this one first.
  // The row says so and asks, rather than bouncing to a form silently.
  const changeHost = el("div");
  const change = (what: string) => () => {
    const go = button(
      "Continue",
      () =>
        withBusy(go, async () => {
          await api.closeWallet();
          navigate("setup");
        }),
      { variant: "primary", block: true },
    );
    const sheet = card(
      lede(`Changing the ${what} closes this wallet. You will open it again from Setup.`),
      go,
      button("Cancel", () => changeHost.replaceChildren(), { variant: "quiet" }),
    );
    sheet.classList.add("m-confirm", "m-confirm-neutral");
    changeHost.replaceChildren(sheet);
  };

  // Rescan: for a wallet restored from words that had spread further than
  // the default gap. It merges; nothing already known is lost.
  const gap = chips<Gap>(
    [
      { value: "20", label: "20" },
      { value: "100", label: "100" },
      { value: "500", label: "500" },
    ],
    "20",
    undefined,
    { label: "Address gap" },
  );
  const rescan = button(
    "Rescan",
    () =>
      withBusy(rescan, async () => {
        alert.hide();
        try {
          const balance = await api.rescan(Number(gap.value()));
          session.lastSyncedAt = new Date();
          alert.show(
            "ok",
            `Rescanned with a gap of ${gap.value()}: ${formatNumber(headlineSat(balance))} sat in this wallet.`,
          );
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    { icon: "refresh" },
  );
  const rescanBlock = el("div", { className: "m-block" }, [
    el("div", { className: "m-block-head" }, [
      el("span", { text: "Rescan the chain" }),
      el("span", { className: "m-item-value", text: "gap" }),
    ]),
    el("div", { className: "m-block-row" }, [gap.node, rescan]),
    el("span", {
      className: "hint",
      text: "For a restored wallet that shows less than it should.",
    }),
  ]);

  const kind = info.is_watch_only
    ? "Watch-only"
    : info.is_hd
      ? "Recovery phrase (HD)"
      : "Single key";

  /**
   * What it takes to get this wallet back, which is not the same sentence for
   * every wallet. Only a mnemonic has a recovery phrase; telling the owner of
   * a single-key or watch-only wallet that one restores it is false, and this
   * is the screen where they decide whether the local copy is still needed.
   */
  const forgetWarning = info.is_watch_only
    ? "The saved descriptor and this device's copy of the wallet history will be deleted. You will need that xpub or descriptor to follow it again."
    : info.is_hd
      ? "The saved key and this device's copy of the wallet history will be deleted. Your recovery phrase still restores it."
      : "The saved key and this device's copy of the wallet history will be deleted. You will need that private key to open it again.";
  // The keystore holds one wallet. "Remembered" and "Forget" are about *this*
  // one, or they are about nothing: another wallet's key must not be deleted
  // from here.
  const remembered = session.remembered?.wallet_id === info.wallet_id;

  host.appendChild(header("Settings"));
  host.appendChild(
    body(
      alert.node,
      listCard(
        item("Network", NETWORK_LABELS[cfg.network], change("network")),
        item("Esplora server", backendHost(cfg.backend), change("server")),
        item("Address type", ADDRESS_TYPE_LABELS[cfg.address_type], change("address type")),
      ),
      changeHost,
      listCard(
        rescanBlock,
        item("Export public keys", "xpub · descriptors", () => navigate("export")),
      ),
      listCard(
        item("Wallet", kind),
        item(
          "Remembered on this device",
          platform().canRememberWallet ? (remembered ? "Yes" : "No") : "Not available here",
        ),
      ),
      listCard(
        item("Close wallet", null, async () => {
          await api.closeWallet();
          navigate("setup");
        }),
      ),
      spacer(),
      // Without a working keystore there is no saved key to delete and
      // `forgetWallet` cannot finish, so offering it only produces an error.
      // A stale record can still say "remembered" on such a build.
      remembered && platform().canRememberWallet
        ? confirmDanger({
            trigger: "Forget this wallet",
            text: forgetWarning,
            confirm: "Delete it",
            onConfirm: async () => {
              try {
                await api.forgetWallet();
                session.remembered = null;
                navigate("setup");
              } catch (e) {
                alert.show("error", errorMessage(e));
              }
            },
          })
        : null,
      el("p", { className: "m-txmeta m-centre-text", text: info.wallet_id }),
    ),
  );
  return host;
}
