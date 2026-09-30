import { api } from "../api";
import { navigate } from "../router";
import { routeGuard } from "../screen";
import { session } from "../session";
import { backendHost, errorMessage, NETWORK_LABELS, WORD_COUNTS, type WordCount } from "../types";
import { banner, button, el, field, sectionLabel, textInput, withBusy } from "../ui/dom";
import { rememberCheckbox } from "../ui/remember";
import { historyReset } from "../ui/reset";
import { PASSPHRASE_HINT, phraseError } from "../ui/text";
import { wipeOnLeave, wordCell, wordGrid, wordInput } from "../ui/words";

/** Quiet period after a keystroke before the phrase is checked again. */
const VALIDATE_DELAY_MS = 250;

function isWordCount(n: number): n is WordCount {
  return (WORD_COUNTS as readonly number[]).includes(n);
}

export function renderRestore(): HTMLElement {
  const cfg = session.config;
  if (!cfg) {
    navigate("setup");
    return el("main");
  }
  const onScreen = routeGuard();

  const alert = banner();
  const offer = historyReset(alert);
  const errorLine = el("p", { className: "field-error", attrs: { role: "status" } });
  const gridBox = el("div");
  const remember = rememberCheckbox(() => update());

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
    restoreBtn.disabled = !valid || !remember.ready();
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
      if (seq !== checking || !onScreen()) return;
      valid = true;
      errorLine.textContent = "";
    } catch (e) {
      if (seq !== checking || !onScreen()) return;
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

  const submit = async (reset = false): Promise<void> => {
    alert.hide();
    if (!valid) {
      alert.show("error", "Enter a valid recovery phrase first.");
      return;
    }
    if (!remember.ready()) return;
    const secret = words().join(" ");
    const willRemember = remember.checked();
    try {
      const open = reset ? api.resetHistoryAndOpen : api.openWallet;
      const info = await open(
        secret,
        cfg.address_type,
        willRemember,
        passphrase.value || undefined,
        remember.appPassword(),
      );
      for (const box of boxes) box.value = "";
      passphrase.value = "";
      if (willRemember) session.remembered = info;
      // `onScreen` is `routeGuard`, not `screenGuard`: it has no wallet-id
      // check to misfire against the `session.wallet` that `api.openWallet` set.
      if (onScreen()) navigate("dashboard");
    } catch (e) {
      if (onScreen()) offer.report(e, () => submit(true));
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
  wipeOnLeave(
    () => [...boxes, passphrase],
    () => window.clearTimeout(timer),
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
    offer.node,
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
      field("Passphrase (optional)", passphrase, PASSPHRASE_HINT),
      remember.node,
    ]),
    el("div", { className: "actions actions-split" }, [
      button("Back", () => navigate("key"), "quiet"),
      restoreBtn,
    ]),
  ]);
}
