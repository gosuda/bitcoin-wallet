import { navigate } from "../router";
import { session } from "../session";
import type { PsbtReview } from "../types";
import { banner, button, el, formatNumber, sectionLabel, withBusy } from "../ui/dom";
import { formatRate, formatVsize, outputRole, shortOutpoint } from "../ui/format";
import { feeRate, psbtFlow, signedLine } from "../ui/psbt";
import { whoseInputs } from "../ui/text";

/** Beside Sign and Broadcast until the PSBT can go out, as 7 says it. */
const WAITS = "Broadcast waits until every input is signed and the PSBT is finalized.";

type Cell = Node | string;

/** One row of 7's table: what it is, where, whose, and its value in sat. */
function ioRow(what: string, where: Cell, whose: Cell, value: string): HTMLTableRowElement {
  return el("tr", {}, [
    el("td", { className: "psbt-what", text: what }),
    el("td", { className: "mono psbt-where" }, [where]),
    el("td", { className: "psbt-whose" }, [whose]),
    el("td", { className: "num mono", text: value }),
  ]);
}

function counted(count: number, word: string): string {
  return `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * "What it spends and pays", as 7 draws it: each input, whose it is and
 * whether it is signed, each output and where it goes, then the fee. An
 * output's address is shown whole, since this is where a payment is checked
 * before it is signed.
 */
function reviewCard(r: PsbtReview): HTMLElement {
  const inputs = r.inputs.map((input, i) =>
    ioRow(
      `Input ${i + 1}`,
      shortOutpoint(input),
      el("span", {}, [
        input.ours ? "This wallet · " : "Another wallet · ",
        input.finalized
          ? el("span", { className: "ok", text: "signed" })
          : el("span", { className: "psbt-unsigned", text: "not signed" }),
      ]),
      input.value_sat === null ? "unknown" : formatNumber(input.value_sat),
    ),
  );
  const outputs = r.outputs.map((output, i) => {
    const role = outputRole(r, output);
    return ioRow(
      `Output ${i + 1}`,
      output.address ?? "script",
      role === "recipient"
        ? "Recipient"
        : role === "change"
          ? el("span", {}, [
              "Change ",
              el("span", { className: "hint", text: "· back to this wallet" }),
            ])
          : "This wallet",
      formatNumber(output.value_sat),
    );
  });
  const rate = feeRate(r);
  const why =
    r.fee_sat === null
      ? "Not every input's value is known."
      : rate === null
        ? "The rate is known once every input is signed."
        : "";
  const fee = ioRow(
    "Fee",
    rate === null || r.vsize === null ? "" : `${formatRate(rate)} · ${formatVsize(r.vsize)}`,
    why ? el("span", { className: "hint", text: why }) : "",
    r.fee_sat === null ? "unknown" : formatNumber(r.fee_sat),
  );
  return el("section", { className: "card" }, [
    el("div", { className: "card-head" }, [
      sectionLabel("What it spends and pays"),
      el("span", {
        className: "hint",
        text: `${counted(r.inputs.length, "input")}, ${whoseInputs(r.inputs)} · ${counted(r.outputs.length, "output")}`,
      }),
    ]),
    el("div", { className: "table-wrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { className: "psbt-what" }),
            el("th", { text: "Outpoint or address" }),
            el("th"),
            el("th", { className: "num", text: "Value (sat)" }),
          ]),
        ]),
        el("tbody", {}, [...inputs, ...outputs, fee]),
      ]),
    ]),
  ]);
}

/**
 * 7 · Import PSBT, from the PSBT card in Settings: paste it or load a file,
 * and it is described as soon as it parses. Sign signs the inputs this wallet
 * holds keys for and is not offered to a watch-only wallet; Broadcast stays
 * off until every input is final, then goes where Send goes.
 */
export function renderPsbt(): HTMLElement {
  const wallet = session.wallet;
  if (!wallet) {
    navigate("setup");
    return el("main");
  }
  const alert = banner();

  const field = el("textarea", {
    className: "mono psbt-field",
    attrs: {
      id: "psbt-field",
      name: "psbt",
      rows: "5",
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
      "aria-describedby": "psbt-hint psbt-error",
    },
  });
  const error = el("p", { className: "field-error", attrs: { id: "psbt-error", role: "status" } });
  const described = el("div", { className: "slot" });

  const dot = el("span", { className: "psbt-dot" });
  const signedText = el("span");
  const status = el("p", { className: "psbt-status", attrs: { role: "status" } }, [
    dot,
    signedText,
  ]);
  const waits = el("span", { className: "hint", text: WAITS });

  const paint = (r: PsbtReview | null): void => {
    const final = r?.finalized === true;
    status.hidden = r === null;
    signedText.textContent = r === null ? "" : signedLine(r);
    dot.classList.toggle("psbt-dot-done", final);
    waits.hidden = final;
    signBtn.disabled = r === null || final;
    sendBtn.disabled = !final;
    // The accent sits on whichever of the two is next.
    signBtn.classList.toggle("btn-primary", !final);
    sendBtn.classList.toggle("btn-primary", final);
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

  /** Signing that made it final hands the keyboard on to Broadcast. */
  const afterSign = (): void => {
    const r = flow.review();
    paint(r);
    const focus = document.activeElement;
    if (r?.finalized && (focus === signBtn || focus === document.body)) sendBtn.focus();
  };
  const signBtn = button(
    "Sign",
    () => void withBusy(signBtn, flow.sign).finally(afterSign),
    "primary",
    "md",
    { name: "key" },
  );
  const sendBtn = button(
    "Broadcast",
    () => void withBusy(sendBtn, flow.broadcast).finally(() => paint(flow.review())),
  );

  // Load file… opens the picker of a file input kept out of sight; the button
  // is what 7 draws, and what the keyboard reaches.
  const picker = el("input", { attrs: { type: "file", hidden: "" } });
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    // Cleared, so that choosing the same file again is a change as well.
    picker.value = "";
    if (file) void flow.load(file);
  });

  paint(null);
  return el("main", { className: "screen" }, [
    el("div", { className: "screen-head" }, [
      el("h1", { text: "Import PSBT" }),
      el("p", {
        className: "muted small",
        text: "Sign or send a transaction made in another wallet",
      }),
    ]),
    alert.node,
    el("section", { className: "card" }, [
      el("div", { className: "card-head" }, [
        el("label", { className: "section-label", text: "PSBT", attrs: { for: field.id } }),
        el("span", {
          className: "hint",
          text: "Base64. Described as soon as it parses.",
          attrs: { id: "psbt-hint" },
        }),
      ]),
      field,
      error,
      el("div", { className: "actions" }, [
        button("Paste", () => void flow.paste(), "default", "sm", { name: "clipboard" }),
        button("Load file…", () => picker.click(), "default", "sm"),
        picker,
      ]),
    ]),
    described,
    el("div", { className: "psbt-foot" }, [
      status,
      el("div", { className: "actions" }, [waits, wallet.is_watch_only ? null : signBtn, sendBtn]),
    ]),
  ]);
}
