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

/** The family a network belongs to, as far as an address prefix can tell. */
type Family = "mainnet" | "test" | "regtest";

const FAMILY_OF: Record<Network, Family> = {
  bitcoin: "mainnet",
  testnet3: "test",
  testnet4: "test",
  signet: "test",
  regtest: "regtest",
};

/**
 * How a family's addresses start: the segwit prefix, separator included, and
 * the leading characters its base58 version bytes render as.
 */
const PREFIXES: Record<Family, { hrp: string; base58: readonly string[] }> = {
  mainnet: { hrp: "bc1", base58: ["1", "3"] },
  test: { hrp: "tb1", base58: ["m", "n", "2"] },
  regtest: { hrp: "bcrt1", base58: ["m", "n", "2"] },
};

const BECH32_DATA = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
const BASE58_BODY = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function addressLooksValid(raw: string, network: Network): boolean {
  const text = raw.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const { hrp, base58 } = PREFIXES[FAMILY_OF[network]];
  if (lower.startsWith(hrp)) {
    // bech32 is single-case by definition; a mixed-case string is never one.
    if (text !== lower && text !== text.toUpperCase()) return false;
    const data = lower.slice(hrp.length);
    return data.length >= 6 && text.length <= 90 && BECH32_DATA.test(data);
  }
  if (base58.includes(text.slice(0, 1))) {
    return text.length >= 26 && text.length <= 35 && BASE58_BODY.test(text);
  }
  return false;
}

const FAMILY_NAME: Record<Family, string> = {
  mainnet: "Bitcoin mainnet",
  test: "a test network",
  regtest: "regtest",
};

/**
 * Which family an address's prefix claims, or null when it claims nothing.
 * Regtest shares test's base58 characters, which claim test: it is looked at last.
 */
function prefixFamily(text: string): Family | null {
  const lower = text.toLowerCase();
  const families: readonly Family[] = ["mainnet", "test", "regtest"];
  return (
    families.find((f) => lower.startsWith(PREFIXES[f].hrp)) ??
    families.find((f) => PREFIXES[f].base58.includes(text.slice(0, 1))) ??
    null
  );
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
  return `Not a valid ${label} address.`;
}
