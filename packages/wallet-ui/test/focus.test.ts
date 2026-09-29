import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Focus rings exist only in the stylesheets, which no other test loads, and
 * jsdom paints nothing anyway. These tests read the two files as text, so an
 * edit that drops a control's ring fails here rather than for the next person
 * using the app with a keyboard.
 */

interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

/** `text` cut at each `sep` outside parentheses and quotes, whitespace collapsed. */
function split(text: string, sep: "," | ";"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    } else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p !== "");
}

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const declaration of split(block, ";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0) out.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return out;
}

/** Every style rule in `css`, those inside an at-rule such as `@media` included. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  let prelude = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "{") {
      if (depth === 0) {
        prelude = text.slice(start, i).trim();
        start = i + 1;
      }
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        const block = text.slice(start, i);
        if (prelude.startsWith("@")) out.push(...rules(block));
        else out.push({ selectors: split(prelude, ","), declarations: declarations(block) });
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) {
      start = i + 1;
    }
  }
  return out;
}

function stylesheet(name: string): Rule[] {
  return rules(readFileSync(new URL(`../src/ui/${name}`, import.meta.url), "utf8"));
}

/** What the rules naming `selector` declare, a later declaration beating an earlier one. */
function declared(sheet: readonly Rule[], selector: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const rule of sheet) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [property, value] of rule.declarations) out.set(property, value);
  }
  return out;
}

const app = stylesheet("app.css");
const mobile = stylesheet("mobile.css");

const INSIDE = "inset 0 0 0 2px var(--accent)";

describe("focus rings (6.10)", () => {
  // The phone loads app.css too, so this one rule is its ring for fields,
  // chips, and every button it does not draw its own for below.
  it("rings every field, textarea, button and link on both shells", () => {
    for (const control of ["input", "select", "textarea", "button", "a"]) {
      const ring = declared(app, `${control}:focus-visible`);
      expect(ring.get("outline"), control).toBe("2px solid var(--accent)");
      expect(ring.get("outline-offset"), control).toBe("1px");
    }
  });

  it("draws a phone row's ring inside its edge, turning with the card's corners", () => {
    for (const row of [".m-item", "button.m-txrow", ".m-card-flush > .m-btn"]) {
      const ring = declared(mobile, `${row}:focus-visible`);
      expect(ring.get("outline"), row).toBe("none");
      expect(ring.get("box-shadow"), row).toBe(INSIDE);
    }
    const top = declared(mobile, ".m-card-flush > :first-child:focus-visible");
    const bottom = declared(mobile, ".m-card-flush > :last-child:focus-visible");
    const corner = "calc(var(--radius-lg) - 1px)";
    expect([top.get("border-top-left-radius"), top.get("border-top-right-radius")]).toEqual([
      corner,
      corner,
    ]);
    expect([
      bottom.get("border-bottom-left-radius"),
      bottom.get("border-bottom-right-radius"),
    ]).toEqual([corner, corner]);
  });

  it("draws a tab's ring inside the tab", () => {
    const tab = declared(mobile, ".m-tab:focus-visible");
    expect(tab.get("outline")).toBe("none");
    expect(tab.get("position")).toBe("relative");
    const ring = declared(mobile, ".m-tab:focus-visible::after");
    expect(ring.get("content")).toBe('""');
    expect(ring.get("position")).toBe("absolute");
    expect(ring.get("box-shadow")).toBe(INSIDE);
  });

  it("rings the primary button in the text colour, clear of its accent fill", () => {
    const ring = declared(mobile, ".m-btn-primary:focus-visible");
    expect(ring.get("outline")).toBe("2px solid var(--fg)");
    expect(ring.get("outline-offset")).toBe("2px");
    // Scan is dark in the light theme as well, where --fg would vanish.
    expect(declared(mobile, ".m-scanner .m-btn-primary:focus-visible").get("outline-color")).toBe(
      "var(--scan-fg)",
    );
  });

  // `:focus` also matches the button a tap lands on; `:focus-visible` only
  // matches when the browser judges a ring useful, as after a Tab key.
  it("keys no rule on plain :focus, so a tap draws nothing", () => {
    const selectors = [...app, ...mobile].flatMap((rule) => rule.selectors);
    expect(selectors.filter((s) => /:focus(?![-\w])/.test(s))).toEqual([]);
  });

  it("never takes a phone control's ring away without drawing another", () => {
    const bare = mobile
      .filter((rule) => rule.declarations.get("outline") === "none")
      .flatMap((rule) => rule.selectors)
      .filter(
        (s) =>
          !declared(mobile, s).has("box-shadow") &&
          !declared(mobile, `${s}::after`).has("box-shadow"),
      );
    expect(bare).toEqual([]);
  });
});
