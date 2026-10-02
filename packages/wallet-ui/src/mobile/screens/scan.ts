import { parsePaymentUri } from "../../bip21";
import { platform } from "../../platform";
import { navigate } from "../../router";
import { screenGuard } from "../../screen";
import { errorMessage } from "../../types";
import { readClipboard } from "../../ui/clipboard";
import { banner, el } from "../../ui/dom";
import { body, button, header, lede, reticle, seeThroughMark } from "../ui";
import { prefillSend } from "./send";

/**
 * The camera preview is rendered by the OS behind the webview, not by us, so
 * this screen is a reticle over a transparent page plus the two ways a scan can
 * end: a payment we understood, or something we did not.
 *
 * The page is only see-through while the camera runs (`data-scanning` on the
 * root element); the rest of the time this screen is the dark layer drawn for
 * it, in either theme.
 */
export function renderScan(): HTMLElement {
  const onScreen = screenGuard();
  const alert = banner();
  const host = el("main", { className: "m-scanner" });

  // Tapping the Scan tab on Scan renders a new screen before the old one hears
  // it has left, so each screen clears only its own mark.
  const mark = seeThroughMark();

  // The camera offers no way out of its own, so leaving this screen — a tab,
  // or Android's back key — is what stops it.
  const leaving = new AbortController();
  const leave = (): void => {
    leaving.abort();
    mark.clear();
    window.removeEventListener("hashchange", leave);
  };
  window.addEventListener("hashchange", leave);

  const accept = (text: string, from: "scan" | "clipboard"): void => {
    const payment = parsePaymentUri(text);
    if (!payment) {
      alert.show(
        "warn",
        from === "scan"
          ? "That QR code is not a Bitcoin address."
          : "The clipboard does not hold a Bitcoin address.",
      );
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
    if (!scan || scanning || leaving.signal.aborted) return;
    scanning = true;
    mark.set();
    try {
      const text = await scan(leaving.signal);
      if (!onScreen()) return;
      // Null is a cancel, not a failure: say nothing and stay put.
      if (text !== null) accept(text, "scan");
    } catch (e) {
      if (onScreen()) alert.show("error", errorMessage(e));
    } finally {
      scanning = false;
      mark.clear();
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
    const got = await readClipboard();
    if (!onScreen()) return;
    if (!("text" in got)) {
      // A refusal is the user's to change; anything else is this build or
      // browser, and typing the address is the way round it.
      alert.show(
        "warn",
        got.refused
          ? "Clipboard access was refused. Allow it and try again, or type the address."
          : "The clipboard cannot be read here. Type the address instead.",
      );
      return;
    }
    accept(got.text, "clipboard");
  });

  host.appendChild(header("Scan"));
  host.appendChild(
    body(
      alert.node,
      el("div", { className: "m-scan" }, [
        reticle(),
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

  // Opening the camera straight away is what a scan tab is for; the platform
  // asks for permission the first time, so a refusal surfaces as an error
  // rather than a dead screen.
  void runScan();

  return host;
}
