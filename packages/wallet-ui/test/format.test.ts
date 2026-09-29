import { describe, expect, it, vi } from "vitest";
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
