import type { AppConfig, BroadcastResult, WalletInfo } from "./types";

/** In-memory UI session. Never holds secret material. */
export interface Session {
  config: AppConfig | null;
  wallet: WalletInfo | null;
  lastSyncedAt: Date | null;
  lastResult: BroadcastResult | null;
}

export const session: Session = {
  config: null,
  wallet: null,
  lastSyncedAt: null,
  lastResult: null,
};
