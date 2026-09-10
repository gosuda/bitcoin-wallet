import { parsePaymentUri } from "../../bip21";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { screenGuard } from "../../screen";
import { errorMessage } from "../../types";
import { banner, el } from "../../ui/dom";
import { body, button, header, lede } from "../ui";
import { prefillSend } from "./send";

/**
 * The camera preview is rendered by the OS behind the webview, not by us, so
 * this screen is a reticle over a transparent page plus the two ways a scan can
 * end: a payment we understood, or something we did not.
 */
export function renderScan(): HTMLElement {
  const onScreen = screenGuard();
  const alert = banner();
  const host = el("main");

  const reticle = el("div", { className: "m-reticle" }, [
    el("span"),
    el("span"),
    el("span"),
    el("span"),
  ]);

  const accept = (text: string): void => {
    const payment = parsePaymentUri(text);
    if (!payment) {
      alert.show("warn", "That QR code is not a Bitcoin address.");
      return;
    }
    prefillSend({
      address: payment.address,
      ...(payment.amountSat === undefined ? {} : { amountSat: payment.amountSat }),
    });
    navigate("send");
  };

  const scan = platform().scanQr;

  /**
   * One scan at a time, and only while this screen is still the one showing.
   *
   * The screen opens the camera itself, so pressing the button while that is
   * still pending used to start a second concurrent scan against the same
   * camera. And a scan that resolves after the user has moved on would prefill
   * Send and navigate there, pulling them out of whatever they opened next.
   */
  let scanning = false;
  const runScan = async (): Promise<void> => {
    if (!scan || scanning) return;
    scanning = true;
    try {
      const text = await scan();
      if (!onScreen()) return;
      // Null is a cancel, not a failure: say nothing and stay put.
      if (text !== null) accept(text);
    } catch (e) {
      if (onScreen()) alert.show("error", errorMessage(e));
    } finally {
      scanning = false;
    }
  };

  const start = button(
    "Scan a QR code",
    async () => {
      alert.hide();
      await runScan();
    },
    { variant: "primary", block: true },
  );

  const paste = button("Paste from clipboard", async () => {
    alert.hide();
    try {
      const text = await navigator.clipboard.readText();
      accept(text);
    } catch {
      alert.show("warn", "Nothing readable in the clipboard.");
    }
  });

  host.appendChild(header("Scan"));
  host.appendChild(
    body(
      alert.node,
      el("div", { className: "m-scan" }, [
        reticle,
        lede(
          scan
            ? "Point the camera at an address or a bitcoin: QR code."
            : "This build has no camera access; paste an address instead.",
        ),
      ]),
      scan ? start : null,
      paste,
    ),
  );

  // Opening the camera straight away is what a scan tab is for; the plugin
  // asks for permission the first time, so a refusal surfaces as an error
  // rather than a dead screen.
  void runScan();

  return host;
}
