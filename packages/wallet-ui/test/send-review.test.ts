/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { renderSend } from "../src/screens/send";
import { fake } from "./fakes";
import { buttonNamed, find, settle, showAt, type, useScreenHarness } from "./harness";

useScreenHarness();

const FIRST = "tb1p5n82a6xmp47yhkkc007dxstutv23cce37xqg0n2ugwsmfnu98h2szr4k32";
const SECOND = "tb1qmdpena9w6e2h49wxe0tglyrezzgcgs37us67w0";

async function openSend(): Promise<HTMLElement> {
  await api.openWallet("abandon abandon abandon", "p2wpkh", false);
  return showAt("send", renderSend);
}

function recipients(screen: HTMLElement): HTMLInputElement[] {
  return [...screen.querySelectorAll<HTMLInputElement>('[id^="recipient-address-"]')];
}

function amounts(screen: HTMLElement): HTMLInputElement[] {
  return [...screen.querySelectorAll<HTMLInputElement>('[id^="recipient-amount-"]')];
}

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing item ${index}`);
  return item;
}

describe("desktop confirmation pays only reviewed PSBT destinations", () => {
  it("shows every full address and amount beside Confirm and send", async () => {
    const screen = await openSend();
    type(nth(recipients(screen), 0), FIRST);
    type(nth(amounts(screen), 0), "30000");
    buttonNamed(screen, "Add recipient").click();
    type(nth(recipients(screen), 1), SECOND);
    type(nth(amounts(screen), 1), "18000");

    buttonNamed(screen, "Review").click();
    await settle();

    const review = find(screen, ".review-card:not(.hidden)");
    expect([...review.querySelectorAll(".send-review-address")].map((n) => n.textContent)).toEqual([
      FIRST,
      SECOND,
    ]);
    expect(review.textContent).toContain("30,000 sat");
    expect(review.textContent).toContain("18,000 sat");
    expect(review.contains(buttonNamed(screen, "Confirm and send"))).toBe(true);

    buttonNamed(screen, "Confirm and send").click();
    await settle();
    expect(fake.callNames()).toContain("broadcast");
  });

  it("uses the core's exact Max output amount and address", async () => {
    const screen = await openSend();
    type(nth(recipients(screen), 0), FIRST);
    buttonNamed(screen, "Max").click();
    await settle();
    buttonNamed(screen, "Review").click();
    await settle();

    const review = find(screen, ".review-card:not(.hidden)");
    expect(find(review, ".send-review-address").textContent).toBe(FIRST);
    expect(review.textContent).toContain("49,859 sat");
  });

  it("rejects a PSBT whose destinations differ from the form before authorizing", async () => {
    vi.spyOn(fake.FakeWallet.prototype, "build_transfer").mockResolvedValueOnce({
      psbt_base64: "substituted-psbt",
      fee_sat: 141,
      vsize: 141,
      total_out_sat: 30_000,
      change_sat: 0,
      input_count: 1,
      recipients: [{ address: SECOND, amount_sat: 30_000 }],
    });

    const screen = await openSend();
    type(nth(recipients(screen), 0), FIRST);
    type(nth(amounts(screen), 0), "30000");
    buttonNamed(screen, "Review").click();
    await settle();

    expect(screen.textContent).toContain("Built transaction recipients do not match");
    expect(screen.querySelector(".review-card:not(.hidden)")).toBeNull();
    expect(fake.callNames()).not.toContain("sign");
    expect(fake.callNames()).not.toContain("broadcast");
  });
});
