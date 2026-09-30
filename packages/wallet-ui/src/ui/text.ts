/**
 * Sentences both shells say word for word: the display standard of Round 7
 * (docs/ROADMAP.md). A screen takes them from here, so the two cannot drift
 * apart again, as the Sent screen and Forget's warning had.
 */

import type { WalletInfo } from "../types";
import { formatSats } from "./format";

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
