/**
 * The numbered recovery-phrase grid shared by the Create and Restore screens
 * (mockup `word_grid()` in design/gen.py): four columns of position-labelled
 * cells holding either a written word or a box to type one into.
 */

import { el, textInput } from "./dom";

/** One cell: its 1-based position and the value that belongs there. */
export function wordCell(position: number, body: Node): HTMLElement {
  return el("div", { className: "word-cell" }, [
    el("span", { className: "hint word-index", text: String(position) }),
    body,
  ]);
}

/** A word as it is written down; read-only. */
export function wordText(word: string): HTMLElement {
  return el("span", { className: "mono word-text", text: word });
}

/**
 * A box for one word. `blank` draws the accent rule the mockup uses for a word
 * the user has to fill in, rather than one they are transcribing.
 */
export function wordInput(position: number, blank = false): HTMLInputElement {
  const input = textInput({ mono: true });
  input.classList.add("word-input");
  if (blank) input.classList.add("word-input-blank");
  input.setAttribute("aria-label", `Word ${position}`);
  return input;
}

export function wordGrid(cells: readonly HTMLElement[]): HTMLElement {
  return el("div", { className: "word-grid" }, [...cells]);
}

/**
 * Clears `inputs` the moment the route changes. Typed words and passphrases
 * are secret and must not outlive their screen in the DOM; `inputs` is a
 * function because a grid can be rebuilt (12 → 24 words) after this is armed.
 */
export function wipeOnLeave(inputs: () => Iterable<HTMLInputElement>, also?: () => void): void {
  window.addEventListener(
    "hashchange",
    () => {
      for (const input of inputs()) input.value = "";
      also?.();
    },
    { once: true },
  );
}
