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

export function button(
  label: string,
  onClick: (ev: MouseEvent) => void,
  variant: "default" | "primary" | "danger" = "default",
  size: "md" | "sm" = "md",
): HTMLButtonElement {
  const cls = ["btn"];
  if (variant === "primary") cls.push("btn-primary");
  if (variant === "danger") cls.push("btn-danger");
  if (size === "sm") cls.push("btn-sm");
  return el("button", {
    className: cls.join(" "),
    text: label,
    attrs: { type: "button" },
    on: { click: onClick },
  });
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

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return el("div", { className: "field" }, [
    el("label", { className: "field-label", text: label, attrs: { for: id } }),
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

export function radioGroup<T extends string>(
  name: string,
  options: readonly { value: T; label: string }[],
  selected: T,
  onChange: (value: T) => void,
): HTMLElement {
  const group = el("div", { className: "radio-group", attrs: { role: "radiogroup" } });
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

/** One `role="alert"` banner per screen. */
export function banner(): Banner {
  const node = el("div", { className: "banner", attrs: { role: "alert" } });
  return {
    node,
    show(kind, message) {
      node.className = `banner banner-visible banner-${kind}`;
      node.textContent = message;
    },
    hide() {
      node.className = "banner";
      node.textContent = "";
    },
  };
}

export function kv(rows: readonly [string, Node | string][]): HTMLElement {
  const dl = el("dl", { className: "kv" });
  for (const [k, v] of rows) {
    dl.appendChild(el("dt", { text: k }));
    dl.appendChild(el("dd", {}, [v]));
  }
  return dl;
}

const satFormatter = new Intl.NumberFormat("en-US");

export function formatSats(sats: number): string {
  return `${satFormatter.format(sats)} sat`;
}

export function mono(text: string, extra = ""): HTMLElement {
  return el("span", { className: `mono break ${extra}`.trim(), text });
}
