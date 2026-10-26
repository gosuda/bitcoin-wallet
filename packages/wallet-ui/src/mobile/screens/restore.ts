import { api } from "../../api";
import { navigate } from "../../router";
import { redirect, routeGuard } from "../../screen";
import { session } from "../../session";
import { type AppConfig, errorMessage, type WordCount } from "../../types";
import { type Banner, banner, el, textInput } from "../../ui/dom";
import { type RememberControl, rememberCheckbox } from "../../ui/remember";
import type { HistoryReset } from "../../ui/reset";
import {
  KEY_SHOWN_ONCE,
  MISSING_WORDS,
  PASSPHRASE_HINT,
  PRIVATE_KEY_HINT,
  PRIVATE_KEY_PLACEHOLDER,
  phraseError,
  watchPlaceholder,
} from "../../ui/text";
import { type Wipeable, wipeOnLeave, wordCell, wordGrid, wordInput } from "../../ui/words";
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
  withBusy,
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

/** What a door's open uses of its screen; `fields` hold the secret. */
interface Door {
  cfg: AppConfig;
  alert: Banner;
  offer: HistoryReset;
  onScreen: () => boolean;
  remember: RememberControl;
  fields: () => Iterable<Wipeable>;
}

/**
 * The open behind each door's button, as the desktop's; `reset` goes through
 * the api's history reset. The wallet is open once it returns, whatever screen
 * is up by then, but only the door still on screen moves on to it, or offers a
 * reset for a failure, which runs `again`.
 */
async function openWith(
  secret: string,
  passphrase: string | undefined,
  { cfg, alert, offer, onScreen, remember, fields }: Door,
  reset: boolean,
  again: () => Promise<void>,
): Promise<void> {
  alert.hide();
  // Nothing is remembered without a confirmed app password.
  if (!remember.ready()) return;
  // Read once: the box stays live across the await.
  const willRemember = remember.checked();
  try {
    const open = reset ? api.resetHistoryAndOpen : api.openWallet;
    const info = await open(
      secret,
      cfg.address_type,
      willRemember,
      passphrase,
      remember.appPassword(),
    );
    for (const field of fields()) field.value = "";
    // Not read back: a failed read would put an error over a wallet that opened.
    if (willRemember) session.remembered = info;
    if (onScreen()) navigate("dashboard");
  } catch (e) {
    if (onScreen()) offer.report(e, again);
  }
}

function phrase(cfg: AppConfig): HTMLElement {
  // `routeGuard`, not `screenGuard`: opening is what sets `session.wallet`.
  const onScreen = routeGuard();
  const alert = banner();
  const offer = historyReset(alert);
  const remember = rememberCheckbox();
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

  // Named `size`, not `count`: the word-count chips below are `count`, and a
  // paste handler built in here needs to reach them.
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
        // A whole phrase says how long it is. Pasting 24 words into the 12-word
        // grid used to drop the last twelve silently, leaving a phrase that
        // cannot restore anything and no clue why.
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
  // Typed words are secret, and so is the passphrase: out of the DOM the
  // moment the route changes. `inputs` is read late because the grid can be
  // rebuilt for 24 words after this is armed.
  const fields = () => [...inputs, passphrase];
  wipeOnLeave(fields);

  const door = { cfg, alert, offer, onScreen, remember, fields };
  const restore = async (reset = false): Promise<void> => {
    const typed = inputs.map((i) => i.value.trim().toLowerCase()).filter(Boolean);
    // Every cell first, as the desktop waits for: a blank before an unknown
    // word would shift the number the core names it by. Found by cubic.
    if (typed.length < inputs.length) {
      alert.show("error", MISSING_WORDS);
      return;
    }
    const words = typed.join(" ");
    try {
      await api.validateMnemonic(words);
    } catch (e) {
      // As the desktop says it: an unknown word by its place in the grid.
      if (onScreen()) alert.show("error", phraseError(errorMessage(e), typed));
      return;
    }
    await openWith(words, passphrase.value || undefined, door, reset, () => restore(true));
  };
  const go = button("Restore wallet", () => withBusy(go, restore), {
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
  const remember = rememberCheckbox();
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
  const open = (reset = false): Promise<void> =>
    openWith(secret.value.trim(), undefined, door, reset, () => open(true));
  const go = button("Open wallet", () => withBusy(go, open), { variant: "primary", block: true });

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
  const remember = rememberCheckbox();
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
  const follow = (reset = false): Promise<void> =>
    openWith(source.value.trim(), undefined, door, reset, () => follow(true));
  const go = button("Follow this wallet", () => withBusy(go, follow), {
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
