/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { api } from "../src/api";
import { listen } from "../src/app";
import { renderSend } from "../src/mobile/screens/send";
import { openSendWithPayment, takeSendPrefill } from "../src/mobile/send-prefill";
import { session } from "../src/session";
import { fake } from "./fakes";
import { find, settle, showAt, useScreenHarness } from "./harness";

useScreenHarness();

const PAYMENT = { address: fake.ADDRESS, amountSat: 18_000 };

const address = (screen: HTMLElement): string =>
  find<HTMLInputElement>(screen, "input[name=address]").value;

const amount = (screen: HTMLElement): string =>
  find<HTMLInputElement>(screen, "input[name=amount]").value;

describe("one-shot Send payment intents", () => {
  it("does not queue a request with no open wallet", async () => {
    expect(openSendWithPayment(PAYMENT)).toBe(false);
    await api.openWallet(fake.PHRASE, "p2wpkh", false);
    expect(address(await showAt("send", renderSend))).toBe("");
  });

  it("rejects watch-only requests instead of passing them to a later spendable wallet", async () => {
    fake.state.watchOnly = true;
    await api.openWallet(fake.PHRASE, "p2wpkh", false);
    expect(openSendWithPayment(PAYMENT)).toBe(false);
    await api.closeWallet();

    fake.state.watchOnly = false;
    await api.openWallet(fake.PHRASE, "p2wpkh", false);
    expect(address(await showAt("send", renderSend))).toBe("");
  });

  it("binds a payment to one wallet opening, even when the same wallet is reopened", async () => {
    await api.openWallet(fake.PHRASE, "p2wpkh", false);
    expect(openSendWithPayment(PAYMENT)).toBe(true);
    await api.openWallet(fake.PHRASE, "p2wpkh", false);

    expect(address(await showAt("send", renderSend))).toBe("");
  });

  it("consumes an accepted payment once, with its amount", async () => {
    await api.openWallet(fake.PHRASE, "p2wpkh", false);
    expect(openSendWithPayment(PAYMENT)).toBe(true);

    const first = await showAt("send", renderSend);
    expect(address(first)).toBe(PAYMENT.address);
    expect(amount(first)).toBe("18000");
    expect(address(await showAt("send", renderSend))).toBe("");
  });

  it("clears a pending payment when the Send route is rejected", async () => {
    await api.openWallet(fake.PHRASE, "p2wpkh", false);
    const root = document.createElement("div");
    root.id = "app";
    document.body.append(root);
    window.history.replaceState(null, "", "#/dashboard");
    listen("phone", (node, route) => {
      node.textContent = route;
    });

    expect(openSendWithPayment(PAYMENT)).toBe(true);
    const wallet = session.wallet;
    if (!wallet) throw new Error("wallet unexpectedly closed");
    session.wallet = { ...wallet, is_watch_only: true };
    await settle();

    expect(window.location.hash).toBe("#/dashboard");
    session.wallet = wallet;
    expect(takeSendPrefill()).toBeNull();
  });
});
