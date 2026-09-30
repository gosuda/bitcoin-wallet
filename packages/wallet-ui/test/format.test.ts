import { describe, expect, it, vi } from "vitest";
import {
  counted,
  feeLine,
  formatConf,
  formatConfirmations,
  formatDateTime,
  formatRate,
  formatTime,
  formatVsize,
  formatWhen,
  outputRole,
  shortId,
  shortOutpoint,
  typeableRate,
} from "../src/ui/format";
import { useDeviceLocale } from "./setup-locale";

// `ui/dom.ts` builds its formatters when it loads, as the app does when it
// starts, so each case loads a fresh copy after choosing the device.
async function onDevice(locale: string) {
  useDeviceLocale(locale);
  vi.resetModules();
  return import("../src/ui/dom");
}

describe("numbers follow the device", () => {
  it("groups and separates the way a German device writes them", async () => {
    const { formatBtc, formatNumber, formatSats } = await onDevice("de-DE");
    expect(formatNumber(1_234_567)).toBe("1.234.567");
    expect(formatSats(95_528)).toBe("95.528 sat");
    expect(formatBtc(123_456_789)).toBe("1,23456789 BTC");
  });

  // Integer math keeps the value exact; the digits still have to be the
  // device's, all eight of them after the point.
  it("writes every digit of a BTC amount in the device's numerals", async () => {
    const { formatBtc } = await onDevice("ar-EG");
    expect(formatBtc(1)).toBe("٠٫٠٠٠٠٠٠٠١ BTC");
    expect(formatBtc(123_456_789)).toBe("١٫٢٣٤٥٦٧٨٩ BTC");
  });

  it("reads on an en-US device exactly as it did before", async () => {
    const { formatBtc, formatSats } = await onDevice("en-US");
    expect(formatSats(1_000)).toBe("1,000 sat");
    expect(formatBtc(4_650)).toBe("0.00004650 BTC");
  });

  // Runs after the cases above chose other devices: the harness puts the
  // German one back after every test, so no choice leaks into the next.
  it("is back on the German device in a test that chose none", () => {
    expect((1234.5).toLocaleString()).toBe("1.234,5");
  });
});

const TXID = "d0ff3c6274ec32caad0106af2f8e7b89e266655a59c71e6ce20890e9679c6d46";
const ADDRESS = "tb1qxszuw0glm82fqr2yh45zfu872umrnwk9dadtzk";

describe("shortId", () => {
  // One rule for every id a list or a summary shortens, on both shells.
  it("keeps the first 10 and the last 8 characters around an ellipsis", () => {
    expect(shortId(TXID)).toBe("d0ff3c6274…679c6d46");
    expect(shortId(ADDRESS)).toBe("tb1qxszuw0…k9dadtzk");
  });

  it("leaves an id alone that would come out no shorter", () => {
    expect(shortId("tb1qshort")).toBe("tb1qshort");
    expect(shortId("0123456789012345678")).toBe("0123456789012345678");
    expect(shortId("01234567890123456789")).toBe("0123456789…23456789");
  });
});

describe("shortOutpoint", () => {
  it("shortens the txid and keeps the output's index", () => {
    expect(shortOutpoint({ txid: TXID, vout: 3 })).toBe("d0ff3c6274…679c6d46:3");
  });
});

describe("outputRole", () => {
  it("tells someone else's output, change on a spend, and a payment to this wallet apart", () => {
    expect(outputRole({ net_sat: -1_000 }, { ours: false })).toBe("recipient");
    expect(outputRole({ net_sat: -1_000 }, { ours: true })).toBe("change");
    expect(outputRole({ net_sat: 1_000 }, { ours: true })).toBe("ours");
  });
});

describe("rates, sizes and fees", () => {
  // A rate is typed back into a field with a ".", so it keeps one on every device.
  it("writes a rate with one decimal", () => {
    expect(formatRate(2)).toBe("2.0 sat/vB");
    expect(formatRate(12.345)).toBe("12.3 sat/vB");
  });

  it("groups a size the way the device groups numbers", () => {
    expect(formatVsize(141)).toBe("141 vB");
    expect(formatVsize(12_345)).toBe(`${(12_345).toLocaleString()} vB`);
  });

  // One line for every screen that describes a fee, on both shells.
  const spaced = (text: string) => text.replace(/\u00a0/g, " ");

  it("says a fee as amount, rate and size, working the rate out when it is not given", () => {
    expect(spaced(feeLine(141, 141))).toBe("141 sat · 1.0 sat/vB · 141 vB");
    expect(spaced(feeLine(153, 150, 1.02))).toBe("153 sat · 1.0 sat/vB · 150 vB");
  });

  // A phone's review is too narrow for it whole: it wraps after a "·", never
  // between a number and its unit.
  it("breaks only after a separator", () => {
    expect(feeLine(141, 141).split(" ")).toEqual([
      "141\u00a0sat\u00a0·",
      "1.0\u00a0sat/vB\u00a0·",
      "141\u00a0vB",
    ]);
  });

  it("leaves out what is not known", () => {
    expect(spaced(feeLine(null, 141))).toBe("141 vB");
    expect(spaced(feeLine(221, null))).toBe("221 sat");
  });
});

describe("pending, confirmations and time", () => {
  // Pending is the core reporting no count; both shells say it one way.
  it("says where a transaction stands", () => {
    expect(formatConfirmations(null)).toBe("Pending");
    expect(formatConfirmations(1)).toBe("1 confirmation");
    expect(formatConfirmations(1_234)).toBe(`${(1_234).toLocaleString()} confirmations`);
    expect(formatConf(null)).toBe("Pending");
    expect(formatConf(31)).toBe("31 conf.");
  });

  const now = new Date(2026, 8, 30, 14, 32, 10);
  const secondsAgo = (s: number) => Math.floor(now.getTime() / 1000) - s;

  // A time is one phrase: its spaces do not break, so a wrapping row keeps it whole.
  const whole = (text: string) => text.replace(/ /g, "\u00a0");

  it("says a recent time relatively, then the time today, then the date", () => {
    expect(formatWhen(secondsAgo(30), now)).toBe(whole("just now"));
    expect(formatWhen(secondsAgo(12 * 60), now)).toBe(whole("12 min ago"));
    const earlier = new Date(2026, 8, 30, 9, 5);
    expect(formatWhen(earlier.getTime() / 1000, now)).toBe(whole(`Today ${formatTime(earlier)}`));
    const before = new Date(2026, 7, 27, 18, 0);
    expect(formatWhen(before.getTime() / 1000, now)).toBe(
      whole(before.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
    );
    expect(formatWhen(earlier.getTime() / 1000, now)).not.toContain(" ");
  });

  it("names the year only when it is not this one", () => {
    const lastYear = new Date(2025, 11, 31, 12, 0);
    expect(formatWhen(lastYear.getTime() / 1000, now)).toContain("2025");
    const thisYear = new Date(2026, 0, 2, 12, 0);
    expect(formatWhen(thisYear.getTime() / 1000, now)).not.toContain("2026");
  });

  it("writes a clock time without seconds, and a transaction's date with its time", () => {
    const at = new Date(2026, 8, 30, 14, 32, 59);
    expect(formatTime(at)).not.toContain("59");
    // On the 24-hour clock whatever the device, so no "PM" or "오후" joins "Today".
    expect(formatTime(at)).toBe("14:32");
    expect(formatDateTime(at.getTime() / 1000)).toContain(formatTime(at).slice(0, 2));
  });
});

// What both shells prefill a fee field with, and what the phone's note names.
describe("typeableRate", () => {
  it("rounds up to a tenth, and never below the 1 sat/vB the core builds at", () => {
    expect(typeableRate(0.1)).toBe(1);
    expect(typeableRate(2.01)).toBe(2.1);
    expect(typeableRate(3)).toBe(3);
  });
});

// Found in review: counts beside grouped amounts were not grouped.
describe("counted", () => {
  it("groups a count as the device does, and names what it counts", () => {
    expect(counted(1, "input")).toBe("1 input");
    expect(counted(1_234, "input")).toBe(`${(1_234).toLocaleString()} inputs`);
  });
});
