/**
 * Sentences both shells say word for word: the display standard of Round 7
 * (docs/ROADMAP.md). A screen takes them from here, so the two cannot drift
 * apart again, as the Sent screen and Forget's warning had.
 */

import type { Network, WalletInfo } from "../types";
import { formatNumber, formatRate, formatSats } from "./format";

/**
 * A message as a banner or a field shows it, with a capital and a full stop.
 * The core's messages are lower case, as Rust's are, and so are a few of the
 * UI's own. Only a short first word of letters is capitalized: a message can
 * start with an address or an outpoint, which must stay as it is.
 */
export function sentence(message: string): string {
  const text = message.trim();
  if (text === "") return text;
  const capital = /^[a-z]{1,15}[\s:,;']/.test(text)
    ? `${text.charAt(0).toUpperCase()}${text.slice(1)}`
    : text;
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/** bip39 reports an unknown word by its 0-based index; a grid counts from 1. */
const UNKNOWN_WORD = /unknown word \(word (\d+)\)/i;

/** Framing the core adds on the way out; a phrase's check is only about the phrase. */
const CORE_PREFIX = /^(?:invalid key material:\s*)?(?:invalid mnemonic:\s*)?/i;

/**
 * Why a recovery phrase was refused, on both Restore screens. An unknown word
 * is named by its place in the grid, and by what was typed there: the core
 * counts from 0, and "(word 3)" was the fourth.
 */
export function phraseError(message: string, typed: readonly string[]): string {
  const unknown = UNKNOWN_WORD.exec(message);
  if (unknown) {
    const position = Number(unknown[1]) + 1;
    const word = typed[position - 1];
    return word
      ? `Word ${position} "${word}" is not in the word list.`
      : `Word ${position} is not in the word list.`;
  }
  return sentence(message.trim().replace(CORE_PREFIX, ""));
}

/** The Sent screen's first line, and the one after it. */
export const SENT_TITLE = "Transaction broadcast";
export const SENT_LINE = "The network has it. It shows as Pending until it is in a block.";

/** A send that went out, where keeping a record of it on this device did not. */
export function sentNotSaved(reason: string): string {
  return `Sent, but this device could not save it: ${reason}. The next sync picks it up.`;
}

/**
 * What Forget deletes, and what it takes to get the wallet back.
 *
 * Only a mnemonic has a recovery phrase; telling the owner of a single-key or
 * watch-only wallet that one restores it is false, so `wallet`, the open one,
 * names its own way back. With none open, as on Unlock, the remembered record
 * does not say which kind it is, and every way back is named. A BIP39
 * passphrase is part of the seed, so the phrase is named with it attached.
 */
export function forgetWarning(wallet: Pick<WalletInfo, "is_watch_only" | "is_hd"> | null): string {
  if (wallet === null) {
    return "The saved key and this device's copy of the wallet history will be deleted. You will need what you opened it with — a recovery phrase and any passphrase you set, a private key, or an xpub or descriptor.";
  }
  if (wallet.is_watch_only) {
    return "The saved descriptor and this device's copy of the wallet history will be deleted. You will need that xpub or descriptor to follow it again.";
  }
  return wallet.is_hd
    ? "The saved key and this device's copy of the wallet history will be deleted. Your recovery phrase restores it — together with the passphrase, if you set one."
    : "The saved key and this device's copy of the wallet history will be deleted. You will need that private key to open it again.";
}

/** Under an amount in Max mode: what it sends, and how to leave the mode. */
export function maxModeNote(everything: number, fee: number): string {
  return `Everything: ${formatSats(everything)} minus the ${formatSats(fee)} fee. Edit the amount to leave Max; Max needs a single recipient.`;
}

/** The fee floor, as every fee field's note says it, with its one decimal. */
export const FLOOR_NOTE = `floor ${formatRate(1)}`;

/**
 * When no estimate came back, or one with no rate at all. The desktop's Send
 * prefills a field the user can type in; everywhere else a preset starts
 * from a rate of its own, which the note names.
 */
export const ESTIMATE_UNAVAILABLE_TYPE = `Estimate unavailable — enter a rate · ${FLOOR_NOTE}`;

export function estimateUnavailable(startRate: number): string {
  return `Estimate unavailable — starting at ${formatRate(startRate)}`;
}

/** While a fee estimate is on its way, on every screen that asks for one. */
export const FETCHING_ESTIMATE = "Fetching the fee estimate…";

/** A coin list with nothing in it. */
export const NO_COINS = "No coins yet. Sync to look for them.";

/** What freezing does, said once under every list of coins. */
export const FROZEN_HINT =
  "A frozen coin stays out of every send, Max included, and out of the spendable balance until you unfreeze it.";

/** What Rescan is for, under both shells' Rescan. */
export const RESCAN_HINT =
  "Looks further past the last used address than a sync does, for a restored wallet that shows less than it should.";

/** Under a BIP39 passphrase field, when creating and when restoring alike. */
export const PASSPHRASE_HINT =
  "A passphrase creates a different wallet from the same words. Write it down too: without it, the words alone cannot recover this wallet. If you remember this device, it is kept with them.";

/** Over a new recovery phrase on both Create screens: who can spend with it, and how to keep it. */
export const WORDS_SPEND = "Anyone with these words can spend this wallet's bitcoin.";
export const WORDS_KEEP =
  "Write them down in order and keep them offline: this wallet cannot show them again.";

/** What a single key is entered as, and what one key means. */
export const PRIVATE_KEY_HINT =
  "A private key in hex (64 characters) or WIF. One key means one address and no recovery phrase.";
export const PRIVATE_KEY_PLACEHOLDER = "64-character hex or WIF";

/**
 * What a watch-only wallet is followed by, for the network chosen in Setup:
 * mainnet keys are xpubs at coin type 0, every test network's tpubs at 1.
 */
export function watchPlaceholder(network: Network | undefined): string {
  return network === "bitcoin"
    ? "xpub… or wpkh([fingerprint/84h/0h/0h]xpub…/0/*)"
    : "tpub… or wpkh([fingerprint/84h/1h/0h]tpub…/0/*)";
}

/** Over a newly generated single key, which is shown this once. */
export const KEY_SHOWN_ONCE =
  "Write this key down before you fund its address: it is shown once, and losing it loses the funds.";

/**
 * Whose a transaction's inputs are, as Import PSBT and a transaction's detail
 * say it: "from this wallet", "both from this wallet", "1 from this wallet",
 * "from another wallet". A coinbase's one input spends nothing: its coins
 * are "newly mined", from no wallet at all.
 */
export function whoseInputs(
  inputs: readonly { txid: string; vout: number; ours: boolean }[],
): string {
  const [first] = inputs;
  if (inputs.length === 1 && first !== undefined && isCoinbase(first)) return "newly mined";
  const n = inputs.length;
  const ours = inputs.filter((i) => i.ours).length;
  if (ours === n)
    return n === 1
      ? "from this wallet"
      : n === 2
        ? "both from this wallet"
        : "all from this wallet";
  if (ours === 0) return n === 1 ? "from another wallet" : "none from this wallet";
  return `${formatNumber(ours)} from this wallet`;
}

/** The null outpoint, which only a coinbase's input spends. */
function isCoinbase(input: { txid: string; vout: number }): boolean {
  return input.vout === 0xffff_ffff && /^0{64}$/.test(input.txid);
}
