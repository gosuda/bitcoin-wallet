import { api } from "../../api";
import { redirect, routeGuard } from "../../screen";
import { session } from "../../session";
import { type AppConfig, errorMessage, type WordCount } from "../../types";
import { banner, el, textInput } from "../../ui/dom";
import { openAndEnter } from "../../ui/open";
import { rememberCheckbox } from "../../ui/remember";
import {
  KEY_SHOWN_ONCE,
  MISSING_WORDS,
  NO_PRIVATE_KEY,
  NO_WATCH_SOURCE,
  PASSPHRASE_HINT,
  PRIVATE_KEY_HINT,
  PRIVATE_KEY_PLACEHOLDER,
  phraseError,
  watchPlaceholder,
} from "../../ui/text";
import { wipeOnLeave, wordCell, wordGrid, wordInput } from "../../ui/words";
import {
  body,
  button,
  card,
  chips,
  header,
  historyReset,
  labelled,
  lede,
  spacer,
  withLock,
} from "../ui";

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
  const cfg = session.config;
  if (!cfg) return redirect("setup");
  if (mode === "key") return singleKey(cfg);
  if (mode === "watch") return watchOnly(cfg);
  return phrase(cfg);
}

function phrase(cfg: AppConfig): HTMLElement {
  // `routeGuard`, not `screenGuard`: opening is what sets `session.wallet`.
  const onScreen = routeGuard();
  const alert = banner();
  const offer = historyReset(alert);
  const remember = rememberCheckbox(() => gate());
  const passphrase = textInput({ placeholder: "Leave empty for none", name: "passphrase" });
  passphrase.type = "password";

  let inputs: HTMLInputElement[] = [];
  const gridHost = el("div");

  /** Write `words` into the grid from `from`, reading whichever grid is current. */
  const fill = (words: readonly string[], from: number): void => {
    for (const [j, w] of words.entries()) {
      const target = inputs[from + j];
      if (target) target.value = w;
    }
  };

  const build = (size: WordCount) => {
    inputs = Array.from({ length: size }, (_, i) => {
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
        // A whole phrase says how long it is, and the grid takes that length.
        if (words.length === 12 || words.length === 24) {
          const size: WordCount = words.length === 24 ? 24 : 12;
          // Rebuilds the grid through the chips, so the control and the grid
          // agree about what the user is now restoring.
          if (size !== inputs.length) count.select(`${size}`);
          fill(words, 0);
          return;
        }
        if (i + words.length > inputs.length) {
          alert.show(
            "warn",
            `That is ${words.length} words and only ${inputs.length - i} fit from here. A recovery phrase is 12 or 24 words.`,
          );
          return;
        }
        fill(words, i);
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
    { label: "Word count" },
  );
  build(12);
  const fields = () => [...inputs, passphrase];
  wipeOnLeave(fields);

  const door = { cfg, alert, offer, onScreen, remember, fields };
  const restore = async (reset = false): Promise<void> => {
    const typed = inputs.map((i) => i.value.trim().toLowerCase()).filter(Boolean);
    // Every cell first, as the desktop waits for: a blank before an unknown
    // word would shift the number the core names it by.
    if (typed.length < inputs.length) {
      alert.show("error", MISSING_WORDS);
      return;
    }
    const words = typed.join(" ");
    try {
      await api.validateMnemonic(words);
    } catch (e) {
      if (onScreen()) alert.show("error", phraseError(errorMessage(e), typed));
      return;
    }
    await openAndEnter(words, passphrase.value || undefined, door, reset, () => restore(true));
  };
  // Off while a ticked Remember waits for its app password.
  const gate = () => {
    go.disabled = !remember.ready();
  };
  const go = button("Restore wallet", () => void withLock(go, restore).finally(gate), {
    variant: "primary",
    block: true,
  });

  return el("main", {}, [
    header("Restore wallet", { back: "key" }),
    body(
      alert.node,
      card(count.node, gridHost),
      card(
        labelled("Passphrase", passphrase, "(optional)"),
        passphrase,
        lede(PASSPHRASE_HINT),
        remember.node,
      ),
      spacer(),
      offer.node,
      go,
    ),
  ]);
}

function singleKey(cfg: AppConfig): HTMLElement {
  const onScreen = routeGuard();
  const alert = banner();
  const offer = historyReset(alert);
  const remember = rememberCheckbox(() => gate());
  const secret = textInput({
    type: "password",
    mono: true,
    name: "secret",
    placeholder: PRIVATE_KEY_PLACEHOLDER,
  });
  secret.setAttribute("autocapitalize", "none");
  secret.setAttribute("autocorrect", "off");
  const fields = () => [secret];
  wipeOnLeave(fields);

  const door = { cfg, alert, offer, onScreen, remember, fields };
  const open = async (reset = false): Promise<void> => {
    const value = secret.value.trim();
    if (!value) return alert.show("error", NO_PRIVATE_KEY);
    await openAndEnter(value, undefined, door, reset, () => open(true));
  };
  const gate = () => {
    go.disabled = !remember.ready();
  };
  const go = button("Open wallet", () => void withLock(go, open).finally(gate), {
    variant: "primary",
    block: true,
  });

  const generate = button("Generate new key", async () => {
    alert.hide();
    try {
      const key = await api.generateKey(cfg.network, cfg.address_type);
      secret.value = key.wif;
      secret.type = "text";
      alert.show("warn", KEY_SHOWN_ONCE);
    } catch (e) {
      alert.show("error", errorMessage(e));
    }
  });

  return el("main", {}, [
    header("Single key", { back: "key" }),
    body(
      alert.node,
      lede(PRIVATE_KEY_HINT),
      card(labelled("Private key", secret), secret, generate),
      card(remember.node),
      spacer(),
      offer.node,
      go,
    ),
  ]);
}

/**
 * The public half of a wallet: an account xpub, or a descriptor exported by
 * another wallet. The core reads it the same way it reads a key, so the open
 * path is shared; what differs is what the user is told it can do.
 */
function watchOnly(cfg: AppConfig): HTMLElement {
  const onScreen = routeGuard();
  const alert = banner();
  const offer = historyReset(alert);
  const remember = rememberCheckbox(() => gate());
  const source = el("textarea", {
    attrs: {
      rows: "3",
      name: "descriptor",
      placeholder: watchPlaceholder(cfg.network),
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
    },
  });
  // Not spendable, but it reveals the wallet's whole history and every
  // future address — the same reason Export warns before it is shared.
  const fields = () => [source];
  wipeOnLeave(fields);

  const door = { cfg, alert, offer, onScreen, remember, fields };
  const follow = async (reset = false): Promise<void> => {
    const value = source.value.trim();
    if (!value) return alert.show("error", NO_WATCH_SOURCE);
    await openAndEnter(value, undefined, door, reset, () => follow(true));
  };
  const gate = () => {
    go.disabled = !remember.ready();
  };
  const go = button("Follow this wallet", () => void withLock(go, follow).finally(gate), {
    variant: "primary",
    block: true,
    icon: "eye",
  });

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
      offer.node,
      go,
    ),
  ]);
}
