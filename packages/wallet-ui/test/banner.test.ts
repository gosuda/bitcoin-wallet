/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { banner, queueNotice } from "../src/ui/dom";

describe("queueNotice", () => {
  // The queue is module state: whatever an earlier test left in it would show
  // in the first banner here, so each test starts by taking it.
  beforeEach(() => {
    banner();
  });

  // Boot runs before any screen exists; whichever screen comes up first says
  // what went wrong, instead of passing for a fresh start.
  it("is shown by the next banner, once", () => {
    queueNotice("error", "The saved settings could not be read (locked). Choose them again.");

    const first = banner();
    expect(first.node.textContent).toBe(
      "The saved settings could not be read (locked). Choose them again.",
    );
    expect(first.node.classList.contains("banner-error")).toBe(true);
    expect(first.node.getAttribute("role")).toBe("alert");

    const next = banner();
    expect(next.node.textContent).toBe("");
    expect(next.node.classList.contains("banner-visible")).toBe(false);
  });

  it("leaves banners empty when nothing was queued", () => {
    expect(banner().node.textContent).toBe("");
  });
});
