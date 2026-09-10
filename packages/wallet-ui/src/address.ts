/**
 * Cheap address checks for a form field.
 *
 * The core has no address validator to call before a build, so this is a
 * deliberately conservative prefix-and-charset test: it rejects only values
 * that cannot belong to the network, and the real parse happens when the
 * transaction is built. What it adds over "invalid" is a reason — an address
 * for the wrong network is the mistake people actually make, and saying which
 * network it was for is what stops them making it twice.
 */

import { NETWORK_LABELS, type Network } from "./types";

/** Segwit prefix of a network, separator included. */
export const BECH32_HRP: Record<Network, string> = {
  bitcoin: "bc1",
  testnet3: "tb1",
  testnet4: "tb1",
  signet: "tb1",
  regtest: "bcrt1",
};

/** Base58 version bytes render as these leading characters. */
export const BASE58_PREFIXES: Record<Network, readonly string[]> = {
  bitcoin: ["1", "3"],
  testnet3: ["m", "n", "2"],
  testnet4: ["m", "n", "2"],
  signet: ["m", "n", "2"],
  regtest: ["m", "n", "2"],
};

const BECH32_DATA = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
const BASE58_BODY = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function addressLooksValid(raw: string, network: Network): boolean {
  const text = raw.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const hrp = BECH32_HRP[network];
  if (lower.startsWith(hrp)) {
    // bech32 is single-case by definition; a mixed-case string is never one.
    if (text !== lower && text !== text.toUpperCase()) return false;
    const data = lower.slice(hrp.length);
    return data.length >= 6 && text.length <= 90 && BECH32_DATA.test(data);
  }
  if (BASE58_PREFIXES[network].includes(text.slice(0, 1))) {
    return text.length >= 26 && text.length <= 35 && BASE58_BODY.test(text);
  }
  return false;
}

/** The family a network belongs to, as far as an address prefix can tell. */
type Family = "mainnet" | "test" | "regtest";

const FAMILY_OF: Record<Network, Family> = {
  bitcoin: "mainnet",
  testnet3: "test",
  testnet4: "test",
  signet: "test",
  regtest: "regtest",
};

const FAMILY_NAME: Record<Family, string> = {
  mainnet: "Bitcoin mainnet",
  test: "a test network",
  regtest: "regtest",
};

/** Which family an address's prefix claims, or null when it claims nothing. */
function prefixFamily(text: string): Family | null {
  const lower = text.toLowerCase();
  if (lower.startsWith("bcrt1")) return "regtest";
  if (lower.startsWith("bc1")) return "mainnet";
  if (lower.startsWith("tb1")) return "test";
  const first = text.slice(0, 1);
  if (first === "1" || first === "3") return "mainnet";
  if (first === "m" || first === "n" || first === "2") return "test";
  return null;
}

/**
 * The message a field shows under a bad address, or null when the address
 * passes — or is empty, which is incomplete rather than wrong.
 */
export function addressError(raw: string, network: Network): string | null {
  const text = raw.trim();
  if (text === "" || addressLooksValid(text, network)) return null;
  const label = NETWORK_LABELS[network];
  const claimed = prefixFamily(text);
  if (claimed !== null && claimed !== FAMILY_OF[network]) {
    return `Not a ${label} address — this one is for ${FAMILY_NAME[claimed]}.`;
  }
  return `Not a valid ${label.toLowerCase()} address.`;
}
