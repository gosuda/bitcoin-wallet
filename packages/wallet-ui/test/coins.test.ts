/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { api } from "../src/api";
import { renderCoins } from "../src/mobile/screens/coins";
import { renderSend as renderPhoneSend } from "../src/mobile/screens/send";
import { renderSettings as renderPhoneSettings } from "../src/mobile/screens/settings";
import { renderDashboard } from "../src/screens/dashboard";
import { renderSend } from "../src/screens/send";
import { session } from "../src/session";
import type { Utxo } from "../src/types";
import { fake } from "./fakes";
import { buttonNamed, find, leaveTo, settle, showAt, type, useScreenHarness } from "./harness";

useScreenHarness();

const txid = (head: string, tail: string): string => `${head}${"0".repeat(46)}${tail}`;

/** The three coins 3b and M13 are drawn with: one frozen, and 45,000 + 16,234 = 61,234 to choose. */
const BIG: Utxo = {
  txid: txid("a41e9c2f7b", "3d08e1f2"),
  vout: 0,
  value: 250_000,
  confirmations: 142,
  address: fake.ADDRESS,
  frozen: true,
};
const MID: Utxo = {
  txid: txid("7d61959580", "b9855325"),
  vout: 1,
  value: 45_000,
  confirmations: 31,
  address: fake.ADDRESS,
  frozen: false,
};
const NEW: Utxo = {
  txid: txid("91cc1ff210", "c4e6e1d8"),
  vout: 0,
  value: 16_234,
  confirmations: null,
  address: fake.ADDRESS,
  frozen: false,
};

const RECIPIENT = "tb1qmdpena9w6e2h49wxe0tglyrezzgcgs37us67w0";
const PAY = [{ address: RECIPIENT, amount_sat: 50_000 }];

/** Copies, since freezing one changes it in the fake. Listed largest first, as the core lists them. */
function threeCoins(): void {
  fake.state.utxos = [BIG, MID, NEW].map((u) => ({ ...u }));
}

/** How the core is told which coin: its txid and output index, nothing else. */
const id = (u: Utxo) => ({ txid: u.txid, vout: u.vout });

const n = (sats: number): string => sats.toLocaleString();

function nth<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new Error(`nothing at ${i}`);
  return item;
}

const texts = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((e) => e.textContent);
const ticks = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
];
const switches = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLButtonElement>("button[role=switch]"),
];
const sendSelectedButtons = (root: ParentNode) =>
  [...root.querySelectorAll("button")].filter((b) => b.textContent?.startsWith("Send selected"));

/** The desktop card's head: "3 coins · 1 frozen · …". */
const head = (screen: HTMLElement): string =>
  find(screen, ".card-head-end .hint").textContent ?? "";

interface Shell {
  shell: string;
  /** Opens the wallet on the screen that lists its coins. */
  list(): Promise<HTMLElement>;
  /** Where a coin's control sits, and the class that dims it once frozen. */
  row(control: Element): Element | null;
  dimmed: string;
  /** What says which coins are ticked while Send selected is offered; null while it is not. */
  selection(screen: HTMLElement): string | null;
  /** That, with MID and NEW ticked. */
  twoTicked: string;
  /** Builds Send, as the route Send selected goes to would. */
  send(): Promise<HTMLElement>;
  /** A lone recipient's fields on that Send. */
  fields(screen: HTMLElement): { address: HTMLInputElement; amount: HTMLInputElement };
}

const DESKTOP: Shell = {
  shell: "desktop",
  async list() {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    return showAt("dashboard", renderDashboard);
  },
  row: (control) => control.closest("tr"),
  dimmed: "coin-frozen",
  selection: (screen) => (buttonNamed(screen, "Send selected").hidden ? null : head(screen)),
  twoTicked: `3 coins · 1 frozen · 2 selected, ${n(61_234)} sat`,
  send: () => showAt("send", renderSend),
  fields: (screen) => ({
    address: find<HTMLInputElement>(screen, "#recipient-address-0"),
    amount: find<HTMLInputElement>(screen, "#recipient-amount-0"),
  }),
};

const PHONE: Shell = {
  shell: "phone",
  async list() {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    return showAt("coins", renderCoins);
  },
  row: (control) => control.closest(".m-coin"),
  dimmed: "m-coin-frozen",
  selection(screen) {
    const send = nth(sendSelectedButtons(screen), 0);
    return send.hidden ? null : (send.textContent ?? "");
  },
  twoTicked: `Send selected (2 coins · ${n(61_234)} sat)`,
  send: () => showAt("send", renderPhoneSend),
  fields: (screen) => ({
    address: find<HTMLInputElement>(screen, "input[name=address]"),
    amount: find<HTMLInputElement>(screen, "input[name=amount]"),
  }),
};

/** Ticks MID and NEW, presses Send selected, and opens the Send it leads to. */
async function sendFromTicked(shell: Shell): Promise<HTMLElement> {
  const screen = await shell.list();
  nth(ticks(screen), 1).click();
  nth(ticks(screen), 2).click();
  nth(sendSelectedButtons(screen), 0).click();
  expect(window.location.hash).toBe("#/send");
  expect(session.chosenCoins).toEqual([MID, NEW]);
  // The route change lands before Send is built, as it does in the shell.
  await settle();
  return shell.send();
}

describe.each([DESKTOP, PHONE])("coin control on the $shell (6.13)", (shell) => {
  it("freezing calls the core, dims the coin and takes its tick away; unfreezing gives both back", async () => {
    threeCoins();
    const screen = await shell.list();
    nth(ticks(screen), 1).click();
    expect(shell.selection(screen)).not.toBeNull();

    nth(switches(screen), 1).click();
    await settle();

    expect(fake.calls).toContainEqual(["set_frozen", id(MID), true]);
    const frozen = nth(switches(screen), 1);
    expect(frozen.getAttribute("aria-checked")).toBe("true");
    expect(shell.row(frozen)?.classList.contains(shell.dimmed)).toBe(true);
    expect(nth(ticks(screen), 1).disabled).toBe(true);
    expect(nth(ticks(screen), 1).checked).toBe(false);
    // It was the one coin ticked, and a frozen coin cannot be sent from.
    expect(shell.selection(screen)).toBeNull();

    frozen.click();
    await settle();

    expect(fake.calls).toContainEqual(["set_frozen", id(MID), false]);
    const thawed = nth(switches(screen), 1);
    expect(thawed.getAttribute("aria-checked")).toBe("false");
    expect(shell.row(thawed)?.classList.contains(shell.dimmed)).toBe(false);
    expect(nth(ticks(screen), 1).disabled).toBe(false);
  });

  it("offers Send selected with the count and sum of the ticked coins, and hides it with none", async () => {
    threeCoins();
    const screen = await shell.list();
    expect(shell.selection(screen)).toBeNull();
    // BIG is frozen.
    expect(ticks(screen).map((t) => t.disabled)).toEqual([true, false, false]);

    nth(ticks(screen), 1).click();
    nth(ticks(screen), 2).click();
    expect(shell.selection(screen)).toBe(shell.twoTicked);

    nth(ticks(screen), 1).click();
    nth(ticks(screen), 2).click();
    expect(shell.selection(screen)).toBeNull();
  });

  it("Send selected opens Send held to exactly the ticked coins", async () => {
    threeCoins();
    const send = await sendFromTicked(shell);
    expect(session.chosenCoins).toBeNull();
    expect(send.textContent).toContain(`Paying from 2 chosen coins · ${n(61_234)} sat`);

    const { address, amount } = shell.fields(send);
    type(address, RECIPIENT);
    type(amount, "50000");
    buttonNamed(send, "Review").click();
    await settle();

    expect(fake.calls).toContainEqual(["build_transfer_from", [id(MID), id(NEW)], PAY, 2]);
    expect(fake.callNames()).not.toContain("build_transfer");
  });

  it("Max with chosen coins empties exactly those", async () => {
    threeCoins();
    const send = await sendFromTicked(shell);
    type(shell.fields(send).address, RECIPIENT);

    buttonNamed(send, "Max").click();
    await settle();

    expect(fake.calls).toContainEqual(["build_drain_from", [id(MID), id(NEW)], RECIPIENT, 2]);
    expect(fake.callNames()).not.toContain("build_drain");
    expect(shell.fields(send).amount.value).toBe("49859");
  });

  it("Let the wallet choose hands the choice back: the line goes, and Max and Review name no coins", async () => {
    threeCoins();
    const send = await sendFromTicked(shell);

    buttonNamed(send, "Let the wallet choose").click();
    expect(send.textContent).not.toContain("Paying from");

    const { address, amount } = shell.fields(send);
    type(address, RECIPIENT);
    buttonNamed(send, "Max").click();
    await settle();
    type(amount, "50000");
    buttonNamed(send, "Review").click();
    await settle();

    expect(fake.calls).toContainEqual(["build_drain", RECIPIENT, 2]);
    expect(fake.calls).toContainEqual(["build_transfer", PAY, 2]);
    expect(fake.callNames().filter((name) => name.endsWith("_from"))).toEqual([]);
  });

  it("holds only the Send that opens next: left without sending, the wallet chooses again", async () => {
    threeCoins();
    await sendFromTicked(shell);
    leaveTo("dashboard");

    const again = await shell.send();
    expect(again.textContent).not.toContain("Paying from");
    const { address, amount } = shell.fields(again);
    type(address, RECIPIENT);
    type(amount, "50000");
    buttonNamed(again, "Review").click();
    await settle();

    expect(fake.calls).toContainEqual(["build_transfer", PAY, 2]);
    expect(fake.callNames()).not.toContain("build_transfer_from");
  });

  it("a watch-only wallet can freeze its coins, but has none to tick or send", async () => {
    fake.state.watchOnly = true;
    threeCoins();
    const screen = await shell.list();

    expect(switches(screen)).toHaveLength(3);
    expect(ticks(screen)).toHaveLength(0);
    expect(sendSelectedButtons(screen)).toHaveLength(0);
  });

  it("keeps keyboard focus on a coin's switch through the redraw its freeze makes", async () => {
    threeCoins();
    const screen = await shell.list();
    const pressed = nth(switches(screen), 2);
    pressed.focus();

    pressed.click();
    await settle();

    const redrawn = nth(switches(screen), 2);
    expect(redrawn).not.toBe(pressed);
    expect(redrawn.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(redrawn);
  });
});

describe("the Unspent outputs card on the desktop (3b)", () => {
  it("lists every coin with a tick and a switch, counts the frozen, and says what they stay out of", async () => {
    threeCoins();
    const screen = await DESKTOP.list();

    expect(head(screen)).toBe("3 coins · 1 frozen");
    expect(switches(screen).map((s) => s.getAttribute("aria-label"))).toEqual([
      "Freeze a41e9c2f7b…3d08e1f2:0",
      "Freeze 7d61959580…b9855325:1",
      "Freeze 91cc1ff210…c4e6e1d8:0",
    ]);
    expect(ticks(screen).map((t) => t.getAttribute("aria-label"))).toEqual([
      `Choose a41e9c2f7b…3d08e1f2:0, ${n(250_000)} sat`,
      `Choose 7d61959580…b9855325:1, ${n(45_000)} sat`,
      `Choose 91cc1ff210…c4e6e1d8:0, ${n(16_234)} sat`,
    ]);
    expect(switches(screen).map((s) => s.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(nth(switches(screen), 0).closest("td")?.textContent).toBe("Frozen");
    expect(screen.textContent).toContain(
      "A frozen coin stays out of every send, Max included, and out of the spendable balance until you unfreeze it.",
    );
  });

  it("the Balance card shows a Frozen stat only while something is frozen", async () => {
    const labels = (screen: HTMLElement) => texts(screen, ".stat-label");
    expect(labels(await DESKTOP.list())).toEqual(["Confirmed", "Pending"]);

    fake.state.balance = { ...fake.state.balance, frozen: 250_000 };
    const screen = await DESKTOP.list();
    expect(labels(screen)).toEqual(["Confirmed", "Pending", "Frozen"]);
    expect(texts(screen, ".stat-value").at(-1)).toBe(`${n(250_000)} sat`);
  });
});

describe("Coins on the phone (M13)", () => {
  it("lists every coin with its value, confirmations and outpoint, and a frozen one with a lock", async () => {
    threeCoins();
    const screen = await PHONE.list();

    expect(texts(screen, ".m-coins-head .section-label")).toEqual([
      `3 coins · ${n(311_234)} sat`,
      "Frozen",
    ]);
    expect(texts(screen, ".m-coin-value")).toEqual([
      `${n(250_000)} sat`,
      `${n(45_000)} sat`,
      `${n(16_234)} sat`,
    ]);
    expect(texts(screen, ".m-coin-age, .m-coin .m-pending")).toEqual([
      "142 conf.",
      "31 conf.",
      "Pending",
    ]);
    expect(texts(screen, ".m-coin-outpoint")).toEqual([
      "a41e9c2f7b…3d08e1f2:0",
      "7d61959580…b9855325:1",
      "91cc1ff210…c4e6e1d8:0",
    ]);
    const frozen = nth([...screen.querySelectorAll(".m-coin")], 0);
    expect(frozen.querySelector(".m-coin-lock")).not.toBeNull();
    expect(frozen.querySelector(".tick-box")).toBeNull();
    expect(frozen.querySelector(".m-coin-tag")?.textContent).toBe("Frozen");
  });

  it("Settings says how many coins there are and how many are frozen, and its row opens Coins", async () => {
    threeCoins();
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    const screen = await showAt("settings", renderPhoneSettings);

    const rows = [...screen.querySelectorAll<HTMLElement>(".m-item")];
    const names = rows.map((r) => r.firstElementChild?.textContent);
    const coins = nth(rows, names.indexOf("Coins"));
    // Where M10b draws it: after Export public keys.
    expect(names.indexOf("Coins")).toBe(names.indexOf("Export public keys") + 1);
    expect(coins.querySelector(".m-item-value")?.textContent).toBe("3 · 1 frozen");

    coins.click();
    expect(window.location.hash).toBe("#/coins");
  });
});

describe("the coins Send selected hands over", () => {
  it("are dropped with the wallet they belong to", async () => {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    session.chosenCoins = [MID];

    await api.closeWallet();

    expect(session.chosenCoins).toBeNull();
  });
});
