/**
 * Phone-shaped building blocks.
 *
 * These sit alongside `ui/dom.ts` rather than replacing it: formatting, banners
 * and the recovery-phrase grid are shared with desktop unchanged. Only the
 * chrome that a thumb touches is rebuilt here.
 */

import { navigate, type Route } from "../router";
import { el } from "../ui/dom";
import { type IconName, icon } from "../ui/icons";

export type Child = Node | string | null | undefined;

function add(parent: HTMLElement, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined) continue;
    parent.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

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
  return btn as HTMLButtonElement;
}

export function body(...children: Child[]): HTMLElement {
  const node = el("div", { className: "m-body" });
  add(node, children);
  return node;
}

export function card(...children: Child[]): HTMLElement {
  const node = el("section", { className: "m-card" });
  add(node, children);
  return node;
}

/** A card whose children are full-bleed rows (`item`). */
export function listCard(...children: Child[]): HTMLElement {
  const node = el("section", { className: "m-card m-card-flush" });
  add(node, children);
  return node;
}

export interface ButtonOpts {
  variant?: "primary" | "quiet" | "danger";
  icon?: IconName;
  disabled?: boolean;
  block?: boolean;
}

export function button(
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): HTMLButtonElement {
  const cls = ["m-btn"];
  if (opts.variant) cls.push(`m-btn-${opts.variant}`);
  if (opts.block) cls.push("m-btn-block");
  const btn = el("button", {
    className: cls.join(" "),
    attrs: { type: "button" },
    on: { click: onClick },
  }) as HTMLButtonElement;
  if (opts.icon) btn.appendChild(icon(opts.icon, 19));
  btn.appendChild(el("span", { text: label }));
  btn.disabled = opts.disabled === true;
  return btn;
}

export function row(...children: Child[]): HTMLElement {
  const node = el("div", { className: "m-row" });
  add(node, children);
  return node;
}

/** A tappable full-width row: label on the left, value and chevron on the right. */
export function item(
  label: string,
  value: string | null,
  onClick?: () => void,
  opts: { danger?: boolean } = {},
): HTMLElement {
  const right = el("span", { className: "m-item-value" });
  if (value !== null) right.appendChild(el("span", { text: value }));
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

/** Single-choice chips. Returns the node and a getter for the current value. */
export function chips<T extends string>(
  options: readonly { value: T; label: string }[],
  selected: T,
  onChange?: (value: T) => void,
): { node: HTMLElement; value(): T } {
  let current = selected;
  const node = el("div", { className: "m-chips", attrs: { role: "group" } });
  const buttons = options.map((opt) => {
    const b = el("button", {
      className: "m-chip",
      text: opt.label,
      attrs: { type: "button", "aria-pressed": String(opt.value === current) },
      on: {
        click: () => {
          current = opt.value;
          for (const [i, other] of buttons.entries()) {
            other.setAttribute("aria-pressed", String(options[i]?.value === current));
          }
          onChange?.(current);
        },
      },
    });
    node.appendChild(b);
    return b;
  });
  return { node, value: () => current };
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
