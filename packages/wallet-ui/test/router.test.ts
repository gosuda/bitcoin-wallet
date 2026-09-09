/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentRoute, navigate, ROUTES } from "../src/router";

beforeEach(() => {
  window.location.hash = "";
});

describe("currentRoute", () => {
  it("reads every known route", () => {
    for (const route of ROUTES) {
      window.location.hash = `#/${route}`;
      expect(currentRoute(), route).toBe(route);
    }
  });

  it("tolerates a hash written without the slash", () => {
    window.location.hash = "#dashboard";
    expect(currentRoute()).toBe("dashboard");
  });

  // A hand-edited or stale URL must land somewhere real rather than render
  // nothing; setup is the one screen that is always safe to show.
  it("falls back to setup for anything unknown", () => {
    for (const hash of ["", "#", "#/", "#/nope", "#/../dashboard", "#/DASHBOARD"]) {
      window.location.hash = hash;
      expect(currentRoute(), hash).toBe("setup");
    }
  });
});

describe("navigate", () => {
  it("moves to another route", () => {
    navigate("dashboard");
    expect(window.location.hash).toBe("#/dashboard");
    expect(currentRoute()).toBe("dashboard");
  });

  // Assigning the same hash fires no hashchange, so a screen asked to reload
  // itself would silently do nothing without this.
  it("still announces a move to the route already shown", () => {
    window.location.hash = "#/dashboard";
    const heard = vi.fn();
    window.addEventListener("hashchange", heard);
    navigate("dashboard");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("hashchange", heard);
  });
});
