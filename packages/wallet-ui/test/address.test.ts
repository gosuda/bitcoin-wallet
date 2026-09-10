import { describe, expect, it } from "vitest";
import { addressError, addressLooksValid } from "../src/address";

const MAINNET_BECH32 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TEST_BECH32 = "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl";
const REGTEST_BECH32 = "bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const MAINNET_B58 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const TEST_B58 = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn";

describe("addressLooksValid", () => {
  it("accepts each network's own segwit prefix", () => {
    expect(addressLooksValid(MAINNET_BECH32, "bitcoin")).toBe(true);
    expect(addressLooksValid(TEST_BECH32, "signet")).toBe(true);
    expect(addressLooksValid(TEST_BECH32, "testnet3")).toBe(true);
    expect(addressLooksValid(TEST_BECH32, "testnet4")).toBe(true);
    expect(addressLooksValid(REGTEST_BECH32, "regtest")).toBe(true);
  });

  it("accepts base58 for each network", () => {
    expect(addressLooksValid(MAINNET_B58, "bitcoin")).toBe(true);
    expect(addressLooksValid(TEST_B58, "signet")).toBe(true);
  });

  // bech32 is single-case by definition, and mixed case is how a hand-retyped
  // address usually goes wrong.
  it("rejects mixed-case bech32 but takes either single case", () => {
    expect(addressLooksValid(TEST_BECH32.toUpperCase(), "signet")).toBe(true);
    expect(addressLooksValid(`Tb1${TEST_BECH32.slice(3)}`, "signet")).toBe(false);
    const mixed = `${TEST_BECH32.slice(0, 20)}${TEST_BECH32.slice(20).toUpperCase()}`;
    expect(addressLooksValid(mixed, "signet")).toBe(false);
  });

  it("rejects characters bech32 never uses", () => {
    // b, i, o and 1 are excluded from the bech32 alphabet.
    expect(addressLooksValid("tb1qbbbbbbbbb", "signet")).toBe(false);
    expect(addressLooksValid("tb1qiiiiiiiii", "signet")).toBe(false);
  });

  it("holds the length bounds", () => {
    expect(addressLooksValid("tb1qqqqq", "signet")).toBe(false); // 5 data chars
    expect(addressLooksValid(`tb1${"q".repeat(88)}`, "signet")).toBe(false); // 91 chars
    expect(addressLooksValid("1BvBMSEYstWetqTFn5Au4", "bitcoin")).toBe(false); // 21 chars
  });

  it("rejects an empty field", () => {
    expect(addressLooksValid("", "bitcoin")).toBe(false);
    expect(addressLooksValid("   ", "bitcoin")).toBe(false);
  });

  it("does not confuse regtest with mainnet, whose prefixes share a start", () => {
    expect(addressLooksValid(REGTEST_BECH32, "bitcoin")).toBe(false);
    expect(addressLooksValid(MAINNET_BECH32, "regtest")).toBe(false);
  });
});

describe("addressError", () => {
  it("says nothing about an empty field, which is incomplete not wrong", () => {
    expect(addressError("", "signet")).toBeNull();
    expect(addressError("   ", "signet")).toBeNull();
  });

  it("says nothing about a good address", () => {
    expect(addressError(TEST_BECH32, "signet")).toBeNull();
    expect(addressError(MAINNET_B58, "bitcoin")).toBeNull();
  });

  // The mistake people actually make, and the one worth naming precisely:
  // paying a mainnet address from a test wallet, or the reverse.
  it("names the network an address is actually for", () => {
    expect(addressError(MAINNET_BECH32, "signet")).toBe(
      "Not a Signet address — this one is for Bitcoin mainnet.",
    );
    expect(addressError(TEST_BECH32, "bitcoin")).toBe(
      "Not a Bitcoin address — this one is for a test network.",
    );
    expect(addressError(REGTEST_BECH32, "signet")).toBe(
      "Not a Signet address — this one is for regtest.",
    );
    expect(addressError(MAINNET_B58, "signet")).toBe(
      "Not a Signet address — this one is for Bitcoin mainnet.",
    );
  });

  it("falls back to a plain message when the prefix claims nothing", () => {
    expect(addressError("zzzzzzzzzzzzzzzz", "signet")).toBe("Not a valid signet address.");
  });

  // Same prefix family, so there is no wrong-network claim to make.
  it("does not claim a network for a malformed address of the right family", () => {
    expect(addressError("tb1!!!", "signet")).toBe("Not a valid signet address.");
  });
});
