import { type IconName, icon } from "./icons";
import { sentence } from "./text";

type Child = Node | string | null | undefined | false;

interface Props {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  }
  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      if (handler) node.addEventListener(name, handler as EventListener);
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export type ButtonVariant = "default" | "primary" | "danger" | "quiet";

export interface ButtonIcon {
  name: IconName;
  /** Place the icon after the label (e.g. "Continue →"). */
  trailing?: boolean;
  size?: number;
}

export function button(
  label: string,
  onClick: (ev: MouseEvent) => void,
  variant: ButtonVariant = "default",
  size: "md" | "sm" = "md",
  withIcon?: ButtonIcon,
): HTMLButtonElement {
  const cls = ["btn"];
  if (variant === "primary") cls.push("btn-primary");
  if (variant === "danger") cls.push("btn-danger");
  if (variant === "quiet") cls.push("btn-quiet");
  if (size === "sm") cls.push("btn-sm");
  const btn = el("button", {
    className: cls.join(" "),
    attrs: { type: "button" },
    on: { click: onClick },
  });
  if (withIcon) {
    const svg = icon(withIcon.name, withIcon.size ?? (size === "sm" ? 14 : 16));
    const text = el("span", { className: "btn-label", text: label });
    append(btn, withIcon.trailing ? [text, svg] : [svg, text]);
  } else {
    btn.textContent = label;
  }
  return btn;
}

/** Icon-only square button (34px) with an accessible name. */
export function iconButton(
  name: IconName,
  ariaLabel: string,
  onClick: (ev: MouseEvent) => void,
): HTMLButtonElement {
  return el(
    "button",
    {
      className: "btn btn-quiet btn-icon",
      attrs: { type: "button", "aria-label": ariaLabel, title: ariaLabel },
      on: { click: onClick },
    },
    [icon(name, 16)],
  );
}

/** Replace a button's visible label, preserving any icon. */
export function setButtonLabel(btn: HTMLButtonElement, label: string): void {
  const span = btn.querySelector(".btn-label");
  if (span) span.textContent = label;
  else btn.textContent = label;
}

/** Run `work` with the button disabled and a spinner; restores state afterwards. */
export async function withBusy<T>(btn: HTMLButtonElement, work: () => Promise<T>): Promise<T> {
  btn.disabled = true;
  btn.classList.add("btn-busy");
  btn.setAttribute("aria-busy", "true");
  try {
    return await work();
  } finally {
    btn.disabled = false;
    btn.classList.remove("btn-busy");
    btn.removeAttribute("aria-busy");
  }
}

/** The elements a `<label for>` can name. */
const LABELABLE = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "METER", "OUTPUT", "PROGRESS"]);

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  const text = el("label", { className: "field-label", text: label });
  // `for` names only a form control; a group (a radiogroup `<div>`) is named
  // by pointing at the label instead. Either way it is the same visible text.
  if (LABELABLE.has(control.tagName)) {
    text.htmlFor = id;
  } else {
    text.id = `${id}-label`;
    control.setAttribute("aria-labelledby", text.id);
  }
  return el("div", { className: "field" }, [
    text,
    control,
    hint ? el("p", { className: "muted small", text: hint }) : null,
  ]);
}

export function textInput(
  opts: { value?: string; placeholder?: string; type?: string; mono?: boolean; name?: string } = {},
): HTMLInputElement {
  const input = el("input", {
    className: opts.mono ? "mono" : "",
    attrs: {
      type: opts.type ?? "text",
      spellcheck: "false",
      autocomplete: "off",
      autocapitalize: "off",
    },
  });
  if (opts.value !== undefined) input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.name) input.name = opts.name;
  return input;
}

export interface Checkbox {
  node: HTMLLabelElement;
  input: HTMLInputElement;
}

/** Labelled checkbox with an optional muted trailing hint. Unchecked by default. */
export function checkbox(label: string, hint?: string, name?: string): Checkbox {
  const input = el("input", { attrs: { type: "checkbox" } });
  if (name) input.name = name;
  const node = el("label", { className: "checkbox" }, [
    input,
    el("span", { text: label }),
    hint ? el("span", { className: "hint", text: hint }) : null,
  ]);
  return { node, input };
}

/**
 * Native radios, so the browser already gives the group one tab stop and
 * arrow keys. It still needs a name: `field()` supplies one from its label,
 * and `opts.label` names a group that stands without one.
 */
export function radioGroup<T extends string>(
  name: string,
  options: readonly { value: T; label: string }[],
  selected: T,
  onChange: (value: T) => void,
  opts: { label?: string } = {},
): HTMLElement {
  const group = el("div", {
    className: "radio-group",
    attrs: { role: "radiogroup", ...(opts.label ? { "aria-label": opts.label } : {}) },
  });
  for (const opt of options) {
    const input = el("input", { attrs: { type: "radio", name, value: opt.value } });
    input.checked = opt.value === selected;
    input.addEventListener("change", () => {
      if (input.checked) onChange(opt.value);
    });
    group.appendChild(el("label", { className: "radio" }, [input, opt.label]));
  }
  return group;
}

export type BannerKind = "error" | "ok" | "warn" | "info";

export interface Banner {
  node: HTMLElement;
  show(kind: BannerKind, message: string): void;
  hide(): void;
}

let queuedNotice: { kind: BannerKind; message: string } | null = null;

/**
 * Something that happened before any screen existed, such as a stored record
 * boot could not read. The next banner a screen creates shows it, once.
 */
export function queueNotice(kind: BannerKind, message: string): void {
  queuedNotice = { kind, message };
}

/** One `role="alert"` banner per screen. */
export function banner(): Banner {
  const node = el("div", { className: "banner", attrs: { role: "alert" } });
  const alert: Banner = {
    node,
    show(kind, message) {
      node.className = `banner banner-visible banner-${kind}`;
      // Whoever wrote it: the core's messages and a few of the UI's are lower case.
      node.textContent = sentence(message);
    },
    hide() {
      node.className = "banner";
      node.textContent = "";
    },
  };
  if (queuedNotice) {
    alert.show(queuedNotice.kind, queuedNotice.message);
    queuedNotice = null;
  }
  return alert;
}

export function kv(rows: readonly [string, Node | string][]): HTMLElement {
  const dl = el("dl", { className: "kv" });
  for (const [k, v] of rows) {
    dl.appendChild(el("dt", { text: k }));
    dl.appendChild(el("dd", {}, [v]));
  }
  return dl;
}

export { formatBtc, formatNumber, formatSats } from "./format";

/** Uppercase card heading (mockup `.label`). */
export function sectionLabel(text: string): HTMLElement {
  return el("span", { className: "section-label", text });
}

/** Read-only mono value box styled like an input. */
export function readout(text: string, extra = ""): HTMLElement {
  return el("span", { className: `readout mono ${extra}`.trim(), text, attrs: { title: text } });
}

export function mono(text: string, extra = ""): HTMLElement {
  return el("span", { className: `mono break ${extra}`.trim(), text });
}
