/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { boot } from "../src/app";
import { at, leaveTo, settle, useScreenHarness } from "./harness";

useScreenHarness();

/*
 * The whole desktop shell, booted into the page. Booting leaves the shell
 * listening for route changes for the rest of the file, which is why this is a
 * file of its own.
 */
describe("the desktop's top bar (6.8)", () => {
  it("links to Settings from the wallet's pages, and marks it on Settings itself", async () => {
    const root = document.createElement("div");
    root.id = "app";
    document.body.replaceChildren(root);
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    await boot();
    const link = () => root.querySelector<HTMLAnchorElement>(".topbar-link");

    expect(link()?.textContent).toBe("Settings");
    expect(link()?.getAttribute("href")).toBe("#/settings");
    expect(link()?.getAttribute("aria-current")).toBeNull();

    leaveTo("settings");
    await settle();
    expect(root.querySelector("h1")?.textContent).toBe("Settings");
    expect(link()?.getAttribute("aria-current")).toBe("page");

    // 7 · Import PSBT carries the same gear, unlit.
    leaveTo("psbt");
    await settle();
    expect(root.querySelector("h1")?.textContent).toBe("Import PSBT");
    expect(link()?.getAttribute("href")).toBe("#/settings");
    expect(link()?.getAttribute("aria-current")).toBeNull();

    // Send has a job to finish; it does not lead elsewhere.
    leaveTo("send");
    await settle();
    expect(link()).toBeNull();
  });
});
