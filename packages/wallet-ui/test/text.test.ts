import { describe, expect, it } from "vitest";
import { forgetWarning, maxModeNote, sentNotSaved } from "../src/ui/text";

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
