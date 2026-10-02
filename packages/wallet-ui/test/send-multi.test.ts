/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { prefillSend, renderSend } from "../src/mobile/screens/send";
import { platform, setPlatform } from "../src/platform";
import { fake } from "./fakes";
import { buttonNamed, find, leaveTo, settle, showAt, type, useScreenHarness } from "./harness";

useScreenHarness();

/** The two recipients M8c is drawn with. */
const FIRST = "tb1p5n82a6xmp47yhkkc007dxstutv23cce37xqg0n2ugwsmfnu98h2szr4k32";
const SECOND = "tb1qmdpena9w6e2h49wxe0tglyrezzgcgs37us67w0";

async function openSend(): Promise<HTMLElement> {
  await api.openWallet("abandon abandon abandon", "p2wpkh", false);
  return showAt("send", renderSend);
}

function all<T extends Element>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

function nth<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new Error(`nothing at ${i}`);
  return item;
}

const addresses = (root: ParentNode) => all<HTMLInputElement>(root, "input[name=address]");
const amounts = (root: ParentNode) => all<HTMLInputElement>(root, "input[name=amount]");
const removers = (root: ParentNode) =>
  all<HTMLButtonElement>(root, '[aria-label^="Remove recipient"]');
const scanners = (root: ParentNode) =>
  all<HTMLButtonElement>(root, '[aria-label="Scan a QR code"]');
const labels = (root: ParentNode) => all(root, ".section-label").map((l) => l.textContent);
const buttonsNamed = (root: ParentNode, name: string) =>
  all<HTMLButtonElement>(root, "button").filter((b) => b.textContent?.trim() === name);

/** Installs a camera that runs until it reads a code or is told to stop, as the real one does. */
function camera() {
  let read: (text: string | null) => void = () => undefined;
  const scanQr = vi.fn(
    (signal?: AbortSignal) =>
      new Promise<string | null>((resolve) => {
        read = resolve;
        signal?.addEventListener("abort", () => resolve(null), { once: true });
      }),
  );
  setPlatform({ ...platform(), scanQr });
  return { scanQr, read: (text: string) => read(text) };
}

/** Presses a row's scan button and lets the camera open. */
async function pressScan(screen: HTMLElement, row: number): Promise<void> {
  nth(scanners(screen), row).click();
  await settle();
}

describe("several recipients on the phone (6.9)", () => {
  it("adds a card per recipient, and × shows only while there are several", async () => {
    const screen = await openSend();
    expect(labels(screen)).toEqual(["Address", "Amount", "Fee"]);
    expect(removers(screen)).toHaveLength(0);
    // This platform has no camera, so no row offers a scan.
    expect(scanners(screen)).toHaveLength(0);

    buttonNamed(screen, "Add recipient").click();
    expect(labels(screen)).toEqual(["Recipient 1", "Recipient 2", "Fee"]);
    expect(addresses(screen)).toHaveLength(2);
    expect(removers(screen)).toHaveLength(2);

    type(nth(addresses(screen), 1), SECOND);
    nth(removers(screen), 0).click();

    expect(labels(screen)).toEqual(["Address", "Amount", "Fee"]);
    expect(addresses(screen).map((f) => f.value)).toEqual([SECOND]);
    expect(removers(screen)).toHaveLength(0);
  });

  it("offers Max to a lone recipient only: a second one leaves it, and removing that brings it back", async () => {
    const buildDrain = vi.spyOn(api, "buildDrain");
    const discardTx = vi.spyOn(api, "discardTx");
    const screen = await openSend();
    type(nth(addresses(screen), 0), FIRST);
    buttonNamed(screen, "Max").click();
    await settle();
    const drain = await buildDrain.mock.results[0]?.value;
    expect(buttonNamed(screen, "Max").getAttribute("aria-pressed")).toBe("true");
    expect(nth(amounts(screen), 0).value).toBe("49859");

    buttonNamed(screen, "Add recipient").click();

    expect(buttonsNamed(screen, "Max")).toHaveLength(0);
    expect(discardTx).toHaveBeenCalledWith(drain.psbt_id);
    expect(nth(amounts(screen), 0).value).toBe("49859");

    nth(removers(screen), 1).click();

    expect(buttonNamed(screen, "Max").getAttribute("aria-pressed")).toBe("false");
    expect(screen.textContent).not.toContain("Everything:");
    expect(buildDrain).toHaveBeenCalledTimes(1);
  });

  it("has one unit for every row, and switching it converts each amount", async () => {
    const screen = await openSend();
    buttonNamed(screen, "Add recipient").click();
    type(nth(amounts(screen), 0), "30000");
    type(nth(amounts(screen), 1), "18000");
    expect(all(screen, "[role=radiogroup][aria-label='Amount unit']")).toHaveLength(1);

    buttonNamed(screen, "BTC").click();
    expect(amounts(screen).map((f) => f.value)).toEqual(["0.0003", "0.00018"]);
    buttonNamed(screen, "Add recipient").click();
    expect(all(screen, ".m-amount-unit").map((u) => u.textContent)).toEqual(["BTC", "BTC", "BTC"]);

    buttonNamed(screen, "sat").click();
    expect(amounts(screen).map((f) => f.value)).toEqual(["30000", "18000", ""]);
  });

  it("reviews every recipient, then the fee and the total, and sends them in one transaction", async () => {
    const screen = await openSend();
    buttonNamed(screen, "Add recipient").click();
    type(nth(addresses(screen), 0), FIRST);
    type(nth(amounts(screen), 0), "30000");
    type(nth(addresses(screen), 1), SECOND);
    type(nth(amounts(screen), 1), "18000");

    buttonNamed(screen, "Review").click();
    await settle();

    expect(fake.calls).toContainEqual([
      "build_transfer",
      [
        { address: FIRST, amount_sat: 30_000 },
        { address: SECOND, amount_sat: 18_000 },
      ],
      2,
    ]);
    const review = find(screen, ".m-review");
    // Each payee whole: the review is where it is checked before it is signed.
    expect(all(review, "dt").map((t) => t.textContent)).toEqual([FIRST, SECOND, "Fee", "Total"]);
    expect(all(review, "dd").map((d) => d.textContent?.replace(/\u00a0/g, " "))).toEqual([
      `${(30_000).toLocaleString()} sat`,
      `${(18_000).toLocaleString()} sat`,
      // The rate it was built at (2, above), not the fee over the size.
      "141 sat · 2.0 sat/vB · 141 vB",
      `${(48_141).toLocaleString()} sat`,
    ]);

    buttonNamed(screen, "Confirm and send").click();
    await settle();

    expect(fake.callNames().filter((name) => name === "broadcast")).toHaveLength(1);
    expect(window.location.hash).toBe("#/result");
  });

  it("reviews a lone recipient as it always has: amount, fee, change and total", async () => {
    const screen = await openSend();
    type(nth(addresses(screen), 0), FIRST);
    type(nth(amounts(screen), 0), "30000");

    buttonNamed(screen, "Review").click();
    await settle();

    expect(fake.calls).toContainEqual([
      "build_transfer",
      [{ address: FIRST, amount_sat: 30_000 }],
      2,
    ]);
    expect(all(screen, ".kv dt").map((t) => t.textContent)).toEqual([
      "Amount",
      "Fee",
      "Change",
      "Total",
    ]);
  });

  it("fills the lone row from a payment the Scan tab or a link hands over, amount included", async () => {
    prefillSend({ address: SECOND, amountSat: 18_000 });
    const screen = await openSend();

    expect(addresses(screen).map((f) => f.value)).toEqual([SECOND]);
    expect(amounts(screen).map((f) => f.value)).toEqual(["18000"]);
    expect(screen.textContent).toContain("Address filled in from a scan.");
  });

  it("scans into the last empty row, and with none empty into the row whose scan was pressed", async () => {
    const lens = camera();
    const root = document.documentElement;
    const screen = await openSend();
    buttonNamed(screen, "Add recipient").click();
    buttonNamed(screen, "Add recipient").click();
    type(nth(addresses(screen), 0), FIRST);

    await pressScan(screen, 0);
    // The camera shows through the page while the form steps aside.
    expect(root.dataset.scanning).toBeDefined();
    expect(addresses(screen)).toHaveLength(0);
    lens.read(`bitcoin:${SECOND}?amount=0.00018`);
    await settle();

    expect(root.dataset.scanning).toBeUndefined();
    expect(addresses(screen).map((f) => f.value)).toEqual([FIRST, "", SECOND]);
    expect(amounts(screen).map((f) => f.value)).toEqual(["", "", "18000"]);

    await pressScan(screen, 2);
    lens.read(fake.ADDRESS);
    await settle();
    expect(addresses(screen).map((f) => f.value)).toEqual([FIRST, fake.ADDRESS, SECOND]);

    await pressScan(screen, 0);
    lens.read(SECOND);
    await settle();
    expect(addresses(screen).map((f) => f.value)).toEqual([SECOND, fake.ADDRESS, SECOND]);
    expect(lens.scanQr).toHaveBeenCalledTimes(3);
  });

  it("brings the form back as it was when a scan is cancelled or reads no address", async () => {
    const lens = camera();
    const screen = await openSend();
    buttonNamed(screen, "Add recipient").click();
    type(nth(addresses(screen), 0), FIRST);
    type(nth(amounts(screen), 0), "30000");

    await pressScan(screen, 1);
    buttonNamed(screen, "Stop scanning").click();
    await settle();

    expect(lens.scanQr.mock.calls[0]?.[0]?.aborted).toBe(true);
    expect(document.documentElement.dataset.scanning).toBeUndefined();
    expect(addresses(screen).map((f) => f.value)).toEqual([FIRST, ""]);
    expect(screen.querySelector(".banner-visible")).toBeNull();

    await pressScan(screen, 1);
    lens.read("https://example.com");
    await settle();

    expect(find(screen, ".banner-visible").textContent).toBe(
      "That QR code is not a Bitcoin address.",
    );
    expect(addresses(screen).map((f) => f.value)).toEqual([FIRST, ""]);
    expect(amounts(screen).map((f) => f.value)).toEqual(["30000", ""]);
  });

  it("shows a scanned amount in the unit chosen", async () => {
    const lens = camera();
    const screen = await openSend();
    buttonNamed(screen, "Add recipient").click();
    buttonNamed(screen, "BTC").click();

    await pressScan(screen, 0);
    lens.read(`bitcoin:${SECOND}?amount=0.00018`);
    await settle();

    expect(amounts(screen).map((f) => f.value)).toEqual(["", "0.00018"]);
  });

  it("stops the camera when Send is left mid-scan, and turns the page solid again", async () => {
    const lens = camera();
    const screen = await openSend();
    await pressScan(screen, 0);
    expect(document.documentElement.dataset.scanning).toBeDefined();

    leaveTo("dashboard");

    expect(lens.scanQr.mock.calls[0]?.[0]?.aborted).toBe(true);
    expect(document.documentElement.dataset.scanning).toBeUndefined();
  });
});
