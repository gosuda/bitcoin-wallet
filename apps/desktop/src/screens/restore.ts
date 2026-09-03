import { api } from "../api";
import { navigate } from "../router";
import { session } from "../session";
import { backendHost, errorMessage, NETWORK_LABELS, WORD_COUNTS, type WordCount } from "../types";
import { banner, button, checkbox, el, field, sectionLabel, textInput, withBusy } from "../ui/dom";
import { wordCell, wordGrid, wordInput } from "../ui/words";

const KEYCHAIN_NAME = navigator.platform.startsWith("Mac") ? "macOS Keychain" : "OS keychain";

/** Quiet period after a keystroke before the phrase is checked again. */
const VALIDATE_DELAY_MS = 250;

function isWordCount(n: number): n is WordCount {
  return (WORD_COUNTS as readonly number[]).includes(n);
}

/** bip39 reports an unknown word by its 0-based index; the grid counts from 1. */
const UNKNOWN_WORD = /unknown word \(word (\d+)\)/i;

/** Framing the core adds on the way out. This screen is only ever about phrases. */
const CORE_PREFIX = /^(?:invalid key material:\s*)?(?:invalid mnemonic:\s*)?/i;

/**
 * The core's reason as a sentence. An unknown word is named the way the mockup
 * names it — the core knows the position, and this screen knows what was typed.
 */
function phraseError(message: string, typed: readonly string[]): string {
  const unknown = UNKNOWN_WORD.exec(message);
  if (unknown) {
    const position = Number(unknown[1]) + 1;
    const word = typed[position - 1];
    return word
      ? `Word ${position} "${word}" is not in the word list.`
      : `Word ${position} is not in the word list.`;
  }
  const text = message.trim().replace(CORE_PREFIX, "");
  if (!text) return "";
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function renderRestore(): HTMLElement {
  const cfg = session.config;
  if (!cfg) {
    navigate("setup");
    return el("main");
  }

  const alert = banner();
  const errorLine = el("p", { className: "field-error", attrs: { role: "status" } });
  const gridBox = el("div");
  const remember = checkbox(
    "Remember on this device",
    `· stored in the ${KEYCHAIN_NAME}, unlocked with your login`,
    "remember",
  );

  // Optional, and part of the wallet's identity rather than a lock on it: the
  // phrase is valid with or without one, and each passphrase restores a
  // different wallet. Left empty it means no passphrase at all.
  const passphrase = textInput({
    type: "password",
    placeholder: "Leave empty for none",
    name: "passphrase",
  });

  let count: WordCount = 12;
  let boxes: HTMLInputElement[] = [];
  let valid = false;
  let timer = 0;
  /** Guards against an earlier check landing after a later one. */
  let checking = 0;

  const chips = new Map<WordCount, HTMLInputElement>();

  /** The typed phrase, normalized the way BIP39 English phrases are written. */
  const words = (): string[] =>
    boxes.map((box) => box.value.trim().toLowerCase()).filter((word) => word !== "");

  const complete = (): boolean => boxes.length > 0 && boxes.every((b) => b.value.trim() !== "");

  const update = () => {
    restoreBtn.disabled = !valid;
  };

  const validate = async () => {
    if (!complete()) {
      checking++;
      valid = false;
      errorLine.textContent = "";
      update();
      return;
    }
    const seq = ++checking;
    const typed = words();
    try {
      await api.validateMnemonic(typed.join(" "));
      if (seq !== checking) return;
      valid = true;
      errorLine.textContent = "";
    } catch (e) {
      if (seq !== checking) return;
      valid = false;
      errorLine.textContent = phraseError(errorMessage(e), typed);
    }
    update();
  };

  const scheduleValidate = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void validate(), VALIDATE_DELAY_MS);
  };

  const validateNow = () => {
    window.clearTimeout(timer);
    void validate();
  };

  /** Spreads a pasted phrase across the boxes from `index` on. */
  const spread = (index: number, pasted: readonly string[]) => {
    for (let i = 0; i < pasted.length; i++) {
      const box = boxes[index + i];
      if (!box) break;
      box.value = (pasted[i] ?? "").toLowerCase();
    }
    boxes[Math.min(index + pasted.length, boxes.length) - 1]?.focus();
    validateNow();
  };

  const onPaste = (index: number, ev: ClipboardEvent) => {
    const pasted = (ev.clipboardData?.getData("text") ?? "").trim().split(/\s+/).filter(Boolean);
    // A single word is an ordinary paste into one box.
    if (pasted.length < 2) return;
    ev.preventDefault();
    // A whole phrase decides the layout: pasting 24 words into a 12-word grid
    // should widen the grid rather than drop half the phrase.
    if (index === 0 && isWordCount(pasted.length) && pasted.length !== count) {
      setCount(pasted.length);
    }
    spread(index, pasted);
  };

  const buildGrid = () => {
    const previous = boxes.map((box) => box.value);
    boxes = [];
    const cells = Array.from({ length: count }, (_, i) => {
      const box = wordInput(i + 1);
      box.value = previous[i] ?? "";
      box.addEventListener("input", () => {
        valid = false;
        errorLine.textContent = "";
        update();
        scheduleValidate();
      });
      box.addEventListener("blur", validateNow);
      box.addEventListener("paste", (ev) => onPaste(i, ev));
      boxes.push(box);
      return wordCell(i + 1, box);
    });
    gridBox.replaceChildren(wordGrid(cells));
  };

  function setCount(next: WordCount): void {
    if (next === count) return;
    count = next;
    for (const [value, input] of chips) input.checked = value === count;
    buildGrid();
    valid = false;
    errorLine.textContent = "";
    update();
  }

  const countChip = (value: WordCount): HTMLLabelElement => {
    const input = el("input", {
      attrs: { type: "radio", name: "word-count", value: String(value) },
    });
    input.checked = value === count;
    input.addEventListener("change", () => {
      if (input.checked) setCount(value);
    });
    chips.set(value, input);
    return el("label", { className: "radio" }, [input, `${value} words`]);
  };

  const submit = async () => {
    alert.hide();
    if (!valid) {
      alert.show("error", "Enter a valid recovery phrase first.");
      return;
    }
    const secret = words().join(" ");
    try {
      const info = await api.openWallet(
        secret,
        cfg.address_type,
        remember.input.checked,
        passphrase.value || undefined,
      );
      for (const box of boxes) box.value = "";
      passphrase.value = "";
      session.wallet = info;
      if (remember.input.checked) session.remembered = info;
      session.lastSyncedAt = null;
      navigate("dashboard");
    } catch (e) {
      alert.show("error", errorMessage(e));
    }
  };

  // `withBusy` restores the button it disabled, so the phrase gate is re-applied
  // once the attempt settles.
  const restoreBtn = button(
    "Restore wallet",
    () => void withBusy(restoreBtn, submit).finally(update),
    "primary",
    "md",
    { name: "key" },
  );
  restoreBtn.disabled = true;

  buildGrid();

  // Typed words are secret, and so is the passphrase: drop both from the DOM
  // the moment the route changes.
  window.addEventListener(
    "hashchange",
    () => {
      window.clearTimeout(timer);
      for (const box of boxes) box.value = "";
      passphrase.value = "";
    },
    { once: true },
  );

  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Restore wallet" }),
      el("p", {
        className: "muted small",
        text: `${NETWORK_LABELS[cfg.network]} · ${backendHost(cfg.backend)}`,
      }),
    ]),
    alert.node,
    el("section", { className: "card card-loose" }, [
      el("div", { className: "card-head" }, [
        sectionLabel("Recovery phrase"),
        el(
          "div",
          { className: "radio-group", attrs: { role: "radiogroup", "aria-label": "Word count" } },
          WORD_COUNTS.map(countChip),
        ),
      ]),
      gridBox,
      errorLine,
      field(
        "Passphrase (optional)",
        passphrase,
        "A passphrase creates a different wallet from the same words. It is stored with them if you choose to remember this device.",
      ),
      remember.node,
    ]),
    el("div", { className: "actions actions-split" }, [
      button("Back", () => navigate("key"), "quiet"),
      restoreBtn,
    ]),
  ]);
}
