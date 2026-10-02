/**
 * Import PSBT as both shells show it: the desktop's page (7) and the phone's
 * screen (M14), each reached from Settings. A PSBT pasted, loaded or scanned
 * is described as soon as it parses; Sign signs the inputs this wallet holds
 * keys for, and Broadcast sends it once every input is final. Each shell
 * draws the review its own way; reading, signing and sending are shared here.
 */

import { api } from "../api";
import { navigate } from "../router";
import { sameWalletGuard, screenGuard } from "../screen";
import { session } from "../session";
import { errorMessage, isAppError, type PsbtReview } from "../types";
import { readClipboard } from "./clipboard";
import { type Banner, type BannerKind, formatNumber, setFieldError } from "./dom";
import { sentence } from "./text";

/** "psbt" and 0xff: the five bytes every PSBT starts with (BIP 174). */
const MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff] as const;

/** Said for a BC-UR code, scanned or pasted, instead of the core's parse error. */
export const UR_REFUSED =
  "Codes in the BC-UR format (ur:…) are not supported yet. Use the PSBT itself, as base64 or hex.";

/**
 * Said under the field for text the core cannot read as a PSBT. The core
 * passes on the parser's own words ("PSBT error: error in PSBT base64
 * encoding"), which name its failure rather than what was pasted. Only here:
 * the same code also refuses a PSBT at broadcast, for a reason worth reading.
 */
export const NOT_A_PSBT = "This is not a PSBT the wallet can read.";

const PASTE_REFUSED =
  "Clipboard access was refused. Allow it and try again, or paste into the field.";
const PASTE_UNAVAILABLE = "The clipboard cannot be read here. Paste into the field instead.";

/**
 * The text handed to the core for what was pasted, typed or scanned. Base64
 * and hex hold no whitespace, so none is kept: a PSBT copied out of an email
 * or a text file often arrives wrapped over several lines.
 */
export function psbtText(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/**
 * A PSBT file's contents as text for the core. A `.psbt` file is usually the
 * raw binary, which starts with the magic bytes and goes over as base64;
 * anything else is read as text, base64 or hex, as some tools save it.
 */
export function psbtFromFile(bytes: Uint8Array): string {
  if (MAGIC.every((byte, i) => bytes[i] === byte)) return base64(bytes);
  return psbtText(new TextDecoder().decode(bytes));
}

function base64(bytes: Uint8Array): string {
  // A slice at a time: spreading a whole large file into one call overflows the stack.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** A BC-UR code, `ur:crypto-psbt/…`, as animated QR codes carry a PSBT. */
export function isUr(text: string): boolean {
  return /^ur:/i.test(text.trim());
}

/** How many inputs are final: signed, with nothing left to add. */
export function signedCount(review: PsbtReview): number {
  return review.inputs.filter((i) => i.finalized).length;
}

/** "Signed 0 of 2 inputs", as both boards say it. */
export function signedLine(review: PsbtReview): string {
  const n = review.inputs.length;
  return `Signed ${formatNumber(signedCount(review))} of ${formatNumber(n)} input${n === 1 ? "" : "s"}`;
}

/**
 * The fee rate in sat/vB, or null until the size is known: exact once every
 * input is final, and from the most a signature can add while every input is
 * ours, so never over what the transaction will pay.
 */
export function feeRate(review: PsbtReview): number | null {
  const { fee_sat: fee, vsize } = review;
  return fee === null || vsize === null || vsize === 0 ? null : fee / vsize;
}

/** What to say after Sign that the review does not already show: null when it does. */
export function signNote(
  before: PsbtReview,
  after: PsbtReview,
): { kind: BannerKind; text: string } | null {
  if (signedCount(after) > signedCount(before)) {
    return after.finalized
      ? null
      : {
          kind: "ok",
          text: "Signed this wallet's inputs. Pass the PSBT above on to sign the rest.",
        };
  }
  if (!after.inputs.some((i) => i.ours)) {
    return {
      kind: "warn",
      text: "This wallet holds no key for any of these inputs, so nothing was signed.",
    };
  }
  return { kind: "warn", text: "Nothing was left for this wallet to sign." };
}

/** What a screen hands the flow to draw into. */
export interface PsbtView {
  /** Where the PSBT is pasted or typed; the flow reads it and fills it. */
  readonly field: HTMLTextAreaElement;
  /** Under the field: why its text is not a PSBT, or empty. */
  readonly error: HTMLElement;
  readonly alert: Banner;
  /** Draws `review`, or takes the last one down while none is described. */
  show(review: PsbtReview | null): void;
}

export interface PsbtFlow {
  /** The review on screen, or null while none is. */
  review(): PsbtReview | null;
  /** Reads the clipboard into the field, as Paste does. */
  paste(): Promise<void>;
  /** Reads a chosen file into the field, as Load file… does. */
  load(file: Blob): Promise<void>;
  /** Puts a scanned code in the field; a BC-UR one is refused and the field kept. */
  scanned(text: string): Promise<void>;
  /** Signs every input of this wallet's, and shows the PSBT with its part added. */
  sign(): Promise<void>;
  /** Sends the PSBT once every input is final, and opens Result as Send does. */
  broadcast(): Promise<void>;
}

/**
 * Reads `view.field` as it changes and answers for the screen being built:
 * call it once, while the screen is built, as with `screenGuard`.
 */
export function psbtFlow(view: PsbtView): PsbtFlow {
  const { field, error, alert } = view;
  const onScreen = screenGuard();
  const sameWallet = sameWalletGuard();
  let current: PsbtReview | null = null;
  /** The text last handed to the core; an edit that leaves it as it was reads nothing again. */
  let read = "";
  /**
   * Bumped by every read, every signing, and every paste or file load. An
   * answer lands only while its number is still the newest: one for text since
   * replaced, a signing the text moved on from, or a clipboard or file that
   * came back after the user typed, is dropped when it arrives.
   */
  let seq = 0;

  const put = (review: PsbtReview | null): void => {
    current = review;
    view.show(review);
  };

  const sayInvalid = (message: string | null): void => setFieldError(error, field, message);

  /** Describes `raw` once the core reads it; until then nothing is offered to sign or send. */
  const describe = async (raw: string): Promise<void> => {
    const text = psbtText(raw);
    if (text === read) return;
    read = text;
    const mine = ++seq;
    alert.hide();
    sayInvalid(null);
    put(null);
    if (text === "") return;
    if (isUr(text)) {
      sayInvalid(UR_REFUSED);
      return;
    }
    try {
      const review = await api.importPsbt(text);
      if (mine === seq && onScreen()) put(review);
    } catch (e) {
      if (mine !== seq || !onScreen()) return;
      sayInvalid(isAppError(e) && e.code === "psbt" ? NOT_A_PSBT : sentence(errorMessage(e)));
    }
  };

  const fill = (raw: string): Promise<void> => {
    field.value = psbtText(raw);
    return describe(field.value);
  };

  field.addEventListener("input", () => void describe(field.value));

  return {
    review: () => current,

    async paste() {
      alert.hide();
      const mine = ++seq;
      const got = await readClipboard();
      // Typed over, or loaded, while the clipboard was read: the newer stands.
      if (mine !== seq || !onScreen()) return;
      if (!("text" in got)) {
        alert.show("warn", got.refused ? PASTE_REFUSED : PASTE_UNAVAILABLE);
        return;
      }
      // An empty clipboard would otherwise wipe the PSBT already in the field.
      if (psbtText(got.text) === "") {
        alert.show("warn", "The clipboard is empty.");
        return;
      }
      await fill(got.text);
    },

    async load(file) {
      alert.hide();
      const mine = ++seq;
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        if (mine === seq && onScreen()) {
          alert.show("error", `The file could not be read: ${errorMessage(e)}`);
        }
        return;
      }
      // As with Paste: whatever reached the field while the file was read stands.
      if (mine === seq && onScreen()) await fill(psbtFromFile(bytes));
    },

    async scanned(text) {
      if (isUr(text)) {
        alert.show("warn", UR_REFUSED);
        return;
      }
      await fill(text);
    },

    async sign() {
      const before = current;
      if (before === null || before.finalized) return;
      const mine = ++seq;
      alert.hide();
      try {
        const after = await api.signPsbt(before.psbt_base64);
        if (mine !== seq || !onScreen()) return;
        // The field holds the PSBT the review describes, this wallet's part added:
        // what goes on to another signer, or out.
        field.value = after.psbt_base64;
        read = after.psbt_base64;
        put(after);
        const note = signNote(before, after);
        if (note) alert.show(note.kind, note.text);
      } catch (e) {
        if (mine === seq && onScreen()) alert.show("error", errorMessage(e));
      }
    },

    async broadcast() {
      const review = current;
      if (review === null || !review.finalized) return;
      alert.hide();
      try {
        const result = await api.broadcastPsbt(review.psbt_base64);
        // It went out, so it is recorded for this wallet whichever screen is on
        // top by now, never for another, and shown only while this one is open.
        if (!sameWallet()) return;
        session.lastResult = result;
        if (onScreen()) navigate("result");
      } catch (e) {
        if (onScreen()) alert.show("error", errorMessage(e));
      }
    },
  };
}
