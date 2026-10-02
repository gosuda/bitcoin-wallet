/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { renderTransaction, showTransaction } from "../src/mobile/screens/tx";
import { renderDashboard } from "../src/screens/dashboard";
import { session } from "../src/session";
import type { FeeTarget, TxDetail } from "../src/types";
import { fake } from "./fakes";
import { at, buttonNamed, find, leaveTo, mount, settle, type, useScreenHarness } from "./harness";

useScreenHarness();

// The two unconfirmed rows board 3c draws open, with its numbers.
const INCOMING = "d0ff3c6274ec32caad0106af2f8e7b89e266655a59c71e6ce20890e9679c6d46";
const OUTGOING = "772eeeec07e1338eb286f2cfc3455011a5fd69335c5b7d07bbcac8eb810de03a";

/** 30,000 sat paid to this wallet by someone else, at 1 sat/vB. */
const payment = (confirmations: number | null = null): TxDetail => ({
  txid: INCOMING,
  net_sat: 30_000,
  sent_sat: 0,
  received_sat: 30_000,
  fee_sat: 141,
  fee_rate_sat_vb: 1,
  confirmations,
  block_height: confirmations === null ? null : 324_051,
  timestamp: 1_790_000_000,
  vsize: 141,
  inputs: [{ txid: "ab".repeat(32), vout: 0, value_sat: 102_000, ours: false }],
  outputs: [
    { address: fake.ADDRESS, value_sat: 30_000, ours: true },
    { address: "tb1qgjekfa6uqy5m5c7lnlgzfq4hz0ax3yh80lfwtk", value_sat: 71_859, ours: false },
  ],
});

/** 40,000 sat sent from this wallet at 1 sat/vB, with its change back. */
const sent = (confirmations: number | null = null): TxDetail => ({
  txid: OUTGOING,
  net_sat: -40_153,
  sent_sat: 49_580,
  received_sat: 9_427,
  fee_sat: 153,
  fee_rate_sat_vb: 1,
  confirmations,
  block_height: confirmations === null ? null : 324_051,
  timestamp: 1_790_000_000,
  vsize: 153,
  inputs: [{ txid: "cd".repeat(32), vout: 1, value_sat: 49_580, ours: true }],
  outputs: [
    { address: "tb1p5n82a6xmp47yhkkc007dzr4k32", value_sat: 40_000, ours: false },
    { address: fake.ADDRESS, value_sat: 9_427, ours: true },
  ],
});

/** Puts `txs` in the wallet's history, each with the unspent coin it left this wallet. */
function history(...txs: TxDetail[]): void {
  fake.state.estimate = { "1": 5, "3": 3, "6": 2 };
  for (const d of txs) {
    fake.state.transactions.push(fake.summaryOf(d));
    fake.state.details[d.txid] = d;
    d.outputs.forEach((o, vout) => {
      if (!o.ours) return;
      fake.state.utxos.push({
        txid: d.txid,
        vout,
        value: o.value_sat,
        confirmations: d.confirmations,
        address: fake.ADDRESS,
        frozen: false,
      });
    });
  }
}

const n = (sats: number): string => sats.toLocaleString();

/** The buttons named `name` exactly, or whose name matches it. */
function buttons(root: ParentNode, name: string | RegExp): HTMLButtonElement[] {
  return [...root.querySelectorAll("button")].filter((b) => {
    const text = b.textContent?.trim() ?? "";
    return typeof name === "string" ? text === name : name.test(text);
  });
}

/** Which of the three actions the screen offers, named as both shells name them. */
function offered(screen: HTMLElement): string[] {
  return [
    buttons(screen, "Speed up").length > 0 ? "Speed up" : null,
    buttons(screen, "Bump fee").length > 0 ? "Bump fee" : null,
    buttons(screen, "Cancel").length > 0 ? "Cancel" : null,
  ].filter((name) => name !== null);
}

interface Shell {
  shell: string;
  /** Opens the wallet and the transaction, the way this shell shows one. */
  show(txid: string): Promise<HTMLElement>;
  /** Chooses a target on the Speed up card. */
  target(screen: HTMLElement, blocks: FeeTarget): void;
  /** What the Speed up card says about the fake core's preview, at 5 sat/vB. */
  speedUpText(): string[];
}

const DESKTOP: Shell = {
  shell: "desktop",
  async show(txid) {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    const screen = mount(renderDashboard());
    await settle();
    // The row opens from any of its cells.
    find<HTMLElement>(screen, `td[title="${txid}"]`).click();
    await settle();
    return screen;
  },
  target(screen, blocks) {
    find<HTMLInputElement>(screen, `input[name=speedup_target][value="${blocks}"]`).click();
  },
  speedUpText: () => [
    "5.0 sat/vB for the two together",
    `Fee ${n(1_114)} sat · you keep ${n(28_886)} of the ${n(30_000)} sat`,
  ],
};

const PHONE: Shell = {
  shell: "phone",
  async show(txid) {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    // Already on the route, so choosing the row starts no navigation that
    // would retire the screen about to be built.
    at("tx");
    showTransaction(txid);
    const screen = mount(renderTransaction());
    await settle();
    return screen;
  },
  target(screen, blocks) {
    const group = find(screen, "[role=radiogroup][aria-label='Fee target']");
    buttonNamed(group, `${blocks} block${blocks > 1 ? "s" : ""}`).click();
  },
  speedUpText: () => [
    "1-block estimate 5.0 sat/vB",
    `${n(1_114)} sat`,
    "5.0 sat/vB for the two together",
    `${n(28_886)} of ${n(30_000)} sat`,
  ],
};

describe.each([DESKTOP, PHONE])("Speed up and Cancel on the $shell (6.14)", (shell) => {
  it("an unconfirmed payment to this wallet offers Speed up, and nothing else", async () => {
    history(payment());
    expect(offered(await shell.show(INCOMING))).toEqual(["Speed up"]);
  });

  // The change it left could pay for a child too, but replacing it is the better tool.
  it("an unconfirmed send offers Bump fee and Cancel, not Speed up", async () => {
    history(sent());
    expect(offered(await shell.show(OUTGOING))).toEqual(["Bump fee", "Cancel"]);
  });

  it("a confirmed transaction offers none of them", async () => {
    history(payment(3), sent(3));
    for (const txid of [INCOMING, OUTGOING]) {
      expect(offered(await shell.show(txid)), txid).toEqual([]);
    }
  });

  it("a watch-only wallet, which cannot sign, offers none of them", async () => {
    fake.state.watchOnly = true;
    history(payment(), sent());
    for (const txid of [INCOMING, OUTGOING]) {
      expect(offered(await shell.show(txid)), txid).toEqual([]);
    }
  });

  it("Speed up shows its preview's numbers, and sends only from its button", async () => {
    history(payment());
    const screen = await shell.show(INCOMING);

    expect(fake.calls).toContainEqual(["build_cpfp", INCOMING, 5]);
    for (const text of shell.speedUpText()) expect(screen.textContent).toContain(text);
    expect(fake.callNames()).not.toContain("sign");
    expect(fake.callNames()).not.toContain("broadcast");

    buttonNamed(screen, "Speed up").click();
    await settle();

    expect(fake.callNames().slice(-2)).toEqual(["sign", "broadcast"]);
    expect(session.lastResult?.txid).toBe("f".repeat(64));
    expect(window.location.hash).toBe("#/result");
  });

  // 1.5 sat/vB for the pair would not move a transaction that pays 1.0 alone.
  it("a new target builds a new preview, never under what the transaction pays alone", async () => {
    history(payment());
    fake.state.estimate = { "1": 5, "3": 3, "6": 1.5 };
    const buildCpfp = vi.spyOn(api, "buildCpfp");
    const screen = await shell.show(INCOMING);
    const first = await buildCpfp.mock.results[0]?.value;
    const discardTx = vi.spyOn(api, "discardTx");

    shell.target(screen, 6);
    await settle();

    expect(fake.calls).toContainEqual(["build_cpfp", INCOMING, 2]);
    expect(screen.textContent).toMatch(/raised above the 1\.0 sat\/vB it pays alone/i);
    expect(discardTx).toHaveBeenCalledWith(first.psbt_id);
    await expect(api.signAndBroadcast(first.psbt_id)).rejects.toMatchObject({
      code: "unknown_psbt",
    });
  });

  it("Cancel asks first: Keep it sends nothing, and Cancel transaction sends it", async () => {
    history(sent());
    const buildCancel = vi.spyOn(api, "buildCancel");
    const screen = await shell.show(OUTGOING);
    const card = `pays ${n(48_200)} sat back to this wallet. Fee ${n(1_380)} sat.`;

    buttonNamed(screen, "Cancel").click();
    await settle();
    expect(fake.calls).toContainEqual(["build_cancel", OUTGOING, 5]);
    expect(screen.textContent).toContain(`Replace it with a transaction that ${card}`);

    buttonNamed(screen, "Keep it").click();
    await settle();
    expect(screen.textContent).not.toContain(card);
    const kept = await buildCancel.mock.results[0]?.value;
    await expect(api.signAndBroadcast(kept.psbt_id)).rejects.toMatchObject({
      code: "unknown_psbt",
    });
    expect(fake.callNames()).not.toContain("sign");
    expect(fake.callNames()).not.toContain("broadcast");

    buttonNamed(screen, "Cancel").click();
    await settle();
    buttonNamed(screen, "Cancel transaction").click();
    await settle();

    expect(fake.callNames().slice(-2)).toEqual(["sign", "broadcast"]);
    expect(session.lastResult?.txid).toBe("f".repeat(64));
    expect(window.location.hash).toBe("#/result");
  });

  it("a preview still held when the screen goes is dropped", async () => {
    history(payment());
    const buildCpfp = vi.spyOn(api, "buildCpfp");
    await shell.show(INCOMING);
    const held = await buildCpfp.mock.results[0]?.value;
    const discardTx = vi.spyOn(api, "discardTx");

    leaveTo("settings");

    expect(discardTx).toHaveBeenCalledWith(held.psbt_id);
    await expect(api.signAndBroadcast(held.psbt_id)).rejects.toMatchObject({
      code: "unknown_psbt",
    });
  });
});

describe("Speed up and Cancel on the phone, as M11b and M11c draw them", () => {
  it("puts the action card above the outputs and the Transaction id, to show without scrolling", async () => {
    history(payment(), sent());
    for (const [txid, action] of [
      [INCOMING, "Speed up"],
      [OUTGOING, "Bump fee"],
    ] as const) {
      const screen = await PHONE.show(txid);
      const cards = [...find(screen, ".m-body").children];
      const place = (label: string) =>
        cards.findIndex((c) => c.querySelector(".section-label")?.textContent === label);
      expect(place(action), action).toBeGreaterThan(0);
      expect(place(action), action).toBeLessThan(place("Transaction id"));
      // Found in review: with every address whole, the outputs pushed Bump
      // fee below the fold of a 375×667 phone.
      const outputs = cards.findIndex((c) =>
        c.querySelector(".section-label")?.textContent?.startsWith("Outputs"),
      );
      expect(place(action), action).toBeLessThan(outputs);
    }
  });

  // Found in review: the field had no name once the button stopped naming the rate.
  it("names Bump fee's rate field for a screen reader", async () => {
    history(sent());
    const screen = await PHONE.show(OUTGOING);
    expect(find(screen, "input[name=bump_rate]").getAttribute("aria-label")).toBe(
      "Fee rate, in sat/vB",
    );
  });

  it("folds Bump fee away while Cancel is open, and opening it again calls the cancel off", async () => {
    history(sent());
    const buildCancel = vi.spyOn(api, "buildCancel");
    const screen = await PHONE.show(OUTGOING);

    buttonNamed(screen, "Cancel").click();
    await settle();
    expect(buttons(screen, "Bump fee")).toHaveLength(0);
    const folded = buttons(screen, /Pay more to confirm sooner/);
    expect(folded).toHaveLength(1);

    folded[0]?.click();
    await settle();

    expect(screen.textContent).not.toContain("Replace it with a transaction");
    expect(buttons(screen, "Bump fee")).toHaveLength(1);
    expect(buttonNamed(screen, "Cancel")).toBeTruthy();
    const dropped = await buildCancel.mock.results[0]?.value;
    await expect(api.signAndBroadcast(dropped.psbt_id)).rejects.toMatchObject({
      code: "unknown_psbt",
    });
  });

  it("builds a Custom rate only above what the transaction pays alone", async () => {
    history(payment());
    const screen = await PHONE.show(INCOMING);
    const group = find(screen, "[role=radiogroup][aria-label='Fee target']");
    buttonNamed(group, "Custom").click();
    await settle();
    const rate = find<HTMLInputElement>(screen, "input[name=speedup_rate]");
    expect(rate.value).toBe("5");
    fake.calls.length = 0;

    type(rate, "1");
    await settle();
    expect(screen.textContent).toContain("It pays 1.0 sat/vB alone already");
    expect(fake.callNames()).not.toContain("build_cpfp");

    type(rate, "7.5");
    await settle();
    expect(fake.calls).toContainEqual(["build_cpfp", INCOMING, 7.5]);
    expect(screen.textContent).toContain("7.5 sat/vB for the two together");

    // Found by cubic: 7.55 read "7.5 sat/vB" and was built at 7.55. It is
    // rounded up to a tenth, and built at what it says.
    type(rate, "7.55");
    await settle();
    expect(fake.calls).toContainEqual(["build_cpfp", INCOMING, 7.6]);
    expect(screen.textContent).toContain("7.6 sat/vB for the two together");
  });
});
