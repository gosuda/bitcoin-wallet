/** @vitest-environment jsdom */
/**
 * The display standard of Round 7 (docs/ROADMAP.md): the same value shown
 * the same way on both shells.
 */
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { renderCoins } from "../src/mobile/screens/coins";
import { renderCreate as renderPhoneCreate } from "../src/mobile/screens/create";
import { renderExport } from "../src/mobile/screens/export";
import { renderReceive as renderPhoneReceive } from "../src/mobile/screens/receive";
import { renderRestore as renderPhoneRestore, setRestoreMode } from "../src/mobile/screens/restore";
import { renderResult as renderPhoneResult } from "../src/mobile/screens/result";
import { renderSend as renderPhoneSend } from "../src/mobile/screens/send";
import { renderSettings as renderPhoneSettings } from "../src/mobile/screens/settings";
import { renderSetup as renderPhoneSetup } from "../src/mobile/screens/setup";
import { renderUnlock as renderPhoneUnlock } from "../src/mobile/screens/unlock";
import { renderWallet as renderPhoneWallet } from "../src/mobile/screens/wallet";
import { renderCreate } from "../src/screens/create";
import { renderDashboard } from "../src/screens/dashboard";
import { renderRestore } from "../src/screens/restore";
import { renderResult } from "../src/screens/result";
import { renderSend } from "../src/screens/send";
import { renderSettings } from "../src/screens/settings";
import { renderSetup } from "../src/screens/setup";
import { renderUnlock } from "../src/screens/unlock";
import { session } from "../src/session";
import { WalletError } from "../src/types";
import { banner } from "../src/ui/dom";
import { formatTime, shortId } from "../src/ui/format";
import {
  FROZEN_HINT,
  forgetWarning,
  NO_COINS,
  PASSPHRASE_HINT,
  PUBLIC_KEYS_NOTE,
  RECEIVE_QR_NOTE,
  RESCAN_HINT,
  SENT_LINE,
  SENT_TITLE,
  SETUP_LEDE,
} from "../src/ui/text";
import { fake, n } from "./fakes";
import {
  buttonNamed,
  find,
  mountAt,
  rememberSaved,
  settle,
  showAt,
  showPhoneTx,
  type,
  useScreenHarness,
} from "./harness";

useScreenHarness();

const PAYEE = "tb1p5n82a6xmp47yhkkc007dxstutv23cce37xqg0n2ugwsmfnu98h2szr4k32";
const sent = fake.sentTx(PAYEE, 3);
const SENT = sent.txid;

const texts = (root: ParentNode, selector: string): (string | null)[] =>
  [...root.querySelectorAll(selector)].map((e) => e.textContent);

describe("ids and addresses (7.3)", () => {
  // A payee is checked where an output is described; shortened, two addresses
  // can share both ends.
  it("lists every output of a transaction whole on the phone", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    fake.state.details[SENT] = sent;
    const screen = await showPhoneTx(SENT);

    expect(texts(screen, ".m-io-addr")).toEqual([PAYEE, fake.ADDRESS]);
    expect(texts(screen, ".m-io-note")).toEqual(["change, back to this wallet"]);
  });

  // In the desktop detail's word, "Received".
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
    const screen = await showPhoneTx(RECEIVED);

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
    const screen = await showAt("dashboard", renderDashboard);

    const cell = [...screen.querySelectorAll<HTMLElement>("td")].find(
      (td) => td.title === fake.ADDRESS,
    );
    expect(cell?.textContent).toBe(shortId(fake.ADDRESS));
  });

  it("shortens the saved wallet's address the same way on both Unlock screens", async () => {
    rememberSaved();

    const desktop = mountAt("unlock", renderUnlock);
    const shown = texts(desktop, ".mono");
    const phone = mountAt("unlock", renderPhoneUnlock);

    expect(shown).toContain(shortId(fake.ADDRESS));
    expect(texts(phone, ".m-address")).toEqual([shortId(fake.ADDRESS)]);
  });
});

describe("amounts and rates (7.4)", () => {
  // Below the relay minimum the core builds at 1 sat/vB anyway.
  it("names the rate the phone's Send will pay, never one under the floor", async () => {
    fake.state.estimate = { "6": 0.1 };
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const screen = await showAt("send", renderPhoneSend);

    expect(texts(screen, ".m-txmeta")).toContain("1.0 sat/vB");
  });

  it("shows no desktop balance until one is read", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const screen = mountAt("dashboard", renderDashboard);

    expect(find(screen, ".stat-hero").textContent).toBe("—");
    expect(texts(screen, ".stat-value")).toEqual(["—", "—"]);
    await settle();
    expect(find(screen, ".stat-hero").textContent).not.toBe("—");
  });

  // Not the wallet's address: for a recovery phrase that is only the next receiving address.
  it("heads the desktop's Send with the network and server, as its other screens", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const screen = mountAt("send", renderSend);
    expect(find(screen, ".screen-head .muted").textContent).not.toContain(fake.ADDRESS);
    expect(find(screen, ".screen-head .muted").textContent).toContain(" · ");
  });

  it("says an estimate with no rate is unavailable, alike on both Send screens", async () => {
    fake.state.estimate = {};
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const desktop = await showAt("send", renderSend);
    expect(find(desktop, ".fee-source").textContent).toBe(
      "Estimate unavailable — enter a rate · floor 1.0 sat/vB",
    );

    const phone = await showAt("send", renderPhoneSend);
    expect(texts(phone, ".m-txmeta")).toContain("Estimate unavailable — starting at 1.0 sat/vB");
  });

  // A rate under the floor is paid, and named, at the floor.
  it("builds and names a typed rate rounded up to a tenth on the desktop's Send", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    for (const [typed, paid] of [
      ["0.5", 1],
      ["7.55", 7.6],
    ] as const) {
      const screen = await showAt("send", renderSend);
      type(find<HTMLInputElement>(screen, "#recipient-address-0"), fake.ADDRESS);
      type(find<HTMLInputElement>(screen, 'input[placeholder="0"]'), "1000");
      type(find<HTMLInputElement>(screen, "#send-fee-rate"), typed);
      fake.calls.length = 0;
      buttonNamed(screen, "Review").click();
      await settle();

      expect(fake.calls.find((c) => c[0] === "build_transfer")?.[2]).toBe(paid);
      expect(find(screen, ".review-card").textContent).toContain(`${paid.toFixed(1)}\u00a0sat/vB`);
    }
  });

  it("builds and names a typed Custom rate rounded up to a tenth on the phone's Send", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const screen = await showAt("send", renderPhoneSend);
    type(find<HTMLInputElement>(screen, "input[name=address]"), fake.ADDRESS);
    type(find<HTMLInputElement>(screen, "input[name=amount]"), "1000");
    buttonNamed(screen, "Custom").click();
    await settle();
    type(find<HTMLInputElement>(screen, "input[name=rate]"), "7.55");
    await settle();
    fake.calls.length = 0;
    buttonNamed(screen, "Review").click();
    await settle();

    expect(fake.calls.find((c) => c[0] === "build_transfer")?.[2]).toBe(7.6);
    expect(screen.textContent).toContain("7.6\u00a0sat/vB");
  });

  // Review waits for a valid amount, so the banner, which names no unit, is
  // only a fallback: the field says why.
  it("says why an amount is not valid in the unit it is typed in", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const screen = await showAt("send", renderSend);
    type(find<HTMLInputElement>(screen, "#recipient-address-0"), fake.ADDRESS);
    find<HTMLInputElement>(screen, "input[type=radio][value=btc]").click();
    const amount = find<HTMLInputElement>(screen, 'input[placeholder="0"]');
    type(amount, "0.000000001");
    amount.dispatchEvent(new Event("blur"));

    expect(buttonNamed(screen, "Review").disabled).toBe(true);
    expect(screen.textContent).toContain("BTC has 8 decimals at most");
    expect(screen.textContent).not.toContain("whole number of sat");
  });

  it("writes the phone's history amounts with their unit", async () => {
    fake.state.transactions = [fake.summaryOf(sent)];
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const screen = await showAt("dashboard", renderPhoneWallet);

    expect(texts(screen, ".m-amt")).toEqual([`−${n(40_153)} sat`]);
  });
});

describe("pending, confirmations and time (7.5)", () => {
  const pending = fake.summaryOf({ ...sent, confirmations: null, timestamp: null });

  it("says Pending on both shells, the desktop's in the pending colour", async () => {
    fake.state.transactions = [pending];
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const desktop = await showAt("dashboard", renderDashboard);
    const cell = [...desktop.querySelectorAll<HTMLElement>("td")].find(
      (td) => td.textContent === "Pending",
    );
    expect(cell?.classList.contains("pending")).toBe(true);

    const phone = await showAt("dashboard", renderPhoneWallet);
    expect(texts(phone, ".m-txmeta .m-pending")).toEqual(["Pending"]);
  });

  it("says Pending in the phone's detail, never a count of 0", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    fake.state.details[SENT] = { ...sent, confirmations: null, block_height: null };
    const screen = await showPhoneTx(SENT);

    const row = [...screen.querySelectorAll(".m-item")].find(
      (i) => i.firstElementChild?.textContent === "Confirmations",
    );
    expect(row?.querySelector(".m-item-value")?.textContent).toBe("Pending");
  });

  it("says when it last synced the same way on both shells", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const at14 = new Date(2026, 8, 30, 14, 32, 7);
    session.lastSyncedAt = at14;
    const desktop = mountAt("dashboard", renderDashboard);
    const phone = mountAt("dashboard", renderPhoneWallet);
    const said = `Synced ${formatTime(at14)}`;

    expect(desktop.textContent).toContain(said);
    expect(phone.textContent).toContain(said);
  });
});

describe("one word for each action (7.6)", () => {
  it("offers the same way out and the same Forget on both Unlock screens", () => {
    rememberSaved();

    for (const render of [renderUnlock, renderPhoneUnlock]) {
      const screen = mountAt("unlock", render);
      expect(buttonNamed(screen, "Use a different wallet")).toBeTruthy();
      buttonNamed(screen, "Forget this wallet").click();
      expect(screen.textContent).toContain(forgetWarning(null));
      // Read out with the button, which alone says only "Delete it".
      const yes = buttonNamed(screen, "Delete it");
      const described = document.getElementById(yes.getAttribute("aria-describedby") ?? "");
      expect(described?.textContent).toBe(forgetWarning(null));
      buttonNamed(screen, "Keep it").click();
      expect(document.activeElement).toBe(buttonNamed(screen, "Forget this wallet"));
      buttonNamed(screen, "Forget this wallet").click();
      expect(buttonNamed(screen, "Keep it")).toBeTruthy();
    }
  });

  it("says every banner as a sentence", () => {
    const alert = banner();
    alert.show("error", "this transaction is not in the wallet's history");
    expect(alert.node.textContent).toBe("This transaction is not in the wallet's history.");
  });

  it("says the same on both Sent screens", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);

    for (const render of [renderResult, renderPhoneResult]) {
      session.lastResult = { txid: SENT, persist_error: null, explorer_url: null };
      const screen = mountAt("result", render);
      expect(screen.textContent).toContain(SENT_TITLE);
      expect(screen.textContent).toContain(SENT_LINE);
      expect(buttonNamed(screen, "Copy transaction id")).toBeTruthy();
    }
  });
});

describe("one name for each thing (7.7)", () => {
  it("says what freezing does, and that there are no coins, alike on both shells", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const desktop = await showAt("dashboard", renderDashboard);
    const desktopText = desktop.textContent;
    const phone = await showAt("coins", renderCoins);

    for (const text of [desktopText, phone.textContent]) {
      expect(text).toContain(FROZEN_HINT);
      expect(text).toContain(NO_COINS);
    }
  });

  // The core says "(word 3)" for the fourth word; the screen names it by its place.
  it("names an unknown word by its place on the phone's Restore too", async () => {
    setRestoreMode("phrase");
    const screen = mountAt("restore", renderPhoneRestore);
    const cells = [...screen.querySelectorAll<HTMLInputElement>('input[aria-label^="Word "]')];
    cells.forEach((cell, i) => {
      cell.value = i === 3 ? "xyz" : "abandon";
    });
    vi.spyOn(api, "validateMnemonic").mockRejectedValueOnce(
      new WalletError(
        "invalid_key",
        "invalid key material: invalid mnemonic: mnemonic contains an unknown word (word 3)",
      ),
    );

    buttonNamed(screen, "Restore wallet").click();
    await settle();

    expect(find(screen, ".banner").textContent).toBe('Word 4 "xyz" is not in the word list.');
  });

  it("says what public keys give away, and copies them, alike on both shells", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const desktop = mountAt("settings", renderSettings);
    buttonNamed(desktop, "Export public keys").click();
    await settle();
    expect(desktop.textContent).toContain(PUBLIC_KEYS_NOTE);
    expect(buttonNamed(desktop, "Copy descriptor")).toBeTruthy();

    const phone = await showAt("export", renderExport);
    expect(phone.textContent).toContain(PUBLIC_KEYS_NOTE);
    expect(buttonNamed(phone, "Copy descriptor")).toBeTruthy();
  });

  it("says what Receive's QR holds alike on both shells", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const desktop = await showAt("dashboard", renderDashboard);
    expect(desktop.textContent).toContain(RECEIVE_QR_NOTE);
    const phone = await showAt("receive", renderPhoneReceive);
    expect(phone.textContent).toContain(RECEIVE_QR_NOTE);
  });

  it("says what Setup chooses alike on both shells", () => {
    for (const render of [renderSetup, renderPhoneSetup]) {
      expect(mountAt("setup", render).textContent).toContain(SETUP_LEDE);
    }
  });

  // A blank before an unknown word would shift the number the core gives it.
  it("asks for every word on the phone's Restore before it checks one", async () => {
    setRestoreMode("phrase");
    const screen = mountAt("restore", renderPhoneRestore);
    const cells = [...screen.querySelectorAll<HTMLInputElement>('input[aria-label^="Word "]')];
    cells.forEach((cell, i) => {
      cell.value = i === 1 ? "" : i === 3 ? "xyz" : "abandon";
    });
    const validate = vi.spyOn(api, "validateMnemonic");

    buttonNamed(screen, "Restore wallet").click();
    await settle();

    expect(validate).not.toHaveBeenCalled();
    expect(find(screen, ".banner").textContent).toBe("Fill in the missing words to continue.");
  });

  it("says what Rescan is for alike in both Settings", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    for (const render of [renderSettings, renderPhoneSettings]) {
      expect(mountAt("settings", render).textContent).toContain(RESCAN_HINT);
    }
  });

  it("warns about the passphrase in the same words wherever one is set", async () => {
    for (const render of [renderCreate, renderPhoneCreate]) {
      const screen = await showAt("create", render);
      expect(screen.textContent).toContain(PASSPHRASE_HINT);
    }
    setRestoreMode("phrase");
    for (const render of [renderRestore, renderPhoneRestore]) {
      expect(mountAt("restore", render).textContent).toContain(PASSPHRASE_HINT);
    }
  });
});
