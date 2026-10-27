/**
 * The app's single entry point to the wallet: the WASM core held in
 * `session.handle`, and the shell through `Platform`. No secret is ever
 * persisted by this module.
 */

import { deleteWalletState, makePersister } from "./persist/indexeddb";
import { platform } from "./platform";
import { session } from "./session";
import type {
  AddressType,
  AppConfig,
  Balance,
  BroadcastResult,
  CoinId,
  FeeEstimate,
  Network,
  PsbtReview,
  PublicDescriptors,
  Recipient,
  RememberedWallet,
  TxDetail,
  TxPreview,
  TxSummary,
  Utxo,
  WalletInfo,
} from "./types";
import { feeRateError, historyResetFixes, NETWORK_LABELS, WalletError } from "./types";
import type { BuiltTx } from "./wasm";
import {
  explorerTxUrl,
  generateKey,
  generateMnemonic,
  validateMnemonic,
  WalletApi,
  walletIdForKey,
} from "./wasm";

/** PSBTs awaiting confirmation, keyed by the id handed to the Send screen. */
const pending = new Map<string, string>();
let psbtCounter = 0;

function requireWallet(): WalletApi {
  const wallet = session.handle;
  if (!wallet) throw new WalletError("no_wallet", "no wallet is open");
  return wallet;
}

async function requireConfig(): Promise<AppConfig> {
  const config = session.config ?? (await platform().getConfig());
  if (!config) throw new WalletError("no_config", "the app is not configured yet");
  session.config = config;
  return config;
}

/**
 * Drops the open wallet and everything derived from it.
 *
 * The sync time, the last broadcast and any coins chosen for a send belong to
 * the open wallet, so they are dropped with it.
 */
function releaseWallet(): void {
  const wallet = session.handle;
  session.handle = null;
  session.wallet = null;
  session.lastSyncedAt = null;
  session.lastResult = null;
  session.chosenCoins = null;
  pending.clear();
  wallet?.free();
}

/**
 * Syncs, rescans and broadcasts still running. Closing the wallet under one
 * pulls the handle out from under it: a sync loses what it found, and a
 * broadcast can reach the network without reaching this device's record. The
 * background lock waits for them (`whenIdle`); Close wallet, which the user
 * asks for, does not.
 */
const unfinished = new Set<Promise<unknown>>();

/** Runs `work`, counted among the unfinished until it settles. */
async function holdOpen<T>(work: () => Promise<T>): Promise<T> {
  const running = work();
  unfinished.add(running);
  try {
    return await running;
  } finally {
    unfinished.delete(running);
  }
}

/** Resolves once no sync, rescan or broadcast is running: at once when none is. */
export async function whenIdle(): Promise<void> {
  // One can start as another ends, so this waits until none is left.
  while (unfinished.size > 0) await Promise.allSettled(unfinished);
}

/** Ordinal of the most recently started `install` call; only the newest may commit. */
let openAttempt = 0;

/** Whether `attempt` (from `install`) is still the newest one anyone has started. */
function stillCurrent(attempt: number): boolean {
  return attempt === openAttempt;
}

/**
 * Serializes `openWallet`'s remember step across open attempts: each call to
 * `fn` waits for every one queued before it to settle, so no two attempts'
 * keystore and remembered-record writes interleave. `install`'s commit needs
 * no queue, as nothing is awaited between its check and its write; these
 * writes are separate round trips, and a newer attempt could land between.
 */
let rememberQueue: Promise<unknown> = Promise.resolve();
function serializeRemember<T>(fn: () => Promise<T>): Promise<T> {
  const turn = rememberQueue.then(fn, fn);
  rememberQueue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

/**
 * Opens the wallet for `secret` against `network`/`addressType`, backed by the
 * IndexedDB record for its wallet id. The secret is used here and dropped.
 *
 * `passphrase` is the optional BIP39 one. It goes into the wallet id as much as
 * the words do, so the same phrase under two passphrases gets two ids — two
 * IndexedDB records and two keystore entries, never a collision.
 *
 * Returns the attempt's own ordinal alongside `info` so a caller that keeps
 * working after this resolves — `openWallet` persists a remembered secret —
 * can keep calling `stillCurrent` for as long as it keeps touching shared
 * state, not just for the commit this function already guarded.
 */
async function install(
  secret: string,
  network: Network,
  addressType: AddressType,
  passphrase?: string,
): Promise<{ info: WalletInfo; attempt: number }> {
  const attempt = ++openAttempt;
  const base = await requireConfig();
  const config: AppConfig = { ...base, network, address_type: addressType };
  const walletId = await walletIdForKey(secret, network, addressType, passphrase);
  const wallet = await WalletApi.open(config, secret, makePersister(walletId), passphrase);
  const address = await wallet.address();

  // Two opens can race: Key's two buttons, or a slower render outliving the
  // navigation that started a faster one. A guard in the caller would catch
  // that only after one had written `session`, so the check is here, on the
  // write. Nothing below it awaits, so the answer cannot change before
  // `session` is written.
  if (!stillCurrent(attempt)) {
    wallet.free();
    throw new WalletError("superseded", "a newer wallet-open request replaced this one");
  }

  releaseWallet();
  session.handle = wallet;
  const info: WalletInfo = {
    address,
    network,
    address_type: addressType,
    wallet_id: wallet.id,
    is_hd: wallet.isHd,
    is_ranged: wallet.isRanged,
    is_watch_only: wallet.isWatchOnly,
  };
  session.wallet = info;
  return { info, attempt };
}

/**
 * Opens the wallet the user just entered, optionally saving its key.
 *
 * "Remember" stores the passphrase with the words: the two are one wallet's
 * identity, and the key store already guards the words. In the browser that
 * store seals both under `appPassword`, which is not the BIP39 passphrase:
 * it locks only this browser's copy.
 */
async function openWallet(
  secret: string,
  addressType: AddressType,
  remember: boolean,
  passphrase?: string,
  appPassword?: string,
): Promise<WalletInfo> {
  const { network } = await requireConfig();
  const { info, attempt } = await install(secret, network, addressType, passphrase);
  if (remember) {
    await serializeRemember(async () => {
      // Checked at the start of this attempt's turn: a newer attempt only has
      // to have started to make this one stale, which `session.wallet` would
      // not show yet. Nothing else touches the keystore or the record while
      // this turn holds the queue.
      if (!stillCurrent(attempt)) {
        throw new WalletError("superseded", "a newer wallet-open request replaced this one");
      }
      await platform().rememberSecret(info.wallet_id, secret, passphrase, appPassword);
      if (!stillCurrent(attempt)) {
        // The entry just written is this attempt's own, as the turn holds the
        // queue, so it is removed before conceding. Left, `forgetWallet`
        // would never find it: it follows the remembered record, which this
        // path does not write.
        await platform().forgetSecret(info.wallet_id);
        throw new WalletError("superseded", "a newer wallet-open request replaced this one");
      }
      const record: RememberedWallet = {
        wallet_id: info.wallet_id,
        address: info.address,
        network: info.network,
        address_type: info.address_type,
      };
      await platform().setRemembered(record);
    });
  }
  return info;
}

/**
 * Runs `open`, and when what stops it is the wallet's saved history on this
 * device (`historyResetFixes`), deletes that history, nothing else, and runs
 * it once more. The key and the settings stay; the next sync downloads the
 * history back.
 *
 * `open` goes first so that only a record which has just failed to read is
 * ever deleted, whatever a screen holds by the time its reset is confirmed:
 * a readable record is left alone, and so is one a newer version saved.
 */
async function withHistoryReset(
  walletId: () => Promise<string>,
  open: () => Promise<WalletInfo>,
): Promise<WalletInfo> {
  try {
    return await open();
  } catch (e) {
    if (!historyResetFixes(e)) throw e;
  }
  await deleteWalletState(await walletId());
  return open();
}

/** `openWallet`, resetting the wallet's saved history here if it cannot be read. */
async function resetHistoryAndOpen(
  secret: string,
  addressType: AddressType,
  remember: boolean,
  passphrase?: string,
  appPassword?: string,
): Promise<WalletInfo> {
  return withHistoryReset(
    async () => walletIdForKey(secret, (await requireConfig()).network, addressType, passphrase),
    () => openWallet(secret, addressType, remember, passphrase, appPassword),
  );
}

/**
 * Whether Unlock can open the remembered wallet now: this device keeps keys,
 * one is remembered, and it is on the network the settings name. The settings
 * hold one server, so a wallet remembered on another network would otherwise
 * be opened against a server for the wrong chain.
 */
export function canUnlockHere(): boolean {
  const record = session.remembered;
  return (
    platform().canRememberWallet && record !== null && record.network === session.config?.network
  );
}

/**
 * Opens the remembered wallet with the key loaded from the key store. The
 * stored entry carries the BIP39 passphrase too, so unlocking never asks for
 * that one. The browser's store opens only with `appPassword`, and a wrong one
 * fails as `wrong_password` before anything is opened.
 *
 * `resetHistory` is `withHistoryReset` around the open. It is decided here,
 * past the keystore read, so a reset reads the key once: one OS prompt, or one
 * app password check.
 */
async function unlockWallet(resetHistory: boolean, appPassword?: string): Promise<WalletInfo> {
  const notRemembered = () =>
    new WalletError("not_remembered", "no wallet is saved on this device");
  const record = await platform().getRemembered();
  if (!record) throw notRemembered();
  const config = await requireConfig();
  if (record.network !== config.network) {
    const saved = NETWORK_LABELS[record.network];
    throw new WalletError(
      "wrong_network",
      `The wallet saved on this device is on ${saved}. Choose ${saved} in Setup to open it.`,
    );
  }
  // Only a password actually given is passed on: an OS keystore loads by
  // wallet id alone.
  const stored = await (appPassword === undefined
    ? platform().loadSecret(record.wallet_id)
    : platform().loadSecret(record.wallet_id, appPassword));
  if (!stored?.secret) throw notRemembered();
  const { secret, passphrase } = stored;
  const open = async () =>
    (await install(secret, record.network, record.address_type, passphrase ?? undefined)).info;
  return resetHistory ? withHistoryReset(async () => record.wallet_id, open) : open();
}

/** Removes the keystore entry, the local wallet state and the remembered record. */
async function forgetWallet(): Promise<void> {
  const record = await platform().getRemembered();
  if (record) {
    await platform().forgetSecret(record.wallet_id);
    await deleteWalletState(record.wallet_id);
  }
  await platform().setRemembered(null);
  releaseWallet();
}

/**
 * Reveals the next unused receive address (HD only) and updates the open
 * wallet's description, so every screen shows the same one.
 */
async function newAddress(): Promise<string> {
  const address = await requireWallet().newAddress();
  const info = session.wallet;
  if (info) session.wallet = { ...info, address };
  return address;
}

/** Runs `work` on the open wallet, then reads its balance. */
async function thenBalance(work: (wallet: WalletApi) => Promise<void>): Promise<Balance> {
  const wallet = requireWallet();
  await work(wallet);
  return wallet.balance();
}

/**
 * Checks `feeRateSatVb`, builds with the open wallet, holds the unsigned PSBT
 * for `signAndBroadcast` and hands the screen its preview.
 */
async function buildPreview(
  feeRateSatVb: number,
  build: (wallet: WalletApi) => Promise<BuiltTx>,
): Promise<TxPreview> {
  // The screens' check, stricter than the core's (which takes 0), thrown under
  // the core's code so `errorMessage` words it as it words the core's refusal.
  const rateErr = feeRateError(feeRateSatVb);
  if (rateErr) throw new WalletError("invalid_fee_rate", rateErr);
  const built = await build(requireWallet());
  const psbtId = `${Date.now().toString(16)}-${(psbtCounter++).toString(16)}`;
  pending.set(psbtId, built.psbt_base64);
  return {
    psbt_id: psbtId,
    fee_sat: built.fee_sat,
    vsize: built.vsize,
    total_out_sat: built.total_out_sat,
    change_sat: built.change_sat,
    input_count: built.input_count,
  };
}

async function signAndBroadcast(psbtId: string): Promise<BroadcastResult> {
  const wallet = requireWallet();
  const psbt = pending.get(psbtId);
  if (psbt === undefined) {
    throw new WalletError("unknown_psbt", "transaction preview expired; build it again");
  }
  pending.delete(psbtId);
  return broadcastSigned(wallet, await wallet.sign(psbt));
}

/** Sends a final PSBT; the core refuses one with an input still unsigned. */
async function broadcastSigned(wallet: WalletApi, signed: string): Promise<BroadcastResult> {
  // Network acceptance and local persistence are reported separately by the
  // core: a persist failure must not be shown as a failed send.
  const out = await wallet.broadcast(signed);
  return {
    txid: out.txid,
    explorer_url: await explorerTxUrl(wallet.network, session.config?.backend.url ?? "", out.txid),
    persist_error: out.persist_error,
  };
}

export const api = {
  getConfig: (): Promise<AppConfig | null> => platform().getConfig(),
  setConfig: (config: AppConfig): Promise<void> => platform().setConfig(config),
  generateKey,
  generateMnemonic,
  validateMnemonic,
  openWallet,
  resetHistoryAndOpen,
  closeWallet: async (): Promise<void> => releaseWallet(),
  getRemembered: (): Promise<RememberedWallet | null> => platform().getRemembered(),
  /** `appPassword` is the browser's, typed on Unlock; an OS keystore needs none. */
  unlockWallet: (appPassword?: string) => unlockWallet(false, appPassword),
  /** `unlockWallet` for such a wallet, the same way; its key stays in the keystore. */
  resetHistoryAndUnlock: (appPassword?: string) => unlockWallet(true, appPassword),
  forgetWallet,
  sync: (): Promise<Balance> => holdOpen(() => thenBalance((wallet) => wallet.sync())),
  /** Look `stopGap` unused addresses past the last used one, then re-read the balance. */
  rescan: (stopGap: number): Promise<Balance> =>
    holdOpen(() => thenBalance((wallet) => wallet.rescan(stopGap))),
  newAddress,
  publicDescriptors: (): Promise<PublicDescriptors> => requireWallet().public_descriptors(),
  transaction: (txid: string): Promise<TxDetail | null> => requireWallet().transaction(txid),
  /** Block-explorer page for a txid, or `null` where none exists. */
  explorerUrl: async (txid: string): Promise<string | null> => {
    const wallet = requireWallet();
    return explorerTxUrl(wallet.network, session.config?.backend.url ?? "", txid);
  },
  getBalance: async (): Promise<Balance> => requireWallet().balance(),
  listUtxos: async (): Promise<Utxo[]> => requireWallet().list_utxos(),
  /** A frozen coin stays out of every send, and of the spendable balance, until unfrozen. */
  setFrozen: async (coin: CoinId, frozen: boolean): Promise<void> =>
    requireWallet().set_frozen(coin, frozen),
  listTransactions: async (): Promise<TxSummary[]> => requireWallet().list_transactions(),
  estimateFee: async (): Promise<FeeEstimate> => requireWallet().estimate_fee(),
  /**
   * A payment. With `coins`, it is funded by those coins and no others, and
   * every one of them is spent.
   */
  buildTransfer: (recipients: Recipient[], feeRateSatVb: number, coins?: readonly CoinId[]) =>
    buildPreview(feeRateSatVb, (wallet) =>
      coins
        ? wallet.build_transfer_from(coins, recipients, feeRateSatVb)
        : wallet.build_transfer(recipients, feeRateSatVb),
    ),
  /**
   * Everything to one address — or, with `coins`, all of those coins. The
   * preview's `total_out_sat` is what arrives.
   */
  buildDrain: (address: string, feeRateSatVb: number, coins?: readonly CoinId[]) =>
    buildPreview(feeRateSatVb, (wallet) =>
      coins
        ? wallet.build_drain_from(coins, address, feeRateSatVb)
        : wallet.build_drain(address, feeRateSatVb),
    ),
  /**
   * Replacement for an unconfirmed transaction of ours at a higher rate. The
   * preview is interchangeable with `buildTransfer`'s: confirm it the same way.
   */
  buildFeeBump: (txid: string, feeRateSatVb: number) =>
    buildPreview(feeRateSatVb, (wallet) => wallet.build_fee_bump(txid, feeRateSatVb)),
  /**
   * Takes back an unconfirmed send: a replacement paying all of it, less the
   * fee, to us. Its preview has `total_out_sat` 0 and everything in `change_sat`.
   */
  buildCancel: (txid: string, feeRateSatVb: number) =>
    buildPreview(feeRateSatVb, (wallet) => wallet.build_cancel(txid, feeRateSatVb)),
  /**
   * Speeds up an unconfirmed transaction, incoming ones included, with a child
   * that spends our output of it: the two together pay `packageRateSatVb`.
   */
  buildCpfp: (txid: string, packageRateSatVb: number) =>
    buildPreview(packageRateSatVb, (wallet) => wallet.build_cpfp(txid, packageRateSatVb)),
  signAndBroadcast: (psbtId: string) => holdOpen(() => signAndBroadcast(psbtId)),
  /** Reads a PSBT made elsewhere, pasted as base64 or hex. Signs nothing. */
  importPsbt: async (psbt: string): Promise<PsbtReview> => requireWallet().import_psbt(psbt),
  /** Signs every input of ours; the review says whether it can go out yet. */
  signPsbt: async (psbt: string): Promise<PsbtReview> => requireWallet().sign_psbt(psbt),
  /** Sends an imported PSBT once every input is final. */
  broadcastPsbt: (psbt: string): Promise<BroadcastResult> =>
    holdOpen(async () => broadcastSigned(requireWallet(), psbt)),
  discardTx: async (psbtId: string): Promise<void> => {
    pending.delete(psbtId);
  },
} as const;
