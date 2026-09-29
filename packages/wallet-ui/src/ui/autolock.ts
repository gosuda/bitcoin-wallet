/**
 * Locking in the background (6.11): a remembered wallet that has been out of
 * sight for the chosen time closes to Unlock.
 *
 * Page visibility is what every shell reports: a desktop window that is
 * minimized or covered, and a phone app that is switched away from, both turn
 * the page `hidden`. A desktop window keeps its timers running, so a timer
 * locks at the deadline. A phone suspends the page instead, and a timer may
 * never fire there, so coming back checks the clock as well. Whichever sees
 * the deadline pass first locks.
 *
 * Only the remembered wallet, on a device that keeps its key, is closed:
 * Unlock opens it again. Any other wallet would need its recovery phrase or
 * key typed in again, so it stays open (decided on 2026-09-30).
 */

import { api, whenIdle } from "../api";
import { platform } from "../platform";
import { navigate } from "../router";
import { session } from "../session";
import { DEFAULT_LOCK_AFTER, type LockAfter } from "../types";
import type { WalletApi } from "../wasm";

let limit: LockAfter = DEFAULT_LOCK_AFTER;

/** The choice in force. */
export function lockAfter(): LockAfter {
  return limit;
}

/**
 * Applies `choice` from the next time the app goes to the background, and
 * saves it. When saving fails, the choice still holds until the app closes.
 */
export async function chooseLockAfter(choice: LockAfter): Promise<void> {
  limit = choice;
  await platform().setLockAfter(choice);
}

/**
 * The open wallet's handle, when Unlock can open it again: it is the
 * remembered one, on a device that keeps keys. The handle rather than the id,
 * so the same wallet closed and opened again while a lock waited is not the
 * one that lock was for.
 */
function lockable(): WalletApi | null {
  const open = session.wallet;
  if (!platform().canRememberWallet || open === null) return null;
  return session.remembered?.wallet_id === open.wallet_id ? session.handle : null;
}

/**
 * Closes `wallet` once no sync, rescan or broadcast is running, unless it was
 * closed or replaced meanwhile. A sync that runs past the deadline so delays
 * the lock rather than being cut short by it.
 */
async function lock(wallet: WalletApi): Promise<void> {
  await whenIdle();
  if (lockable() !== wallet) return;
  try {
    await api.closeWallet();
  } finally {
    navigate("unlock");
  }
}

/**
 * Reads the saved choice, then watches the page. Resolves to a function that
 * stops watching; the app itself never does.
 */
export async function startAutolock(): Promise<() => void> {
  try {
    limit = await platform().getLockAfter();
  } catch (e) {
    // Unreadable is not "never": the default still locks.
    console.error("could not read the saved lock time:", e);
    limit = DEFAULT_LOCK_AFTER;
  }

  // The deadline is on the wall clock: a phone that sleeps stops the
  // monotonic one, and would come back thinking no time had passed.
  let away: { wallet: WalletApi; deadline: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expire = (): void => {
    clearTimeout(timer);
    const wallet = away?.wallet;
    away = null;
    if (wallet) {
      void lock(wallet).catch((e: unknown) => console.error("could not lock the wallet:", e));
    }
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      const wallet = lockable();
      // A second `hidden` before the page is back must not move the deadline.
      if (away !== null || wallet === null || limit === "never") return;
      const ms = limit * 60_000;
      away = { wallet, deadline: Date.now() + ms };
      timer = setTimeout(expire, ms);
    } else if (away !== null && Date.now() >= away.deadline) {
      expire();
    } else {
      clearTimeout(timer);
      away = null;
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    clearTimeout(timer);
  };
}
