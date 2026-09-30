import { api } from "../../api";
import { headlineSat } from "../../balance";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { screenGuard } from "../../screen";
import { session } from "../../session";
import {
  ADDRESS_TYPE_LABELS,
  backendHost,
  errorMessage,
  LOCK_AFTER_CHOICES,
  LOCK_AFTER_LABELS,
  type LockAfter,
  lockAfterFrom,
  NETWORK_LABELS,
  RESCAN_GAPS,
  type RescanGap,
} from "../../types";
import { chooseLockAfter, lockAfter } from "../../ui/autolock";
import { banner, el, formatNumber } from "../../ui/dom";
import { formatSats } from "../../ui/format";
import { forgetWarning } from "../../ui/text";
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

type Gap = `${RescanGap}`;
type Wait = `${LockAfter}`;

export function renderSettings(): HTMLElement {
  const info = session.wallet;
  const cfg = session.config;
  const host = el("main");
  if (!info || !cfg) {
    navigate("setup");
    return host;
  }
  const onScreen = screenGuard();

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
      button("Keep it", () => changeHost.replaceChildren(), { variant: "quiet" }),
    );
    sheet.classList.add("m-confirm", "m-confirm-neutral");
    changeHost.replaceChildren(sheet);
  };

  // Rescan: for a wallet restored from words that had spread further than
  // the default gap. It merges; nothing already known is lost.
  const gap = chips<Gap>(
    RESCAN_GAPS.map((g) => ({ value: `${g}` as Gap, label: `${g}` })),
    `${RESCAN_GAPS[0]}`,
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
          if (!onScreen()) return;
          session.lastSyncedAt = new Date();
          alert.show(
            "ok",
            `Rescanned with a gap of ${gap.value()}: ${formatSats(headlineSat(balance))} in this wallet.`,
          );
        } catch (e) {
          if (onScreen()) alert.show("error", errorMessage(e));
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

  // The keystore holds one wallet. "Remembered" and "Forget" are about *this*
  // one, or they are about nothing: another wallet's key must not be deleted
  // from here.
  const remembered = session.remembered?.wallet_id === info.wallet_id;

  // Lock after: chips inline, as Rescan's are. Only a remembered wallet is
  // ever locked, so without a keystore there is nothing to choose.
  const lockBlock = platform().canRememberWallet
    ? el("div", { className: "m-block" }, [
        el("div", { className: "m-block-head" }, [
          el("span", { text: "Lock after" }),
          el("span", { className: "m-item-value", text: "in background" }),
        ]),
        chips<Wait>(
          LOCK_AFTER_CHOICES.map((c) => ({ value: `${c}` as Wait, label: LOCK_AFTER_LABELS[c] })),
          `${lockAfter()}`,
          (value) => {
            void chooseLockAfter(lockAfterFrom(value)).catch((e: unknown) => {
              if (!onScreen()) return;
              alert.show(
                "error",
                `The lock time could not be saved (${errorMessage(e)}). It holds until the app closes.`,
              );
            });
          },
          { label: "Lock after" },
        ).node,
        el("span", {
          className: "hint",
          text: "After this long in the background a remembered wallet closes to Unlock — never in the middle of a sync or a broadcast.",
        }),
      ])
    : item("Lock after", "Not available here");

  // How many coins there are and how many are frozen, once the core says. On
  // a failure the row stays blank; Coins itself says what went wrong.
  const coinCount = el("span");
  void api.listUtxos().then(
    (utxos) => {
      if (!onScreen()) return;
      const frozen = utxos.filter((u) => u.frozen).length;
      coinCount.textContent =
        frozen > 0
          ? `${formatNumber(utxos.length)} · ${formatNumber(frozen)} frozen`
          : formatNumber(utxos.length);
    },
    () => undefined,
  );

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
        item("Coins", coinCount, () => navigate("coins")),
        item("Import PSBT", null, () => navigate("psbt")),
      ),
      listCard(
        item("Wallet", kind),
        item(
          "Remembered on this device",
          platform().canRememberWallet ? (remembered ? "Yes" : "No") : "Not available here",
        ),
        lockBlock,
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
            text: forgetWarning(info),
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
      el("p", { className: "m-mono-block m-centre-text", text: info.wallet_id }),
    ),
  );
  return host;
}
