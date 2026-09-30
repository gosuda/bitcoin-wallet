/** @vitest-environment jsdom */
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/wasm", async () => (await import("./fakes")).wasmModule);
vi.mock("../src/persist/indexeddb", async () => (await import("./fakes")).persistModule);

import { api } from "../src/api";
import { renderPsbt as renderPhonePsbt } from "../src/mobile/screens/psbt";
import { renderSettings as renderPhoneSettings } from "../src/mobile/screens/settings";
import { platform, setPlatform } from "../src/platform";
import { renderPsbt } from "../src/screens/psbt";
import { renderSettings } from "../src/screens/settings";
import { session } from "../src/session";
import { type PsbtInput, type PsbtReview, WalletError } from "../src/types";
import { fake } from "./fakes";
import { at, buttonNamed, find, mount, settle, type, useScreenHarness } from "./harness";

useScreenHarness();

const txid = (head: string, tail: string): string => `${head}${"0".repeat(46)}${tail}`;

const n = (sats: number): string => sats.toLocaleString();

/** The addresses 7 and M14 are drawn with: a taproot recipient, and change of ours. */
const RECIPIENT = "tb1p5n82a6xmp47yhkkc007dxstutv23cce37xqg0n2ugwsmfnu98h2szr4k32";
const CHANGE = "tb1qel9khap2lcftpn7svq252jaehntzvufta3c62c";

const OURS_1: PsbtInput = {
  txid: txid("57f7533d63", "cee1b3a7"),
  vout: 0,
  value_sat: 30_000,
  ours: true,
  finalized: false,
};
const OURS_2: PsbtInput = {
  txid: txid("9ae2136a23", "23210b1b"),
  vout: 1,
  value_sat: 25_000,
  ours: true,
  finalized: false,
};
/** Someone else's coin, which they have signed; the PSBT does not say what it is worth. */
const THEIRS: PsbtInput = {
  txid: txid("c3a9d07e51", "6be02f94"),
  vout: 2,
  value_sat: null,
  ours: false,
  finalized: true,
};

/** The PSBT 7 and M14 are drawn with: two coins of ours, neither signed, paying 40,000. */
const UNSIGNED: PsbtReview = {
  psbt_base64: "cHNidP8BAKYCAAAAAqez4c6ud4mmc9q4x1ecJ7yzkymt0vusyRIhcWM9U/dX",
  txid: null,
  inputs: [OURS_1, OURS_2],
  outputs: [
    { address: RECIPIENT, value_sat: 40_000, ours: false },
    { address: CHANGE, value_sat: 14_779, ours: true },
  ],
  fee_sat: 221,
  vsize: 221,
  net_sat: -40_221,
  finalized: false,
  signable: true,
};

/** The same, once this wallet has signed both inputs: final, so it has a txid. */
const SIGNED: PsbtReview = {
  ...UNSIGNED,
  psbt_base64: "cHNidP8BAKYCAAAAAqez4c6ud4mmc9q4x1ecJ7yzkymt0vusyRIhcWM9U/dX+signed",
  txid: "b".repeat(64),
  inputs: [
    { ...OURS_1, finalized: true },
    { ...OURS_2, finalized: true },
  ],
  finalized: true,
  signable: false,
};

/** A coin of ours beside someone else's: theirs signed, ours not, and no fee to be known. */
const SHARED: PsbtReview = {
  ...UNSIGNED,
  psbt_base64: "cHNidP8BAHECAAAAAshared",
  inputs: [OURS_1, THEIRS],
  fee_sat: null,
  vsize: null,
};

/** Nothing here for this wallet to sign: someone else's coin alone, unsigned. */
const THEIRS_ONLY: PsbtReview = {
  ...UNSIGNED,
  psbt_base64: "cHNidP8BAFICAAAAAtheirs",
  inputs: [{ ...THEIRS, value_sat: 41_000, finalized: false }],
  outputs: [{ address: RECIPIENT, value_sat: 40_000, ours: false }],
  fee_sat: 1_000,
  vsize: null,
  net_sat: 0,
  signable: false,
};

const field = (screen: HTMLElement): HTMLTextAreaElement =>
  find<HTMLTextAreaElement>(screen, "textarea[name=psbt]");

const buttonsNamed = (root: ParentNode, name: string): HTMLButtonElement[] =>
  [...root.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);

/** Pastes `text` into the field, as a person would, and lets the core answer. */
async function paste(screen: HTMLElement, text: string): Promise<void> {
  type(field(screen), text);
  await settle();
}

/** Runs `work` with a clipboard that holds `text`. */
async function withClipboard(text: string, work: () => Promise<void>): Promise<void> {
  Object.defineProperty(navigator, "clipboard", {
    value: { readText: async () => text },
    configurable: true,
  });
  try {
    await work();
  } finally {
    Reflect.deleteProperty(navigator, "clipboard");
  }
}

/** The line under the review, while there is a review to say it about. */
function signedLine(screen: HTMLElement, selector: string): string[] {
  const status = screen.querySelector<HTMLElement>(selector);
  return status === null || status.hidden ? [] : [status.textContent ?? ""];
}

interface Shell {
  shell: string;
  /** Opens a wallet, and renders Import PSBT over it. */
  open(): Promise<HTMLElement>;
  /** Renders Settings, checks where the way in sits, and takes it. */
  enter(): Promise<void>;
  /** What the screen says about the PSBT, line by line, down to how much is signed. */
  said(screen: HTMLElement): string[];
  /** That, for UNSIGNED, as the board draws it. */
  drawnUnsigned: string[];
  /** And for SHARED: ours unsigned beside theirs signed, and the fee unknown. */
  drawnShared: string[];
}

const DESKTOP: Shell = {
  shell: "desktop",
  async open() {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("psbt");
    return mount(renderPsbt());
  },
  async enter() {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("settings");
    const settings = mount(renderSettings());
    const link = find<HTMLAnchorElement>(settings, 'a[href="#/psbt"]');
    expect(link.textContent).toBe("Import PSBT");
    // Its own card, beside Public keys, as 6 draws it.
    const card = link.closest("section");
    expect(card?.parentElement?.classList.contains("settings-pair")).toBe(true);
    expect(card?.textContent).toContain(
      "Sign or send a transaction that another wallet or device made.",
    );
    link.click();
    await settle();
  },
  said(screen) {
    const head = screen.querySelector(".slot .card-head .hint");
    const rows = [...screen.querySelectorAll(".slot tbody tr")].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim() ?? "").join(" | "),
    );
    return [
      ...(head === null ? [] : [head.textContent ?? ""]),
      ...rows,
      ...signedLine(screen, ".psbt-status"),
    ];
  },
  drawnUnsigned: [
    "2 inputs, both from this wallet · 2 outputs",
    `Input 1 | 57f7533d63…cee1b3a7:0 | This wallet · not signed | ${n(30_000)}`,
    `Input 2 | 9ae2136a23…23210b1b:1 | This wallet · not signed | ${n(25_000)}`,
    `Output 1 | ${RECIPIENT} | Recipient | ${n(40_000)}`,
    `Output 2 | ${CHANGE} | Change · back to this wallet | ${n(14_779)}`,
    "Fee | 1.0 sat/vB · 221 vB |  | 221",
    "Signed 0 of 2 inputs",
  ],
  drawnShared: [
    "2 inputs, 1 from this wallet · 2 outputs",
    `Input 1 | 57f7533d63…cee1b3a7:0 | This wallet · not signed | ${n(30_000)}`,
    "Input 2 | c3a9d07e51…6be02f94:2 | Another wallet · signed | unknown",
    `Output 1 | ${RECIPIENT} | Recipient | ${n(40_000)}`,
    `Output 2 | ${CHANGE} | Change · back to this wallet | ${n(14_779)}`,
    "Fee |  | Not every input's value is known. | unknown",
    "Signed 1 of 2 inputs",
  ],
};

const PHONE: Shell = {
  shell: "phone",
  async open() {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("psbt");
    return mount(renderPhonePsbt());
  },
  async enter() {
    await api.openWallet("abandon abandon abandon", "p2wpkh", false);
    at("settings");
    const settings = mount(renderPhoneSettings());
    const rows = [...settings.querySelectorAll<HTMLElement>(".m-item")];
    const names = rows.map((r) => r.firstElementChild?.textContent);
    // Where M10b draws it: right after Coins.
    expect(names.indexOf("Import PSBT")).toBe(names.indexOf("Coins") + 1);
    rows[names.indexOf("Import PSBT")]?.click();
    await settle();
  },
  said(screen) {
    const card = screen.querySelector(".m-psbt");
    const line = (e: Element): string => {
      if (e.classList.contains("m-psbt-head")) {
        return [...e.children].map((c) => c.textContent).join(" — ");
      }
      if (e.classList.contains("m-io")) {
        const note = e.querySelector(".m-io-note")?.textContent;
        const where = e.querySelector(".m-io-addr")?.textContent;
        return `${where}${note ? ` (${note})` : ""} | ${e.querySelector(".m-io-value")?.textContent}`;
      }
      return (
        [...e.children].map((c) => c.textContent?.replace(/\u00a0/g, " ")).join(" | ") ||
        (e.textContent ?? "")
      );
    };
    return [
      ...(card === null ? [] : [...card.children].map(line)),
      ...signedLine(screen, ".m-psbt-status"),
    ];
  },
  drawnUnsigned: [
    "Inputs · 2 — both from this wallet",
    `57f7533d63…cee1b3a7:0 | ${n(30_000)} sat`,
    `9ae2136a23…23210b1b:1 | ${n(25_000)} sat`,
    "Outputs · 2",
    `${RECIPIENT} | ${n(40_000)} sat`,
    `${CHANGE} (change, back to this wallet) | ${n(14_779)} sat`,
    "Fee | 221 sat · 1.0 sat/vB · 221 vB",
    "Signed 0 of 2 inputs",
  ],
  drawnShared: [
    "Inputs · 2 — 1 from this wallet",
    `57f7533d63…cee1b3a7:0 | ${n(30_000)} sat`,
    "c3a9d07e51…6be02f94:2 (another wallet's · signed) | unknown",
    "Outputs · 2",
    `${RECIPIENT} | ${n(40_000)} sat`,
    `${CHANGE} (change, back to this wallet) | ${n(14_779)} sat`,
    "Fee | unknown",
    "Signed 1 of 2 inputs",
  ],
};

describe.each([DESKTOP, PHONE])("Import PSBT on the $shell (6.15)", (shell) => {
  it("is opened from Settings", async () => {
    await shell.enter();
    expect(window.location.hash).toBe("#/psbt");
  });

  it("describes a pasted PSBT as soon as it parses, as the board draws it, signing nothing", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    expect(shell.said(screen)).toEqual([]);

    await paste(screen, `  ${UNSIGNED.psbt_base64}\n`);

    expect(fake.calls).toContainEqual(["import_psbt", UNSIGNED.psbt_base64]);
    expect(shell.said(screen)).toEqual(shell.drawnUnsigned);
    expect(fake.callNames()).not.toContain("sign_psbt");
  });

  it("tells this wallet's inputs from another's and signed from not, and says an unknown fee is unknown", async () => {
    fake.state.psbtReview = SHARED;
    const screen = await shell.open();

    await paste(screen, SHARED.psbt_base64);

    expect(shell.said(screen)).toEqual(shell.drawnShared);
  });

  it("says in words that a paste is not a PSBT, and describes nothing", async () => {
    const screen = await shell.open();

    await paste(screen, "hello");

    expect(fake.calls).toContainEqual(["import_psbt", "hello"]);
    const error = find(screen, "#psbt-error");
    expect(error.textContent).toBe("This is not a PSBT the wallet can read.");
    expect(field(screen).getAttribute("aria-invalid")).toBe("true");
    expect(screen.textContent).not.toContain("PSBT error");
    expect(shell.said(screen)).toEqual([]);
    expect(buttonNamed(screen, "Sign").disabled).toBe(true);
    expect(buttonNamed(screen, "Broadcast").disabled).toBe(true);

    // A PSBT pasted over it takes the error away.
    fake.state.psbtReview = UNSIGNED;
    await paste(screen, UNSIGNED.psbt_base64);
    expect(error.textContent).toBe("");
    expect(field(screen).hasAttribute("aria-invalid")).toBe(false);
    expect(shell.said(screen)).toEqual(shell.drawnUnsigned);
  });

  it("refuses a BC-UR code pasted in, without asking the core", async () => {
    const screen = await shell.open();

    await paste(
      screen,
      "ur:crypto-psbt/hdcxlkahssqzwfvslofzoxwkrewngotktbmwjkwdcmnefsaaehrlolkskn",
    );

    expect(find(screen, "#psbt-error").textContent).toContain("BC-UR");
    expect(find(screen, "#psbt-error").textContent).toContain("not supported yet");
    expect(fake.callNames()).not.toContain("import_psbt");
  });

  it("Sign signs the PSBT on screen and redraws it, the field holding what was signed", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    await paste(screen, UNSIGNED.psbt_base64);

    fake.state.psbtReview = SIGNED;
    buttonNamed(screen, "Sign").click();
    await settle();

    expect(fake.calls).toContainEqual(["sign_psbt", UNSIGNED.psbt_base64]);
    expect(shell.said(screen).at(-1)).toBe("Signed 2 of 2 inputs");
    expect(field(screen).value).toBe(SIGNED.psbt_base64);
  });

  it("keeps Broadcast off until every input is final", async () => {
    const screen = await shell.open();
    const broadcast = buttonNamed(screen, "Broadcast");
    expect(broadcast.disabled).toBe(true);

    // Someone else's input is signed, ours is not.
    fake.state.psbtReview = SHARED;
    await paste(screen, SHARED.psbt_base64);
    expect(broadcast.disabled).toBe(true);

    fake.state.psbtReview = UNSIGNED;
    await paste(screen, UNSIGNED.psbt_base64);
    expect(broadcast.disabled).toBe(true);

    fake.state.psbtReview = SIGNED;
    buttonNamed(screen, "Sign").click();
    await settle();
    expect(broadcast.disabled).toBe(false);
    expect(buttonNamed(screen, "Sign").disabled).toBe(true);
  });

  it("Broadcast sends the final PSBT and lands where Send lands, the result kept for it", async () => {
    fake.state.psbtReview = SIGNED;
    const screen = await shell.open();
    await paste(screen, SIGNED.psbt_base64);

    buttonNamed(screen, "Broadcast").click();
    await settle();

    expect(fake.calls).toContainEqual(["broadcast", SIGNED.psbt_base64]);
    expect(session.lastResult?.txid).toBe("f".repeat(64));
    expect(window.location.hash).toBe("#/result");
  });

  // The code that says a paste is no PSBT also refuses one at broadcast;
  // there the core's reason is the one to read.
  it("says why Broadcast was refused, and stays with the PSBT", async () => {
    fake.state.psbtReview = SIGNED;
    const screen = await shell.open();
    await paste(screen, SIGNED.psbt_base64);
    const why = "PSBT error: absurdly high fee rate of 30000 sat/vB";
    const refused = vi
      .spyOn(api, "broadcastPsbt")
      .mockRejectedValueOnce(new WalletError("psbt", why));

    buttonNamed(screen, "Broadcast").click();
    await settle();
    refused.mockRestore();

    expect(screen.textContent).toContain(why);
    expect(screen.textContent).not.toContain("This is not a PSBT the wallet can read.");
    expect(window.location.hash).toBe("#/psbt");
    expect(session.lastResult).toBeNull();
  });

  it("a watch-only wallet has no Sign, and broadcasts a PSBT signed elsewhere", async () => {
    fake.state.watchOnly = true;
    fake.state.psbtReview = SIGNED;
    const screen = await shell.open();
    expect(buttonsNamed(screen, "Sign")).toHaveLength(0);

    await paste(screen, SIGNED.psbt_base64);
    buttonNamed(screen, "Broadcast").click();
    await settle();

    expect(fake.calls).toContainEqual(["broadcast", SIGNED.psbt_base64]);
    expect(fake.callNames()).not.toContain("sign_psbt");
    expect(window.location.hash).toBe("#/result");
  });

  it("never lets an earlier paste's answer replace a later one's", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    const release = fake.holdPsbt();
    await paste(screen, UNSIGNED.psbt_base64);

    fake.state.psbtReview = SHARED;
    await paste(screen, SHARED.psbt_base64);
    expect(shell.said(screen)).toEqual(shell.drawnShared);

    release();
    await settle();

    expect(shell.said(screen)).toEqual(shell.drawnShared);
  });

  it("drops a signing the PSBT has moved on from", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    await paste(screen, UNSIGNED.psbt_base64);
    fake.state.psbtReview = SIGNED;
    const release = fake.holdPsbt();
    buttonNamed(screen, "Sign").click();
    await settle();

    fake.state.psbtReview = SHARED;
    await paste(screen, SHARED.psbt_base64);
    release();
    await settle();

    expect(shell.said(screen)).toEqual(shell.drawnShared);
    expect(field(screen).value).toBe(SHARED.psbt_base64);
    expect(buttonNamed(screen, "Broadcast").disabled).toBe(true);
  });

  it("says so when this wallet holds no key for any input, rather than sign nothing in silence", async () => {
    fake.state.psbtReview = THEIRS_ONLY;
    const screen = await shell.open();
    await paste(screen, THEIRS_ONLY.psbt_base64);

    buttonNamed(screen, "Sign").click();
    await settle();

    expect(fake.calls).toContainEqual(["sign_psbt", THEIRS_ONLY.psbt_base64]);
    expect(find(screen, ".banner").textContent).toBe(
      "This wallet holds no key for any of these inputs, so nothing was signed.",
    );
  });

  it("Paste reads the clipboard into the field and describes it", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();

    await withClipboard(`\n${UNSIGNED.psbt_base64}\n`, async () => {
      buttonNamed(screen, "Paste").click();
      await settle();
    });

    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(fake.calls).toContainEqual(["import_psbt", UNSIGNED.psbt_base64]);
    expect(shell.said(screen)).toEqual(shell.drawnUnsigned);
  });

  // A Tauri webview refuses the page's own read with nothing the user could
  // allow, so the apps read through the shell, and Paste asks the platform.
  it("Paste reads through the platform where the page's own clipboard is refused", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
      configurable: true,
    });
    setPlatform({ ...platform(), readClipboard: async () => UNSIGNED.psbt_base64 });

    try {
      buttonNamed(screen, "Paste").click();
      await settle();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }

    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(shell.said(screen)).toEqual(shell.drawnUnsigned);
  });

  it("keeps what was typed while Paste was still reading the clipboard", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    let answer = (_text: string): void => {};
    setPlatform({
      ...platform(),
      readClipboard: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    });

    buttonNamed(screen, "Paste").click();
    await paste(screen, UNSIGNED.psbt_base64);
    answer(SHARED.psbt_base64);
    await settle();

    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(fake.calls).not.toContainEqual(["import_psbt", SHARED.psbt_base64]);
    expect(shell.said(screen)).toEqual(shell.drawnUnsigned);
  });

  it("Paste says an empty clipboard is empty, and keeps what is in the field", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    await paste(screen, UNSIGNED.psbt_base64);
    setPlatform({ ...platform(), readClipboard: async () => "" });

    buttonNamed(screen, "Paste").click();
    await settle();

    expect(find(screen, ".banner").textContent).toBe("The clipboard is empty.");
    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(shell.said(screen)).toEqual(shell.drawnUnsigned);
  });

  it("Paste says so where the clipboard cannot be read, and keeps what is in the field", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.state.psbtReview = UNSIGNED;
    const screen = await shell.open();
    await paste(screen, UNSIGNED.psbt_base64);

    // jsdom has no clipboard to read, as some webviews have none.
    buttonNamed(screen, "Paste").click();
    await settle();

    expect(find(screen, ".banner").textContent).toBe(
      "The clipboard cannot be read here. Paste into the field instead.",
    );
    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(shell.said(screen)).toEqual(shell.drawnUnsigned);
  });
});

describe("Import PSBT on the desktop (7)", () => {
  /** Chooses `file` in the picker Load file… opens. */
  function choose(screen: HTMLElement, file: File): void {
    const picker = find<HTMLInputElement>(screen, "input[type=file]");
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    picker.dispatchEvent(new Event("change"));
  }

  it("Load file… opens the file picker", async () => {
    const screen = await DESKTOP.open();
    const opened = vi.spyOn(find<HTMLInputElement>(screen, "input[type=file]"), "click");

    buttonNamed(screen, "Load file…").click();

    expect(opened).toHaveBeenCalledOnce();
  });

  it("reads a .psbt file of raw bytes as base64", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await DESKTOP.open();
    // The magic, then the start of what follows it in any PSBT. Bytes past
    // 0x7f are where reading the file as text would go wrong.
    const bytes = new Uint8Array([
      0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x00, 0xa6, 0x02, 0xfe, 0x80,
    ]);

    choose(screen, new File([bytes], "unsigned.psbt"));
    await settle();

    const base64 = Buffer.from(bytes).toString("base64");
    expect(fake.calls).toContainEqual(["import_psbt", base64]);
    expect(field(screen).value).toBe(base64);
    expect(DESKTOP.said(screen)).toEqual(DESKTOP.drawnUnsigned);
  });

  it("keeps what was typed while a chosen file was still being read", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await DESKTOP.open();
    let answer = (_bytes: ArrayBuffer): void => {};
    const slow = new File([SHARED.psbt_base64], "shared.txt");
    Object.defineProperty(slow, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          answer = resolve;
        }),
    });

    choose(screen, slow);
    await paste(screen, UNSIGNED.psbt_base64);
    answer(new TextEncoder().encode(SHARED.psbt_base64).buffer as ArrayBuffer);
    await settle();

    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(fake.calls).toContainEqual(["import_psbt", UNSIGNED.psbt_base64]);
    expect(fake.calls).not.toContainEqual(["import_psbt", SHARED.psbt_base64]);
    expect(DESKTOP.said(screen)).toEqual(DESKTOP.drawnUnsigned);
  });

  it("reads any other file as its text, trimmed: base64, or hex", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await DESKTOP.open();

    choose(screen, new File([`\n  ${UNSIGNED.psbt_base64}  \r\n`], "unsigned.txt"));
    await settle();
    expect(fake.calls).toContainEqual(["import_psbt", UNSIGNED.psbt_base64]);

    // Hex starts with the magic spelled out in text, which is not the magic itself.
    choose(screen, new File(["70736274ff01009a0200\n"], "unsigned.hex"));
    await settle();
    expect(fake.calls).toContainEqual(["import_psbt", "70736274ff01009a0200"]);
  });

  it("says why Broadcast waits, until it no longer does", async () => {
    fake.state.psbtReview = UNSIGNED;
    const screen = await DESKTOP.open();
    const waits = [...screen.querySelectorAll<HTMLElement>(".psbt-foot .hint")].find(
      (e) =>
        e.textContent === "Broadcast waits until every input is signed and the PSBT is finalized.",
    );
    await paste(screen, UNSIGNED.psbt_base64);
    expect(waits?.hidden).toBe(false);

    fake.state.psbtReview = SIGNED;
    buttonNamed(screen, "Sign").click();
    await settle();

    expect(waits?.hidden).toBe(true);
  });
});

describe("Import PSBT on the phone (M14)", () => {
  /** Gives the phone a camera that reads `code`. */
  function camera(code: string | null) {
    const scanQr = vi.fn(async () => code);
    setPlatform({ ...platform(), scanQr });
    return scanQr;
  }

  it("Scan reads a PSBT that fits one QR code into the field, and describes it", async () => {
    fake.state.psbtReview = UNSIGNED;
    const scanQr = camera(UNSIGNED.psbt_base64);
    const screen = await PHONE.open();

    buttonNamed(screen, "Scan").click();
    await settle();

    expect(scanQr).toHaveBeenCalledOnce();
    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(fake.calls).toContainEqual(["import_psbt", UNSIGNED.psbt_base64]);
    expect(PHONE.said(screen)).toEqual(PHONE.drawnUnsigned);
  });

  it("refuses a BC-UR code, saying such codes are not supported yet, and keeps the field", async () => {
    fake.state.psbtReview = UNSIGNED;
    camera("UR:CRYPTO-PSBT/1-3/LPADAXCFAXHLCYYNAEHSYNDMWKAOLTAJPLEK");
    const screen = await PHONE.open();
    await paste(screen, UNSIGNED.psbt_base64);

    buttonNamed(screen, "Scan").click();
    await settle();

    const said = find(screen, ".banner").textContent;
    expect(said).toContain("BC-UR");
    expect(said).toContain("not supported yet");
    expect(fake.calls.filter((c) => c[0] === "import_psbt")).toHaveLength(1);
    expect(field(screen).value).toBe(UNSIGNED.psbt_base64);
    expect(PHONE.said(screen)).toEqual(PHONE.drawnUnsigned);
  });

  it("offers no Scan where there is no camera", async () => {
    const screen = await PHONE.open();
    expect(buttonsNamed(screen, "Scan")).toHaveLength(0);
    expect(buttonNamed(screen, "Paste")).toBeTruthy();
  });
});
