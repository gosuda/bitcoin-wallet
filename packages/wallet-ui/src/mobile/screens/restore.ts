import { api } from "../../api";
import { navigate } from "../../router";
import { session } from "../../session";
import { errorMessage, type WordCount } from "../../types";
import { banner, el, textInput } from "../../ui/dom";
import { rememberCheckbox } from "../../ui/remember";
import { wipeOnLeave, wordCell, wordGrid, wordInput } from "../../ui/words";
import { body, button, card, chips, header, labelled, lede, spacer, withBusy } from "../ui";

type Mode = "phrase" | "key" | "watch";

/**
 * Which door the user came through. Routes carry no parameters, so the Key
 * screen sets this before navigating rather than encoding it in the hash.
 */
let mode: Mode = "phrase";

export function setRestoreMode(next: Mode): void {
  mode = next;
}

export function renderRestore(): HTMLElement {
  if (mode === "key") return singleKey();
  if (mode === "watch") return watchOnly();
  return phrase();
}

function openWith(
  secret: () => string,
  remember: () => boolean,
  passphrase: () => string | undefined,
  alert: ReturnType<typeof banner>,
) {
  return async () => {
    alert.hide();
    const cfg = session.config;
    if (!cfg) return navigate("setup");
    await api.openWallet(secret(), cfg.address_type, remember(), passphrase());
    session.remembered = await api.getRemembered();
    navigate("dashboard");
  };
}

function phrase(): HTMLElement {
  const alert = banner();
  const remember = rememberCheckbox();
  const passphrase = textInput({ placeholder: "Leave empty for none", name: "passphrase" });
  passphrase.type = "password";

  let inputs: HTMLInputElement[] = [];
  const gridHost = el("div");

  const build = (count: WordCount) => {
    inputs = Array.from({ length: count }, (_, i) => {
      const input = wordInput(i + 1);
      input.setAttribute("autocapitalize", "none");
      input.setAttribute("autocorrect", "off");
      // Pasting a whole phrase into any box spreads it across the grid, which
      // is how most people move a phrase between devices.
      input.addEventListener("paste", (ev) => {
        const text = ev.clipboardData?.getData("text") ?? "";
        const words = text.trim().split(/\s+/).filter(Boolean);
        if (words.length < 2) return;
        ev.preventDefault();
        for (const [j, w] of words.entries()) {
          const target = inputs[i + j];
          if (target) target.value = w;
        }
      });
      return input;
    });
    gridHost.replaceChildren(wordGrid(inputs.map((input, i) => wordCell(i + 1, input))));
  };

  const count = chips<`${WordCount}`>(
    [
      { value: "12", label: "12 words" },
      { value: "24", label: "24 words" },
    ],
    "12",
    (v) => build(Number(v) as WordCount),
  );
  build(12);
  // Typed words are secret, and so is the passphrase: out of the DOM the
  // moment the route changes. `inputs` is read late because the grid can be
  // rebuilt for 24 words after this is armed.
  wipeOnLeave(() => [...inputs, passphrase]);

  const go = button(
    "Restore",
    () =>
      withBusy(go, async () => {
        try {
          const words = inputs
            .map((i) => i.value.trim().toLowerCase())
            .filter(Boolean)
            .join(" ");
          await api.validateMnemonic(words);
          await openWith(
            () => words,
            () => remember.checked(),
            () => passphrase.value || undefined,
            alert,
          )();
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    { variant: "primary", block: true },
  );

  return el("main", {}, [
    header("Restore wallet", { back: "key" }),
    body(
      alert.node,
      card(count.node, gridHost),
      card(
        labelled("Passphrase", passphrase, "(optional)"),
        passphrase,
        el("p", {
          className: "m-lede",
          text: "A passphrase creates a different wallet from the same words. Without it those words alone cannot recover this one.",
        }),
        remember.node,
      ),
      spacer(),
      go,
    ),
  ]);
}

function singleKey(): HTMLElement {
  const alert = banner();
  const remember = rememberCheckbox();
  const secret = textInput({ type: "password", mono: true, name: "secret" });
  secret.setAttribute("autocapitalize", "none");
  secret.setAttribute("autocorrect", "off");
  wipeOnLeave(() => [secret]);

  const go = button(
    "Open wallet",
    () =>
      withBusy(go, async () => {
        try {
          await openWith(
            () => secret.value.trim(),
            () => remember.checked(),
            () => undefined,
            alert,
          )();
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    { variant: "primary", block: true },
  );

  const generate = button("Generate a new key", async () => {
    alert.hide();
    const cfg = session.config;
    if (!cfg) return navigate("setup");
    try {
      const key = await api.generateKey(cfg.network, cfg.address_type);
      secret.value = key.wif;
      secret.type = "text";
      alert.show("warn", "Write this key down before continuing. It is shown once.");
    } catch (e) {
      alert.show("error", errorMessage(e));
    }
  });

  return el("main", {}, [
    header("Single key", { back: "key" }),
    body(
      alert.node,
      lede("A private key in hex or WIF. One key means one address and no recovery phrase."),
      card(labelled("Private key", secret), secret, generate),
      card(remember.node),
      spacer(),
      go,
    ),
  ]);
}

/**
 * The public half of a wallet: an account xpub, or a descriptor exported by
 * another wallet. The core reads it the same way it reads a key, so the open
 * path is shared; what differs is what the user is told it can do.
 */
function watchOnly(): HTMLElement {
  const alert = banner();
  const remember = rememberCheckbox();
  const source = el("textarea", {
    attrs: {
      rows: "3",
      name: "descriptor",
      placeholder: "tpub… or wpkh([fingerprint/84h/1h/0h]tpub…/0/*)",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
    },
  }) as HTMLTextAreaElement;

  const go = button(
    "Follow this wallet",
    () =>
      withBusy(go, async () => {
        try {
          await openWith(
            () => source.value.trim(),
            () => remember.checked(),
            () => undefined,
            alert,
          )();
        } catch (e) {
          alert.show("error", errorMessage(e));
        }
      }),
    { variant: "primary", block: true, icon: "eye" },
  );

  return el("main", {}, [
    header("Watch-only", { back: "key" }),
    body(
      alert.node,
      lede(
        "Follows a wallet without its keys: balance, history and receiving, no sending. A bare xpub is expanded with the address type chosen in Setup.",
      ),
      card(labelled("xpub or descriptor", source), source),
      card(remember.node),
      spacer(),
      go,
    ),
  ]);
}
