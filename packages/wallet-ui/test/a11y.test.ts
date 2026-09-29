/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { chips } from "../src/mobile/ui";
import { field, radioGroup, textInput } from "../src/ui/dom";

const OPTIONS = [
  { value: "1", label: "1 block" },
  { value: "3", label: "3 blocks" },
  { value: "6", label: "6 blocks" },
] as const;

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function mounted<T extends { node: HTMLElement }>(control: T): T {
  document.body.replaceChildren(control.node);
  return control;
}

const radios = (node: HTMLElement): HTMLButtonElement[] => [
  ...node.querySelectorAll<HTMLButtonElement>("[role=radio]"),
];

describe("chips", () => {
  it("is one tab stop, on the chosen chip", () => {
    const group = mounted(chips(OPTIONS, "3"));
    expect(radios(group.node).map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(radios(group.node).map((b) => b.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("moves the choice and the focus with the arrow keys, wrapping at the ends", () => {
    const onChange = vi.fn();
    const group = mounted(chips(OPTIONS, "6", onChange));
    const [first, , last] = radios(group.node);
    if (!first || !last) throw new Error("three chips expected");

    last.focus();
    const event = press(last, "ArrowRight");

    expect(event.defaultPrevented).toBe(true);
    expect(group.value()).toBe("1");
    expect(onChange).toHaveBeenLastCalledWith("1");
    expect(document.activeElement).toBe(first);
    expect(first.tabIndex).toBe(0);
    expect(last.tabIndex).toBe(-1);

    press(first, "ArrowLeft");
    expect(group.value()).toBe("6");
    expect(document.activeElement).toBe(last);

    press(last, "ArrowUp");
    expect(group.value()).toBe("3");
    press(radios(group.node)[1] as HTMLButtonElement, "ArrowDown");
    expect(group.value()).toBe("6");
  });

  it("jumps to the ends with Home and End", () => {
    const group = mounted(chips(OPTIONS, "3"));
    const middle = radios(group.node)[1] as HTMLButtonElement;
    press(middle, "End");
    expect(group.value()).toBe("6");
    press(radios(group.node)[2] as HTMLButtonElement, "Home");
    expect(group.value()).toBe("1");
  });

  it("leaves every other key to the browser", () => {
    const onChange = vi.fn();
    const group = mounted(chips(OPTIONS, "3", onChange));
    const event = press(radios(group.node)[1] as HTMLButtonElement, "a");
    expect(event.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays reachable when the choice matches no chip", () => {
    const group = mounted(chips<string>(OPTIONS, "144"));
    expect(radios(group.node).map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it("carries the name it is given", () => {
    const group = mounted(chips(OPTIONS, "3", undefined, { label: "Fee target" }));
    expect(group.node.getAttribute("aria-label")).toBe("Fee target");
  });
});

describe("naming", () => {
  // `for` only names a form control; a radiogroup is a <div>.
  it("field() names a group through its label, not a `for` it cannot use", () => {
    const group = radioGroup("fee_target", OPTIONS, "6", () => undefined);
    const wrapper = field("Target", group);
    const label = wrapper.querySelector("label") as HTMLLabelElement;

    expect(label.htmlFor).toBe("");
    expect(label.id).not.toBe("");
    expect(group.getAttribute("aria-labelledby")).toBe(label.id);
    expect(label.textContent).toBe("Target");
  });

  it("field() still labels an input with `for`", () => {
    const input = textInput({ name: "url" });
    const wrapper = field("Esplora URL", input);
    const label = wrapper.querySelector("label") as HTMLLabelElement;

    expect(label.htmlFor).toBe(input.id);
    expect(input.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("radioGroup() takes a name when it stands without a label", () => {
    const group = radioGroup("rescan_gap", OPTIONS, "1", () => undefined, {
      label: "Address gap",
    });
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(group.getAttribute("aria-label")).toBe("Address gap");
  });
});
