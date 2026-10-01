import { api, canUnlockHere } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import {
  ADDRESS_TYPE_LABELS,
  type AddressType,
  type AppConfig,
  type BackendConfig,
  DEFAULT_ESPLORA_URL,
  errorMessage,
  isOpenable,
  NETWORK_LABELS,
  NETWORKS,
  type Network,
  OPENABLE_ADDRESS_TYPES,
} from "../types";
import { banner, button, el, field, radioGroup, textInput, withBusy } from "../ui/dom";
import { SERVER_REQUIRED, SETUP_LEDE } from "../ui/text";

export function renderSetup(): HTMLElement {
  const initial = session.config;
  let network: Network = initial?.network ?? "signet";
  // A config saved before P2PK stopped being openable can name it; it is not
  // among the choices below, so start from the default instead.
  const stored = initial?.address_type;
  let addressType: AddressType = stored && isOpenable(stored) ? stored : "p2wpkh";
  let urlTouched = initial !== null && initial.backend.url !== DEFAULT_ESPLORA_URL[network];

  const alert = banner();
  const url = textInput({
    value: initial?.backend.url ?? DEFAULT_ESPLORA_URL[network],
    type: "url",
    mono: true,
  });
  url.addEventListener("input", () => {
    urlTouched = true;
  });

  const refreshUrl = () => {
    if (!urlTouched) url.value = DEFAULT_ESPLORA_URL[network];
  };

  const networkGroup = radioGroup(
    "network",
    NETWORKS.map((n) => ({ value: n, label: NETWORK_LABELS[n] })),
    network,
    (v) => {
      network = v;
      urlTouched = false;
      refreshUrl();
    },
  );

  const typeGroup = radioGroup(
    "address_type",
    OPENABLE_ADDRESS_TYPES.map((t) => ({ value: t, label: ADDRESS_TYPE_LABELS[t] })),
    addressType,
    (v) => {
      addressType = v;
    },
  );

  const next = button(
    "Continue",
    () =>
      withBusy(next, async () => {
        alert.hide();
        const trimmed = url.value.trim();
        if (!trimmed) {
          alert.show("error", SERVER_REQUIRED);
          return;
        }
        const backend: BackendConfig = { kind: "esplora", url: trimmed };
        const config: AppConfig = { network, backend, address_type: addressType };
        try {
          await api.setConfig(config);
          session.config = config;
          navigate(canUnlockHere() ? "unlock" : "key");
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    "primary",
    "md",
    { name: "arrow", trailing: true },
  );

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Setup" }),
      el("p", {
        className: "muted small",
        text: SETUP_LEDE,
      }),
    ]),
    alert.node,
    el("section", { className: "card card-loose" }, [
      field("Network", networkGroup),
      field(
        "Esplora server",
        url,
        "Any Esplora-compatible API — mempool.space, blockstream.info, electrs, bitcoin-rs.",
      ),
      field("Address type", typeGroup),
    ]),
    el("div", { className: "actions actions-end" }, [next]),
  ]);
}
