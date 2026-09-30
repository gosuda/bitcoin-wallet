import { describe, expect, it, vi } from "vitest";
import { outputRole, shortId, shortOutpoint } from "../src/ui/format";
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
