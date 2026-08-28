import type { AppConfig, BroadcastResult, RememberedWallet, WalletInfo } from "./types";

/** In-memory UI session. Never holds secret material. */
export interface Session {
  config: AppConfig | null;
  wallet: WalletInfo | null;
  /** Mirror of the persisted "remembered_wallet" record; the key itself never leaves Rust. */
  remembered: RememberedWallet | null;
  lastSyncedAt: Date | null;
  lastResult: BroadcastResult | null;
}

export const session: Session = {
  config: null,
  wallet: null,
  remembered: null,
  lastSyncedAt: null,
  lastResult: null,
};
