import { session } from "../../session";
import {
  ADDRESS_TYPE_LABELS,
  type AddressType,
  DEFAULT_ESPLORA_URL,
  isOpenable,
  NETWORK_LABELS,
  type Network,
} from "../../types";
import { banner, el, sectionLabel, textInput } from "../../ui/dom";
import { saveSetup } from "../../ui/settings";
import { SETUP_LEDE } from "../../ui/text";
import { body, button, card, chips, header, labelled, lede, spacer } from "../ui";

/** Networks worth offering on a phone; regtest needs a node on localhost. */
const NETWORKS: readonly Network[] = ["signet", "testnet4", "bitcoin"];
const ADDRESS_TYPES: readonly AddressType[] = ["p2wpkh", "p2tr", "nested_p2wpkh", "p2pkh"];

export function renderSetup(): HTMLElement {
  const cfg = session.config;
  const alert = banner();

  const network = chips(
    NETWORKS.map((n) => ({ value: n, label: NETWORK_LABELS[n] })),
    cfg?.network ?? "signet",
    (value) => {
      // The endpoint follows the network unless the user has typed their own.
      if (url.value === "" || Object.values(DEFAULT_ESPLORA_URL).includes(url.value)) {
        url.value = DEFAULT_ESPLORA_URL[value];
      }
    },
    { label: "Network" },
  );

  const url = textInput({
    value: cfg?.backend.url ?? DEFAULT_ESPLORA_URL[cfg?.network ?? "signet"],
    mono: true,
    name: "esplora",
  });
  url.setAttribute("inputmode", "url");

  const addressType = chips(
    ADDRESS_TYPES.map((a) => ({ value: a, label: ADDRESS_TYPE_LABELS[a] })),
    // A config saved before P2PK stopped being openable can name it; it is
    // not a choice here, so start from the default instead.
    cfg && isOpenable(cfg.address_type) ? cfg.address_type : "p2wpkh",
    undefined,
    { label: "Address type" },
  );

  const cont = button(
    "Continue",
    () => saveSetup(alert, network.value(), url.value, addressType.value()),
    { variant: "primary", block: true },
  );

  return el("main", {}, [
    header("Setup"),
    body(
      alert.node,
      lede(SETUP_LEDE),
      card(sectionLabel("Network"), network.node),
      card(labelled("Esplora server", url), url),
      card(sectionLabel("Address type"), addressType.node),
      spacer(),
      cont,
    ),
  ]);
}
