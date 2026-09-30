import { describe, expect, it } from "vitest";
import { forgetWarning, maxModeNote, sentNotSaved, whoseInputs } from "../src/ui/text";

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
