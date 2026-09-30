/**
 * Sentences both shells say word for word: the display standard of Round 7
 * (docs/ROADMAP.md). A screen takes them from here, so the two cannot drift
 * apart again, as the Sent screen and Forget's warning had.
 */

import type { WalletInfo } from "../types";
import { formatNumber, formatSats } from "./format";

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

/** The fee floor, as every fee field's note says it. */
export const FLOOR_NOTE = "floor 1 sat/vB";

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
