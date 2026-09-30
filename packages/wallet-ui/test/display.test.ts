/** @vitest-environment jsdom */
/**
 * The display standard of Round 7 (docs/ROADMAP.md): the same value shown
 * the same way on both shells.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { renderCoins } from "../src/mobile/screens/coins";
import { renderCreate as renderPhoneCreate } from "../src/mobile/screens/create";
import { renderRestore as renderPhoneRestore, setRestoreMode } from "../src/mobile/screens/restore";
import { renderResult as renderPhoneResult } from "../src/mobile/screens/result";
import { renderSend as renderPhoneSend } from "../src/mobile/screens/send";
import { renderSettings as renderPhoneSettings } from "../src/mobile/screens/settings";
import { renderTransaction, showTransaction } from "../src/mobile/screens/tx";
import { renderUnlock as renderPhoneUnlock } from "../src/mobile/screens/unlock";
import { renderWallet as renderPhoneWallet } from "../src/mobile/screens/wallet";
import { platform, setPlatform } from "../src/platform";
import { renderCreate } from "../src/screens/create";
import { renderDashboard } from "../src/screens/dashboard";
import { renderRestore } from "../src/screens/restore";
import { renderResult } from "../src/screens/result";
import { renderSend } from "../src/screens/send";
import { renderSettings } from "../src/screens/settings";
import { renderUnlock } from "../src/screens/unlock";
import { session } from "../src/session";
import type { RememberedWallet, TxDetail } from "../src/types";
import { formatTime, shortId } from "../src/ui/format";
import {
  FROZEN_HINT,
  forgetWarning,
  NO_COINS,
  PASSPHRASE_HINT,
  RESCAN_HINT,
  SENT_LINE,
  SENT_TITLE,
} from "../src/ui/text";
import { fake } from "./fakes";
import { at, buttonNamed, find, mount, settle, useScreenHarness } from "./harness";

useScreenHarness();

const PAYEE = "tb1p5n82a6xmp47yhkkc007dxstutv23cce37xqg0n2ugwsmfnu98h2szr4k32";
const SENT = "772eeeec07e1338eb286f2cfc3455011a5fd69335c5b7d07bbcac8eb810de03a";

/** 40,000 sat paid out of this wallet, its change back to it. */
const sent: TxDetail = {
  txid: SENT,
  net_sat: -40_153,
  sent_sat: 49_580,
  received_sat: 9_427,
  fee_sat: 153,
  fee_rate_sat_vb: 1,
  confirmations: 3,
  block_height: 324_051,
  timestamp: 1_790_000_000,
  vsize: 153,
  inputs: [{ txid: "cd".repeat(32), vout: 1, value_sat: 49_580, ours: true }],
  outputs: [
    { address: PAYEE, value_sat: 40_000, ours: false },
    { address: fake.ADDRESS, value_sat: 9_427, ours: true },
  ],
};

const texts = (root: ParentNode, selector: string): (string | null)[] =>
  [...root.querySelectorAll(selector)].map((e) => e.textContent);

describe("ids and addresses (7.3)", () => {
  // A payee is checked where an output is described; shortened, two addresses
  // can share both ends.
  it("lists every output of a transaction whole on the phone", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    fake.state.details[SENT] = sent;
    showTransaction(SENT);
    const screen = mount(renderTransaction());
    await settle();

    expect(texts(screen, ".m-io-addr")).toEqual([PAYEE, fake.ADDRESS]);
    expect(texts(screen, ".m-io-note")).toEqual(["change, back to this wallet"]);
  });

  // In the desktop detail's word, "Received": the two details matched until
  // the phone's outputs moved into a card.
  it("notes an incoming output of this wallet's as received on the phone", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const RECEIVED = "ab".repeat(32);
    fake.state.details[RECEIVED] = {
      ...sent,
      txid: RECEIVED,
      net_sat: 30_000,
      sent_sat: 0,
      received_sat: 30_000,
      inputs: [{ txid: "ef".repeat(32), vout: 0, value_sat: 101_990, ours: false }],
      outputs: [
        { address: fake.ADDRESS, value_sat: 30_000, ours: true },
        { address: PAYEE, value_sat: 71_859, ours: false },
      ],
    };
    showTransaction(RECEIVED);
    const screen = mount(renderTransaction());
    await settle();

    expect(texts(screen, ".m-io-note")).toEqual(["received"]);
  });

  it("shortens a coin's address in the desktop's table, whole on hover", async () => {
    fake.state.utxos = [
      {
        txid: SENT,
        vout: 1,
        value: 9_427,
        confirmations: 3,
        address: fake.ADDRESS,
        frozen: false,
      },
    ];
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    const screen = mount(renderDashboard());
    await settle();

    const cell = [...screen.querySelectorAll<HTMLElement>("td")].find(
      (td) => td.title === fake.ADDRESS,
    );
    expect(cell?.textContent).toBe(shortId(fake.ADDRESS));
  });

  it("shortens the saved wallet's address the same way on both Unlock screens", async () => {
    const saved: RememberedWallet = {
      wallet_id: "testnet4-p2wpkh-fake",
      address: fake.ADDRESS,
      network: "testnet4",
      address_type: "p2wpkh",
    };
    setPlatform({ ...platform(), canRememberWallet: true, getRemembered: async () => saved });
    session.remembered = saved;
    at("unlock");

    const desktop = mount(renderUnlock());
    const shown = texts(desktop, ".mono");
    const phone = mount(renderPhoneUnlock());

    expect(shown).toContain(shortId(fake.ADDRESS));
    expect(texts(phone, ".m-address")).toEqual([shortId(fake.ADDRESS)]);
    session.remembered = null;
  });
});

describe("amounts and rates (7.4)", () => {
  // Below the relay minimum the core builds at 1 sat/vB anyway; the note used
  // to name the raw estimate, "0.10 sat/vB", a rate the send would not pay.
  it("names the rate the phone's Send will pay, never one under the floor", async () => {
    fake.state.estimate = { "6": 0.1 };
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("send");
    const screen = mount(renderPhoneSend());
    await settle();

    expect(texts(screen, ".m-txmeta")).toContain("1.0 sat/vB");
  });

  // Found in review: the "—" was painted over with zeros as the page was built.
  it("shows no desktop balance until one is read", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    const screen = mount(renderDashboard());

    expect(find(screen, ".stat-hero").textContent).toBe("—");
    expect(texts(screen, ".stat-value")).toEqual(["—", "—"]);
    await settle();
    expect(find(screen, ".stat-hero").textContent).not.toBe("—");
  });

  // Found in review: with no rate in the estimate, the desktop said "No
  // estimate available" and the phone named 1.0 sat/vB as if estimated.
  it("says an estimate with no rate is unavailable, alike on both Send screens", async () => {
    fake.state.estimate = {};
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("send");
    const desktop = mount(renderSend());
    await settle();
    expect(find(desktop, ".fee-source").textContent).toBe(
      "Estimate unavailable — enter a rate · floor 1.0 sat/vB",
    );

    const phone = mount(renderPhoneSend());
    await settle();
    expect(texts(phone, ".m-txmeta")).toContain("Estimate unavailable — starting at 1.0 sat/vB");
  });

  it("writes the phone's history amounts with their unit", async () => {
    fake.state.transactions = [
      {
        txid: SENT,
        net_sat: -40_153,
        sent_sat: 49_580,
        received_sat: 9_427,
        fee_sat: 153,
        confirmations: 3,
        timestamp: 1_790_000_000,
      },
    ];
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    const screen = mount(renderPhoneWallet());
    await settle();

    expect(texts(screen, ".m-amt")).toEqual([`−${(40_153).toLocaleString()} sat`]);
  });
});

describe("pending, confirmations and time (7.5)", () => {
  const pending = {
    txid: SENT,
    net_sat: -40_153,
    sent_sat: 49_580,
    received_sat: 9_427,
    fee_sat: 153,
    confirmations: null,
    timestamp: null,
  };

  it("says Pending on both shells, the desktop's in the pending colour", async () => {
    fake.state.transactions = [pending];
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    const desktop = mount(renderDashboard());
    await settle();
    const cell = [...desktop.querySelectorAll<HTMLElement>("td")].find(
      (td) => td.textContent === "Pending",
    );
    expect(cell?.classList.contains("pending")).toBe(true);

    const phone = mount(renderPhoneWallet());
    await settle();
    expect(texts(phone, ".m-txmeta .m-pending")).toEqual(["Pending"]);
  });

  // The phone's detail said "0 — in the mempool" under a "Pending" pill.
  it("says Pending in the phone's detail, never a count of 0", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    fake.state.details[SENT] = { ...sent, confirmations: null, block_height: null };
    showTransaction(SENT);
    const screen = mount(renderTransaction());
    await settle();

    const row = [...screen.querySelectorAll(".m-item")].find(
      (i) => i.firstElementChild?.textContent === "Confirmations",
    );
    expect(row?.querySelector(".m-item-value")?.textContent).toBe("Pending");
  });

  it("says when it last synced the same way on both shells", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const at14 = new Date(2026, 8, 30, 14, 32, 7);
    session.lastSyncedAt = at14;
    at("dashboard");
    const desktop = mount(renderDashboard());
    const phone = mount(renderPhoneWallet());
    const said = `Synced ${formatTime(at14)}`;

    expect(desktop.textContent).toContain(said);
    expect(phone.textContent).toContain(said);
  });
});

describe("one word for each action (7.6)", () => {
  const saved: RememberedWallet = {
    wallet_id: "testnet4-p2wpkh-fake",
    address: fake.ADDRESS,
    network: "testnet4",
    address_type: "p2wpkh",
  };

  // The desktop's Unlock asked "Really forget?" with no warning, and its way
  // out said "key" where the phone's said "wallet".
  it("offers the same way out and the same Forget on both Unlock screens", () => {
    setPlatform({ ...platform(), canRememberWallet: true, getRemembered: async () => saved });
    session.remembered = saved;
    at("unlock");

    for (const render of [renderUnlock, renderPhoneUnlock]) {
      const screen = mount(render());
      expect(buttonNamed(screen, "Use a different wallet")).toBeTruthy();
      buttonNamed(screen, "Forget this wallet").click();
      expect(screen.textContent).toContain(forgetWarning(null));
      // Found in review: the button alone said only "Delete it".
      const yes = buttonNamed(screen, "Delete it");
      const described = document.getElementById(yes.getAttribute("aria-describedby") ?? "");
      expect(described?.textContent).toBe(forgetWarning(null));
      expect(buttonNamed(screen, "Keep it")).toBeTruthy();
    }
    session.remembered = null;
  });

  it("says the same on both Sent screens", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("result");

    for (const render of [renderResult, renderPhoneResult]) {
      session.lastResult = { txid: SENT, persist_error: null, explorer_url: null };
      const screen = mount(render());
      expect(screen.textContent).toContain(SENT_TITLE);
      expect(screen.textContent).toContain(SENT_LINE);
      expect(buttonNamed(screen, "Copy transaction id")).toBeTruthy();
    }
  });
});

describe("one name for each thing (7.7)", () => {
  it("says what freezing does, and that there are no coins, alike on both shells", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("dashboard");
    const desktop = mount(renderDashboard());
    await settle();
    const desktopText = desktop.textContent;
    at("coins");
    const phone = mount(renderCoins());
    await settle();

    for (const text of [desktopText, phone.textContent]) {
      expect(text).toContain(FROZEN_HINT);
      expect(text).toContain(NO_COINS);
    }
  });

  it("says what Rescan is for alike in both Settings", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("settings");
    for (const render of [renderSettings, renderPhoneSettings]) {
      expect(mount(render()).textContent).toContain(RESCAN_HINT);
    }
  });

  // The phone's Create had no warning that the passphrase is half the backup.
  it("warns about the passphrase in the same words wherever one is set", async () => {
    at("create");
    for (const render of [renderCreate, renderPhoneCreate]) {
      const screen = mount(render());
      await settle();
      expect(screen.textContent).toContain(PASSPHRASE_HINT);
    }
    at("restore");
    setRestoreMode("phrase");
    for (const render of [renderRestore, renderPhoneRestore]) {
      expect(mount(render()).textContent).toContain(PASSPHRASE_HINT);
    }
  });
});
