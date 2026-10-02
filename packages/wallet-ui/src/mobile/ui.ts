/**
 * Phone-shaped building blocks.
 *
 * These sit alongside `ui/dom.ts` rather than replacing it: formatting, banners
 * and the recovery-phrase grid are shared with desktop unchanged. Only the
 * chrome that a thumb touches is rebuilt here.
 */

import { platform } from "../platform";
import { navigate, type Route } from "../router";
import { errorMessage, historyResetFixes, type TxOutput } from "../types";
import { type Banner, el } from "../ui/dom";
import { outputRole } from "../ui/format";
import { type IconName, icon } from "../ui/icons";
import { type HistoryReset, RESET_CONFIRM, RESET_TEXT, RESET_TRIGGER } from "../ui/reset";
import { sentence } from "../ui/text";

export type Child = Node | string | null | undefined;

/** A screen header: optional back button, centred title, optional right action. */
export function header(
  title: string,
  opts: {
    back?: Route | (() => void);
    action?: { name: IconName; label: string; onClick(): void };
  } = {},
): HTMLElement {
  const left = el("div", { className: "m-head-slot" });
  if (opts.back) {
    const to = opts.back;
    left.appendChild(
      iconButton("back", "Back", () => {
        if (typeof to === "function") to();
        else navigate(to);
      }),
    );
  }
  const right = el("div", { className: "m-head-slot" });
  if (opts.action) {
    right.appendChild(iconButton(opts.action.name, opts.action.label, opts.action.onClick));
  }
  return el("header", { className: "m-head" }, [left, el("h1", { text: title }), right]);
}

export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const btn = el("button", {
    className: "m-icon-btn",
    attrs: { type: "button", "aria-label": label, title: label },
    on: { click: onClick },
  });
  btn.appendChild(icon(name, 24));
  return btn;
}

export function body(...children: Child[]): HTMLElement {
  return el("div", { className: "m-body" }, children);
}

export function card(...children: Child[]): HTMLElement {
  return el("section", { className: "m-card" }, children);
}

/** A card whose children are full-bleed rows (`item`). */
export function listCard(...children: Child[]): HTMLElement {
  return el("section", { className: "m-card m-card-flush" }, children);
}

export interface ButtonOpts {
  variant?: "primary" | "quiet" | "danger";
  icon?: IconName;
  disabled?: boolean;
  block?: boolean;
  /** For an icon-only button: what it is called, since the icon is hidden. */
  ariaLabel?: string;
  /** A 48px square, for an icon beside a field. */
  square?: boolean;
}

export function button(
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): HTMLButtonElement {
  const cls = ["m-btn"];
  if (opts.variant) cls.push(`m-btn-${opts.variant}`);
  if (opts.block) cls.push("m-btn-block");
  if (opts.square) cls.push("m-btn-square");
  const btn = el("button", {
    className: cls.join(" "),
    attrs: { type: "button", ...(opts.ariaLabel ? { "aria-label": opts.ariaLabel } : {}) },
    on: { click: onClick },
  });
  if (opts.icon) btn.appendChild(icon(opts.icon, 19));
  if (label) btn.appendChild(el("span", { text: label }));
  btn.disabled = opts.disabled === true;
  return btn;
}

/**
 * One line of a list of inputs or outputs, as Transaction and Import PSBT
 * draw them (M14): where, whole, with a note under it, and the value across.
 * An address is never shortened here: this is where a payee is checked.
 */
export function ioLine(where: string, value: string, note: string | null): HTMLElement {
  return el("div", { className: "m-io" }, [
    el("span", { className: "m-io-where" }, [
      el("span", { className: "m-io-addr", text: where }),
      note === null ? null : el("span", { className: "m-io-note", text: note }),
    ]),
    el("span", { className: "m-io-value", text: value }),
  ]);
}

/** Said under an output that is this wallet's; a payment to someone else needs no note. */
export function outputNote(owner: { net_sat: number }, output: TxOutput): string | null {
  const role = outputRole(owner, output);
  return role === "change"
    ? "change, back to this wallet"
    : role === "ours"
      ? "to this wallet"
      : null;
}

export function row(...children: Child[]): HTMLElement {
  return el("div", { className: "m-row" }, children);
}

/**
 * A tappable full-width row: label on the left, value and chevron on the right.
 * A value the screen fills in later is passed as the node it will write to.
 */
export function item(
  label: string,
  value: string | Node | null,
  onClick?: () => void,
  opts: { danger?: boolean } = {},
): HTMLElement {
  const right = el("span", { className: "m-item-value" });
  if (value !== null) {
    right.appendChild(typeof value === "string" ? el("span", { text: value }) : value);
  }
  if (onClick) right.appendChild(icon("chevron", 17));
  const node = el(onClick ? "button" : "div", {
    className: "m-item",
    attrs: onClick ? { type: "button" } : {},
    ...(onClick ? { on: { click: onClick } } : {}),
  });
  const text = el("span", { text: label });
  if (opts.danger) text.style.setProperty("color", "var(--danger)");
  node.appendChild(text);
  node.appendChild(right);
  return node;
}

/** Where an arrow key, Home or End moves a choice from `from`; null for any other key. */
function moveTo(key: string, from: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Single-choice chips: one radio group, so a screen reader hears "1 of 3"
 * rather than three unrelated toggles. It behaves as one, too, the way native
 * radios do: a single tab stop on the chosen chip, and the arrow keys (Home
 * and End as well) move the choice and the focus together. `tight` fits four
 * on a phone row.
 */
export function chips<T extends string>(
  options: readonly { value: T; label: string }[],
  selected: T,
  onChange?: (value: T) => void,
  opts: { tight?: boolean; label?: string } = {},
): { node: HTMLElement; value(): T; select(value: T): void } {
  let current = selected;
  const node = el("div", {
    className: opts.tight ? "m-chips m-chips-tight" : "m-chips",
    attrs: { role: "radiogroup", ...(opts.label ? { "aria-label": opts.label } : {}) },
  });
  const buttons = options.map((opt) => {
    const b = el("button", {
      className: "m-chip",
      text: opt.label,
      attrs: { type: "button", role: "radio" },
      on: { click: () => select(opt.value) },
    });
    node.appendChild(b);
    return b;
  });

  const paint = (): void => {
    for (const [i, b] of buttons.entries()) {
      const chosen = options[i]?.value === current;
      b.setAttribute("aria-checked", String(chosen));
      b.tabIndex = chosen ? 0 : -1;
    }
    // A choice that matches no chip must not leave the group unreachable.
    const first = buttons[0];
    if (first && !buttons.some((b) => b.tabIndex === 0)) first.tabIndex = 0;
  };

  node.addEventListener("keydown", (ev) => {
    if (!(ev.target instanceof HTMLButtonElement)) return;
    const from = buttons.indexOf(ev.target);
    const to = from < 0 ? null : moveTo(ev.key, from, buttons.length);
    const next = to === null ? undefined : options[to];
    if (to === null || next === undefined) return;
    ev.preventDefault();
    select(next.value);
    buttons[to]?.focus();
  });

  function select(value: T): void {
    current = value;
    paint();
    onChange?.(current);
  }

  paint();
  return { node, value: () => current, select };
}

/**
 * A section label that is also the control's accessible name. Looks exactly
 * like `sectionLabel`; the difference is the `for`.
 */
export function labelled(text: string, control: HTMLElement, note?: string): HTMLElement {
  const id = control.id || `m-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  const label = el("label", { className: "section-label", text, attrs: { for: id } });
  if (note) label.appendChild(el("span", { className: "m-optional", text: ` ${note}` }));
  return label;
}

/**
 * A destructive action in two taps: the trigger replaces itself with what
 * will happen and a Delete / Keep pair. Every place a wallet can be forgotten
 * goes through this, so the phone never destroys anything on one tap.
 */
let confirmSeq = 0;

export function confirmDanger(opts: {
  trigger: string;
  triggerVariant?: "danger" | "quiet";
  text: string;
  confirm: string;
  onConfirm(): Promise<void>;
}): HTMLElement {
  const host = el("div", { className: "m-confirm-host" });
  const arm = button(
    opts.trigger,
    () => {
      const go = button(opts.confirm, () => withBusy(go, opts.onConfirm), {
        variant: "danger",
        block: true,
      });
      // Read out with the button, which alone says only "Delete it".
      const warning = lede(opts.text);
      warning.id = `confirm-danger-${++confirmSeq}`;
      go.setAttribute("aria-describedby", warning.id);
      const sheet = card(
        warning,
        go,
        // Back to the trigger: the focused button is gone. Found by cubic.
        button(
          "Keep it",
          () => {
            host.replaceChildren(arm);
            arm.focus();
          },
          { variant: "quiet" },
        ),
      );
      sheet.classList.add("m-confirm");
      host.replaceChildren(sheet);
    },
    { variant: opts.triggerVariant ?? "danger", block: true },
  );
  host.appendChild(arm);
  return host;
}

/**
 * The phone's `historyReset` (see `ui/reset.ts`), as the canvas draws it on
 * Unlock: a card with the error and its trigger, then the second step in the
 * accent, two taps as with `confirmDanger`.
 */
export function historyReset(alert: Banner): HistoryReset {
  const node = el("div", { className: "m-reset" });
  return {
    node,
    report(error, reset) {
      if (!historyResetFixes(error)) {
        node.replaceChildren();
        alert.show("error", errorMessage(error));
        return false;
      }
      alert.hide();
      const step = el("div", { className: "slot" });
      const trigger = button(
        RESET_TRIGGER,
        () => {
          const go = button(RESET_CONFIRM, () => withBusy(go, reset), {
            variant: "primary",
            block: true,
          });
          const keep = button(
            "Keep it",
            () => {
              step.replaceChildren();
              trigger.focus();
            },
            { variant: "quiet" },
          );
          const sheet = card(lede(RESET_TEXT), go, keep);
          sheet.classList.add("m-confirm", "m-confirm-accent");
          step.replaceChildren(sheet);
          go.focus();
        },
        { block: true },
      );
      const offer = card(
        el("p", { className: "m-reset-message", attrs: { role: "alert" } }, [
          icon("alert", 20),
          el("span", { text: sentence(errorMessage(error)) }),
        ]),
        trigger,
      );
      offer.classList.add("m-reset-card");
      node.replaceChildren(offer, step);
      return true;
    },
  };
}

/** The four corners a QR code is aimed into. */
export function reticle(): HTMLElement {
  return el("div", { className: "m-reticle" }, [el("span"), el("span"), el("span"), el("span")]);
}

/** Marks handed out so far; each one carries its own number. */
let marks = 0;

/**
 * Turns the page see-through while a camera runs: the OS draws the preview
 * behind the webview, not in it, so the page has to let it show
 * (`data-scanning` on the root element).
 *
 * A screen replaced mid-scan hears that it has left only after the new one
 * has rendered, so clearing leaves alone a mark some other screen has set
 * since.
 */
export function seeThroughMark(): { set(): void; clear(): void } {
  const root = document.documentElement;
  const id = String(++marks);
  return {
    set: () => {
      root.dataset.scanning = id;
    },
    clear: () => {
      if (root.dataset.scanning === id) delete root.dataset.scanning;
    },
  };
}

/**
 * Scanning without leaving the screen, as Send and Import PSBT do: Scan would
 * rebuild the screen and lose what is on it. While the camera runs the screen
 * steps aside for what Scan shows, a reticle over a page turned see-through,
 * and comes back as it was. Null where this build has no camera.
 *
 * A scan hands what it read to `use` while the screen is still on; a failure
 * is said in the banner, and a cancel says nothing. `form` is what scrolls.
 */
export function scanInPlace(
  host: HTMLElement,
  alert: Banner,
  onScreen: () => boolean,
  hint: string,
): ((form: HTMLElement, use: (text: string) => void | Promise<void>) => Promise<void>) | null {
  const scanQr = platform().scanQr;
  if (!scanQr) return null;
  const mark = seeThroughMark();
  /** Stops the camera and turns the page solid again; null while none runs. */
  let stopScan: (() => void) | null = null;
  const scanHead = header("Scan");
  const scanner = body(
    el("div", { className: "m-scan" }, [reticle(), lede(hint)]),
    button("Stop scanning", () => stopScan?.(), { block: true }),
  );
  // The camera offers no way out of its own, so leaving the screen stops it.
  window.addEventListener("hashchange", () => stopScan?.(), { once: true });

  return async (form, use) => {
    if (stopScan) return;
    alert.hide();
    const camera = new AbortController();
    const stop = (): void => {
      camera.abort();
      mark.clear();
    };
    stopScan = stop;
    // Taking the form out of the page scrolls it back to the top.
    const scrolled = form.scrollTop;
    const page = [...host.childNodes];
    mark.set();
    host.classList.add("m-scanner");
    host.replaceChildren(scanHead, scanner);
    let text: string | null = null;
    try {
      text = await scanQr(camera.signal);
    } catch (e) {
      if (onScreen()) alert.show("error", errorMessage(e));
    }
    stop();
    stopScan = null;
    host.classList.remove("m-scanner");
    host.replaceChildren(...page);
    form.scrollTop = scrolled;
    // Null is a cancel, not a failure: say nothing.
    if (text === null || !onScreen()) return;
    await use(text);
  };
}

/** Pushes everything after it to the bottom of the scroll area. */
export function spacer(): HTMLElement {
  return el("div", { className: "m-spacer" });
}

export function lede(text: string): HTMLElement {
  return el("p", { className: "m-lede", text });
}

/**
 * Runs an async action with the button disabled, so a slow sync or broadcast
 * cannot be fired twice by an impatient tap.
 */
export async function withBusy(btn: HTMLButtonElement, work: () => Promise<void>): Promise<void> {
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  try {
    await work();
  } finally {
    btn.disabled = wasDisabled;
    btn.removeAttribute("aria-busy");
  }
}
