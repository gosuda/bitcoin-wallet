/**
 * Every test runs as if on a German device.
 *
 * The app formats numbers in the device's locale (decided 2026-09-29), and a
 * test machine is usually en-US — where a number pinned to "en-US" by mistake
 * looks exactly right. German writes 1.234,5, the opposite separators, so the
 * same mistake fails here instead of passing by coincidence. The code under
 * test names no locale; this only changes what "the device's" means.
 */

import { afterEach } from "vitest";

const GERMAN = "de-DE";
let device = GERMAN;

/**
 * Make `locale` the device's for the code under test, from the next formatter
 * it builds. It lasts until the end of the test that asks for it.
 */
export function useDeviceLocale(locale: string): void {
  device = locale;
}

afterEach(() => {
  device = GERMAN;
});

const BaseNumberFormat = Intl.NumberFormat;

class DeviceNumberFormat extends BaseNumberFormat {
  constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    super(locales ?? device, options);
  }
}

Object.defineProperty(Intl, "NumberFormat", {
  value: DeviceNumberFormat,
  configurable: true,
  writable: true,
});

const baseToLocaleString = Number.prototype.toLocaleString;

Object.defineProperty(Number.prototype, "toLocaleString", {
  value(this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions): string {
    return baseToLocaleString.call(this, locales ?? device, options);
  },
  configurable: true,
  writable: true,
});
