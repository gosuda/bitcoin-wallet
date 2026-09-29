/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { platform, setPlatform } from "../src/platform";
import { renderDashboard } from "../src/screens/dashboard";
import { renderSettings } from "../src/screens/settings";
import { session } from "../src/session";
import type { RememberedWallet } from "../src/types";
import { fake } from "./fakes";
import { at, buttonNamed, find, mount, settle, useScreenHarness } from "./harness";

useScreenHarness();

async function openSettings(): Promise<HTMLElement> {
  await api.openWallet("abandon abandon abandon", "p2wpkh", false);
  at("settings");
  return mount(renderSettings());
}

function buttonsNamed(root: ParentNode, name: string): HTMLButtonElement[] {
  return [...root.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);
}

describe("Settings on the desktop (6.8)", () => {
  it("offers what the phone's Settings does, and the Wallet page gave up Rescan and Public keys", async () => {
    const screen = await openSettings();
    for (const text of ["Network", "Esplora server", "Address type", "Remembered on this device"]) {
      expect(screen.textContent).toContain(text);
    }
    expect(buttonsNamed(screen, "Change…")).toHaveLength(3);
    expect(buttonNamed(screen, "Rescan")).toBeTruthy();
    expect(buttonNamed(screen, "Export xpub and descriptors")).toBeTruthy();
    expect(buttonNamed(screen, "Close wallet")).toBeTruthy();
    // Nothing is remembered on this device, so there is nothing to forget.
    expect(buttonsNamed(screen, "Forget this wallet")).toHaveLength(0);

    at("dashboard");
    const dashboard = mount(renderDashboard());
    await settle();
    expect(buttonsNamed(dashboard, "Rescan")).toHaveLength(0);
    expect(dashboard.textContent).not.toContain("Public keys");
    expect(buttonNamed(dashboard, "Close wallet")).toBeTruthy();
  });

  it("asks before a change of chain, then closes the wallet and opens Setup", async () => {
    const screen = await openSettings();
    buttonsNamed(screen, "Change…")[0]?.click();
    expect(screen.textContent).toContain(
      "Changing the network closes this wallet. You will open it again from Setup.",
    );
    expect(session.wallet).not.toBeNull();

    buttonNamed(screen, "Continue").click();
    await settle();

    expect(session.wallet).toBeNull();
    expect(window.location.hash).toBe("#/setup");
  });

  it("leaves the wallet open when the change is called off", async () => {
    const screen = await openSettings();
    buttonsNamed(screen, "Change…")[1]?.click();
    expect(screen.textContent).toContain("Changing the server closes this wallet.");

    buttonNamed(screen, "Cancel").click();

    expect(screen.textContent).not.toContain("closes this wallet.");
    expect(session.wallet).not.toBeNull();
  });

  it("rescans with the gap chosen", async () => {
    const screen = await openSettings();
    find<HTMLInputElement>(screen, "input[name=rescan_gap][value='100']").click();
    buttonNamed(screen, "Rescan").click();
    await settle();

    expect(fake.calls).toContainEqual(["rescan", 100]);
    expect(find(screen, ".banner").textContent).toContain("Rescanned with a gap of 100");
  });

  it("shows the public keys only when asked", async () => {
    const screen = await openSettings();
    expect(screen.textContent).not.toContain("wpkh(fake/0/*)");

    buttonNamed(screen, "Export xpub and descriptors").click();
    await settle();

    expect(screen.textContent).toContain("wpkh(fake/0/*)");
    expect(buttonNamed(screen, "Copy descriptor")).toBeTruthy();
  });

  it("forgets a remembered wallet only after asking", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const wallet = session.wallet;
    if (!wallet) throw new Error("the wallet did not open");
    const record: RememberedWallet = {
      wallet_id: wallet.wallet_id,
      address: wallet.address,
      network: wallet.network,
      address_type: wallet.address_type,
    };
    const forgetSecret = vi.fn(async () => undefined);
    setPlatform({
      ...platform(),
      canRememberWallet: true,
      getRemembered: async () => record,
      forgetSecret,
    });
    session.remembered = record;
    at("settings");
    const screen = mount(renderSettings());
    expect(screen.textContent).toContain("in the ");

    buttonNamed(screen, "Forget this wallet").click();
    buttonNamed(screen, "Keep it").click();
    expect(forgetSecret).not.toHaveBeenCalled();
    expect(screen.textContent).not.toContain("will be deleted");

    buttonNamed(screen, "Forget this wallet").click();
    expect(screen.textContent).toContain("will be deleted");
    buttonNamed(screen, "Delete it").click();
    await settle();

    expect(forgetSecret).toHaveBeenCalledWith(wallet.wallet_id);
    expect(session.remembered).toBeNull();
    expect(session.wallet).toBeNull();
    expect(window.location.hash).toBe("#/key");
  });
});
