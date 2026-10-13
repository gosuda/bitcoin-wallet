import { navigate } from "../router";
import { type Session, session } from "../session";

interface SendPayment {
  readonly address: string;
  readonly amountSat?: number;
}

interface PendingPayment {
  readonly handle: NonNullable<Session["handle"]>;
  readonly walletId: string;
  readonly payment: SendPayment;
}

let pending: PendingPayment | null = null;

/** Open Send only for a wallet that can sign. Never queue a rejected payment. */
export function openSendWithPayment(payment: SendPayment): boolean {
  const { handle, wallet } = session;
  if (!handle || !wallet || wallet.is_watch_only) {
    pending = null;
    return false;
  }
  pending = { handle, walletId: wallet.wallet_id, payment };
  navigate("send");
  return true;
}

/** Take at most once, and only for the same still-open wallet. */
export function takeSendPrefill(): SendPayment | null {
  const taken = pending;
  pending = null;
  const { handle, wallet } = session;
  if (
    !taken ||
    !handle ||
    !wallet ||
    wallet.is_watch_only ||
    taken.handle !== handle ||
    taken.walletId !== wallet.wallet_id
  ) {
    return null;
  }
  return taken.payment;
}

/** Discard pending payments on wallet changes and routes other than Send. */
export function clearSendPrefill(): void {
  pending = null;
}
