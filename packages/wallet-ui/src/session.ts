import type { AppConfig, BroadcastResult, RememberedWallet, WalletInfo } from "./types";
import type { WalletApi } from "./wasm";

/** In-memory UI session. Never holds secret material. */
export interface Session {
  config: AppConfig | null;
  /** The open WASM wallet; every chain operation goes through it. */
  handle: WalletApi | null;
  /** Non-secret description of `handle`, for the screens. */
  wallet: WalletInfo | null;
  /** Mirror of the persisted "remembered_wallet" record; the key stays in the OS keystore. */
  remembered: RememberedWallet | null;
  lastSyncedAt: Date | null;
  lastResult: BroadcastResult | null;
}

export const session: Session = {
  config: null,
  handle: null,
  wallet: null,
  remembered: null,
  lastSyncedAt: null,
  lastResult: null,
};
