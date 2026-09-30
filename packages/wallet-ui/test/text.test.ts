import { describe, expect, it } from "vitest";
import {
  forgetWarning,
  maxModeNote,
  phraseError,
  sentence,
  sentNotSaved,
  whoseInputs,
} from "../src/ui/text";

describe("forgetWarning", () => {
  // Only a mnemonic has a recovery phrase: each wallet is told its own way back.
  it("names the way back the open wallet has", () => {
    expect(forgetWarning({ is_watch_only: true, is_hd: true })).toContain("xpub or descriptor");
    expect(forgetWarning({ is_watch_only: false, is_hd: true })).toContain("recovery phrase");
    expect(forgetWarning({ is_watch_only: false, is_hd: false })).toContain("private key");
    expect(forgetWarning({ is_watch_only: false, is_hd: false })).not.toContain("recovery phrase");
  });

  it("names every way back when no wallet is open to say which", () => {
    const all = forgetWarning(null);
    for (const way of ["recovery phrase", "private key", "xpub or descriptor"]) {
      expect(all).toContain(way);
    }
  });
});

describe("the sentences both Send screens say", () => {
  it("says what Max sends and how to leave it", () => {
    expect(maxModeNote(10_000, 141)).toBe(
      `Everything: ${(10_000).toLocaleString()} sat minus the 141 sat fee. Edit the amount to leave Max; Max needs a single recipient.`,
    );
  });

  it("says a send went out even when this device could not keep it", () => {
    expect(sentNotSaved("disk full")).toBe(
      "Sent, but this device could not save it: disk full. The next sync picks it up.",
    );
  });
});

// Found in review: the core's words reached the screen in lower case, as did
// a few of the UI's own.
describe("sentence", () => {
  it("writes a message with a capital and a full stop", () => {
    expect(sentence("backend error: HTTP 503")).toBe("Backend error: HTTP 503.");
    expect(sentence("no wallet is open")).toBe("No wallet is open.");
    expect(sentence("PSBT error: input 0 is not signed")).toBe(
      "PSBT error: input 0 is not signed.",
    );
    expect(sentence("Already one. ")).toBe("Already one.");
  });

  it("leaves an address or an outpoint at the start as it is", () => {
    expect(sentence("tb1qexample is not valid")).toBe("tb1qexample is not valid.");
    const outpoint = `${"cd".repeat(32)}:1`;
    expect(sentence(`${outpoint} is frozen`)).toBe(`${outpoint} is frozen.`);
  });
});

describe("phraseError", () => {
  const typed = ["abandon", "ability", "able", "xyz"];

  // bip39 counts from 0: "(word 3)" is the fourth.
  it("names an unknown word by its place in the grid, and by what was typed", () => {
    const core =
      "invalid key material: invalid mnemonic: mnemonic contains an unknown word (word 3)";
    expect(phraseError(core, typed)).toBe('Word 4 "xyz" is not in the word list.');
  });

  it("says any other reason as a sentence, without the core's framing", () => {
    const core = "invalid key material: invalid mnemonic: invalid checksum";
    expect(phraseError(core, typed)).toBe("Invalid checksum.");
  });
});

describe("whoseInputs", () => {
  const ours = { txid: "cd".repeat(32), vout: 1, ours: true };
  const theirs = { txid: "ef".repeat(32), vout: 0, ours: false };

  // What the wallet owns is "this wallet's" on both shells, never "yours".
  it("says whose a transaction's inputs are", () => {
    expect(whoseInputs([ours])).toBe("from this wallet");
    expect(whoseInputs([ours, ours])).toBe("both from this wallet");
    expect(whoseInputs([ours, ours, ours])).toBe("all from this wallet");
    expect(whoseInputs([ours, theirs])).toBe("1 from this wallet");
    expect(whoseInputs([theirs])).toBe("from another wallet");
    expect(whoseInputs([theirs, theirs])).toBe("none from this wallet");
  });

  // Found in review: a mining payout read "from another wallet".
  it("says a coinbase's coins are newly mined", () => {
    const coinbase = { txid: "0".repeat(64), vout: 0xffff_ffff, ours: false };
    expect(whoseInputs([coinbase])).toBe("newly mined");
  });
});
