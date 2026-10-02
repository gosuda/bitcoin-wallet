/*
 * What jsdom cannot provide to the screens: the WebAssembly wrapper and the
 * IndexedDB persister. `setup-fakes.ts` puts these in their place for every
 * test file.
 *
 * This module imports nothing that imports the wasm wrapper, so a mock
 * factory can load it. The helpers that drive screens are in `harness.ts`.
 *
 * The fake wallet answers from `fake.state`, which a test sets up and
 * `fake.reset()` puts back, and records every call the core would have
 * received in `fake.calls`. It also holds the fixtures the tests share: the
 * wallet's phrase and remembered record, a transaction's history row, and a
 * sealed store kept in memory.
 */

import type { SealedStore } from "../src/platform/sealed";
import {
  type Balance,
  type PsbtReview,
  type RememberedWallet,
  type TxDetail,
  type TxSummary,
  type Utxo,
  WalletError,
} from "../src/types";

const ADDRESS = "tb1q4gp4z4utc286kcdpdsj3qwgpefcf9u4mv9a0d5";
/** The recovery phrase `generateMnemonic` hands out. */
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
/** The wallet the fake core opens, whatever opened it, as a device remembers it. */
const SAVED: RememberedWallet = {
  wallet_id: "testnet4-p2wpkh-fake",
  address: ADDRESS,
  network: "testnet4",
  address_type: "p2wpkh",
};

const built = (total: number) => ({
  psbt_base64: `psbt-${total}`,
  fee_sat: 141,
  vsize: 141,
  total_out_sat: total,
  change_sat: 0,
  input_count: 1,
});

interface FakeState {
  balance: Balance;
  utxos: Utxo[];
  transactions: TxSummary[];
  /** `transaction(txid)` answers from here, `null` for anything absent. */
  details: Record<string, TxDetail>;
  watchOnly: boolean;
  /** sat/vB by confirmation target, as `estimate_fee` reports it. */
  estimate: Record<string, number>;
  /** What `import_psbt` and `sign_psbt` answer with. */
  psbtReview: PsbtReview | null;
  /**
   * When set, `open` fails as the core does on a saved record it cannot use,
   * for the reason given; deleting the record clears it.
   */
  corrupt: "malformed" | "mismatch" | "future_version" | null;
}

function freshState(): FakeState {
  return {
    balance: {
      confirmed: 50_000,
      trusted_pending: 0,
      untrusted_pending: 0,
      immature: 0,
      frozen: 0,
    },
    utxos: [],
    transactions: [],
    details: {},
    watchOnly: false,
    estimate: { "6": 2 },
    psbtReview: null,
    corrupt: null,
  };
}

const state: FakeState = freshState();
/** Every call the fake core received, oldest first: its name, then its arguments. */
const calls: unknown[][] = [];
let syncGate: Promise<void> = Promise.resolve();
/** Set by `holdPsbt`: the next `import_psbt` or `sign_psbt` waits on it, once. */
let psbtGate: Promise<void> | null = null;

/**
 * What `import_psbt` and `sign_psbt` answer: `psbtReview` as it was when the
 * call was made, once any hold on the call is released.
 */
async function answerPsbt(): Promise<PsbtReview> {
  const review = state.psbtReview;
  const gate = psbtGate;
  psbtGate = null;
  if (gate) await gate;
  if (!review) throw new WalletError("psbt", "PSBT error: not a psbt");
  return { ...review };
}

class FakeWallet {
  static async open(): Promise<FakeWallet> {
    calls.push(["open"]);
    const reason = state.corrupt;
    if (reason !== null) {
      // The core's own shape: `found` and `supported` only for a newer format.
      const future = reason === "future_version";
      throw new WalletError("corrupt_state", `saved wallet data could not be read: ${reason}`, {
        reason,
        found: future ? 2 : null,
        supported: future ? 1 : null,
      });
    }
    return new FakeWallet();
  }
  get id(): string {
    return SAVED.wallet_id;
  }
  get network(): string {
    return "testnet4";
  }
  get isHd(): boolean {
    return true;
  }
  get isRanged(): boolean {
    return true;
  }
  get isWatchOnly(): boolean {
    return state.watchOnly;
  }
  async address(): Promise<string> {
    return ADDRESS;
  }
  async newAddress(): Promise<string> {
    return ADDRESS;
  }
  async sync(): Promise<void> {
    calls.push(["sync"]);
    await syncGate;
  }
  async rescan(stopGap: number): Promise<void> {
    calls.push(["rescan", stopGap]);
  }
  async public_descriptors() {
    return { external: "wpkh(fake/0/*)", internal: null, account_xpub: null, fingerprint: null };
  }
  async transaction(txid: string): Promise<TxDetail | null> {
    return state.details[txid] ?? null;
  }
  async balance(): Promise<Balance> {
    return { ...state.balance };
  }
  async list_utxos(): Promise<Utxo[]> {
    return state.utxos.map((u) => ({ ...u }));
  }
  async set_frozen(coin: { txid: string; vout: number }, frozen: boolean): Promise<void> {
    calls.push(["set_frozen", coin, frozen]);
    for (const u of state.utxos) {
      if (u.txid === coin.txid && u.vout === coin.vout) u.frozen = frozen;
    }
  }
  async list_transactions(): Promise<TxSummary[]> {
    return state.transactions.map((t) => ({ ...t }));
  }
  async estimate_fee() {
    return { sat_per_vb_by_target: { ...state.estimate } };
  }
  async build_transfer(recipients: { amount_sat: number }[], rate: number) {
    calls.push(["build_transfer", recipients, rate]);
    return built(recipients.reduce((sum, r) => sum + r.amount_sat, 0));
  }
  async build_transfer_from(coins: unknown, recipients: { amount_sat: number }[], rate: number) {
    calls.push(["build_transfer_from", coins, recipients, rate]);
    return built(recipients.reduce((sum, r) => sum + r.amount_sat, 0));
  }
  async build_drain(address: string, rate: number) {
    calls.push(["build_drain", address, rate]);
    return built(49_859);
  }
  async build_drain_from(coins: unknown, address: string, rate: number) {
    calls.push(["build_drain_from", coins, address, rate]);
    return built(49_859);
  }
  async build_fee_bump(txid: string, rate: number) {
    calls.push(["build_fee_bump", txid, rate]);
    return built(40_000);
  }
  async build_cancel(txid: string, rate: number) {
    calls.push(["build_cancel", txid, rate]);
    return { ...built(0), change_sat: 48_200, fee_sat: 1_380 };
  }
  async build_cpfp(txid: string, rate: number) {
    calls.push(["build_cpfp", txid, rate]);
    return { ...built(0), change_sat: 28_886, fee_sat: 1_114 };
  }
  async sign(psbt: string): Promise<string> {
    calls.push(["sign", psbt]);
    return `signed-${psbt}`;
  }
  async import_psbt(psbt: string): Promise<PsbtReview> {
    calls.push(["import_psbt", psbt]);
    return answerPsbt();
  }
  async sign_psbt(psbt: string): Promise<PsbtReview> {
    calls.push(["sign_psbt", psbt]);
    return answerPsbt();
  }
  async broadcast(signed: string) {
    calls.push(["broadcast", signed]);
    return { txid: "f".repeat(64), persist_error: null };
  }
  free(): void {}
}

export const fake = {
  ADDRESS,
  PHRASE,
  SAVED,
  FakeWallet,
  state,
  calls,
  /** The names of the calls made so far, in order. */
  callNames(): string[] {
    return calls.map((c) => String(c[0]));
  },
  /** Holds every `sync` open until `release` is called. */
  holdSync(): () => void {
    let release = (): void => {};
    syncGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  },
  /**
   * Holds the next `import_psbt` or `sign_psbt` open until `release` is
   * called; later ones answer at once. It answers with what `psbtReview` held
   * when it was asked, so a later call can be given another answer meanwhile.
   */
  holdPsbt(): () => void {
    let release = (): void => {};
    psbtGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  },
  /** Back to an empty wallet with no call recorded; every test starts here. */
  reset(): void {
    Object.assign(state, freshState());
    calls.length = 0;
    syncGate = Promise.resolve();
    psbtGate = null;
  },
  /** The row the core lists in the history for `detail`, as a fresh object. */
  summaryOf(detail: TxDetail): TxSummary {
    return {
      txid: detail.txid,
      net_sat: detail.net_sat,
      sent_sat: detail.sent_sat,
      received_sat: detail.received_sat,
      fee_sat: detail.fee_sat,
      confirmations: detail.confirmations,
      timestamp: detail.timestamp,
    };
  },
  /** Where IndexedDB would keep sealed records: a map, which a test can read. */
  memoryStore(): SealedStore & { records: Map<string, unknown> } {
    const records = new Map<string, unknown>();
    return {
      records,
      get: async (walletId) => records.get(walletId),
      put: async (walletId, record) => {
        records.set(walletId, record);
      },
      delete: async (walletId) => {
        records.delete(walletId);
      },
    };
  },
};

export const wasmModule = {
  WalletApi: FakeWallet,
  walletIdForKey: async () => SAVED.wallet_id,
  explorerTxUrl: async () => null,
  generateKey: async () => {
    throw new Error("not used here");
  },
  generateMnemonic: async () => ({ words: PHRASE, address: ADDRESS }),
  validateMnemonic: async () => undefined,
};

export const persistModule = {
  makePersister: () => ({ initialize: async () => null, persist: async () => undefined }),
  /** Deleting the saved record is what clears a record the core cannot read. */
  deleteWalletState: async (walletId: string) => {
    calls.push(["deleteWalletState", walletId]);
    state.corrupt = null;
  },
};
