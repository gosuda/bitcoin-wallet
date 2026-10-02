import { redirect, screenGuard } from "../../screen";
import { session } from "../../session";
import type { PsbtInput, PsbtReview } from "../../types";
import { banner, el, formatNumber, sectionLabel } from "../../ui/dom";
import { feeLine, formatSats, shortOutpoint } from "../../ui/format";
import { feeRate, psbtFlow, signedLine } from "../../ui/psbt";
import { whoseInputs } from "../../ui/text";
import {
  body,
  button,
  card,
  header,
  ioLine,
  labelled,
  outputNote,
  row,
  scanInPlace,
  spacer,
  withBusy,
} from "../ui";

/**
 * Said under an input only where it is not what M14 draws, this wallet's and
 * not signed yet; the count above the list and the line under it say the rest.
 */
function inputNote(input: PsbtInput): string | null {
  const notes = [input.ours ? null : "another wallet's", input.finalized ? "signed" : null];
  const said = notes.filter((n) => n !== null);
  return said.length === 0 ? null : said.join(" · ");
}

function feeText(r: PsbtReview): string {
  return r.fee_sat === null ? "unknown" : feeLine(r.fee_sat, r.vsize, feeRate(r));
}

/** The card M14 draws under the PSBT: its inputs, its outputs, then the fee. */
function reviewCard(r: PsbtReview): HTMLElement {
  const node = card(
    el("div", { className: "m-psbt-head" }, [
      sectionLabel(`Inputs · ${formatNumber(r.inputs.length)}`),
      el("span", { className: "hint", text: whoseInputs(r.inputs) }),
    ]),
    ...r.inputs.map((input) =>
      ioLine(
        shortOutpoint(input),
        input.value_sat === null ? "unknown" : formatSats(input.value_sat),
        inputNote(input),
      ),
    ),
    el("span", {
      className: "section-label m-psbt-outputs",
      text: `Outputs · ${formatNumber(r.outputs.length)}`,
    }),
    ...r.outputs.map((output) =>
      ioLine(output.address ?? "script", formatSats(output.value_sat), outputNote(r, output)),
    ),
    el("div", { className: "m-psbt-fee" }, [
      el("span", { text: "Fee" }),
      el("span", { className: "mono", text: feeText(r) }),
    ]),
  );
  node.classList.add("m-psbt");
  return node;
}

/**
 * M14, from Settings → Import PSBT: paste it, or scan it when it fits one QR
 * code. It is described before anything is signed. Sign signs the inputs this
 * wallet holds keys for; a watch-only wallet has none, and no Sign, but can
 * broadcast a PSBT signed elsewhere once every input is final.
 */
export function renderPsbt(): HTMLElement {
  const info = session.wallet;
  if (!info) return redirect("setup");
  const host = el("main");
  const onScreen = screenGuard();
  const alert = banner();

  const field = el("textarea", {
    className: "m-psbt-field",
    attrs: {
      id: "psbt-field",
      name: "psbt",
      rows: "3",
      spellcheck: "false",
      autocapitalize: "none",
      autocorrect: "off",
      autocomplete: "off",
      "aria-describedby": "psbt-error",
    },
  });
  const error = el("span", { className: "m-err", attrs: { id: "psbt-error", role: "status" } });
  const described = el("div", { className: "slot" });

  const dot = el("span", { className: "psbt-dot" });
  const signedText = el("span");
  const status = el("p", { className: "m-psbt-status", attrs: { role: "status" } }, [
    dot,
    signedText,
  ]);

  const paint = (r: PsbtReview | null): void => {
    const final = r?.finalized === true;
    status.hidden = r === null;
    signedText.textContent = r === null ? "" : signedLine(r);
    dot.classList.toggle("psbt-dot-done", final);
    sign.disabled = r === null || final;
    send.disabled = !final;
    // The accent sits on whichever of the two is next.
    sign.classList.toggle("m-btn-primary", !final);
    send.classList.toggle("m-btn-primary", final);
  };

  const flow = psbtFlow({
    field,
    error,
    alert,
    show(r) {
      described.replaceChildren(...(r === null ? [] : [reviewCard(r)]));
      paint(r);
    },
  });

  const sign = button("Sign", () => void withBusy(sign, flow.sign).finally(afterSign), {
    variant: "primary",
  });
  const send = button(
    "Broadcast",
    () => void withBusy(send, flow.broadcast).finally(() => paint(flow.review())),
  );
  /** Signing that made it final hands the keyboard on to Broadcast. */
  const afterSign = (): void => {
    const r = flow.review();
    paint(r);
    const focus = document.activeElement;
    if (r?.finalized && (focus === sign || focus === document.body)) send.focus();
  };

  // --- scanning -----------------------------------------------------------------
  //
  // In place, as Send scans (`scanInPlace`). One code only; a BC-UR one,
  // animated or not, is refused.
  const scan = scanInPlace(
    host,
    alert,
    onScreen,
    "Point the camera at a PSBT that fits one QR code.",
  );

  const source = card(
    labelled("PSBT", field),
    field,
    error,
    row(
      button("Paste", () => void flow.paste(), { icon: "clipboard" }),
      scan
        ? button("Scan", () => void scan(form, (text) => flow.scanned(text)), { icon: "scan" })
        : null,
    ),
  );
  source.classList.add("m-psbt-source");

  const head = header("Import PSBT", { back: "settings" });
  const form = body(
    alert.node,
    source,
    described,
    status,
    spacer(),
    el("div", { className: "m-psbt-actions" }, [info.is_watch_only ? null : sign, send]),
  );
  host.append(head, form);
  paint(null);
  return host;
}
