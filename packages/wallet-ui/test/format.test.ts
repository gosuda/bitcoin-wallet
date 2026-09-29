import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeviceLocale } from "./setup-locale";

// `ui/dom.ts` builds its formatters when it loads, as the app does when it
// starts, so each case loads a fresh copy after choosing the device.
async function onDevice(locale: string) {
  useDeviceLocale(locale);
  vi.resetModules();
  return import("../src/ui/dom");
}

afterEach(() => {
  useDeviceLocale("de-DE");
});

describe("numbers follow the device", () => {
  it("groups and separates the way a German device writes them", async () => {
    const { formatBtc, formatNumber, formatSats } = await onDevice("de-DE");
    expect(formatNumber(1_234_567)).toBe("1.234.567");
    expect(formatSats(95_528)).toBe("95.528 sat");
    expect(formatBtc(123_456_789)).toBe("1,23456789 BTC");
  });

  it("reads on an en-US device exactly as it did before", async () => {
    const { formatBtc, formatSats } = await onDevice("en-US");
    expect(formatSats(1_000)).toBe("1,000 sat");
    expect(formatBtc(4_650)).toBe("0.00004650 BTC");
  });
});
