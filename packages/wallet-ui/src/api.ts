/**
 * The app's single entry point to the wallet.
 *
 * Everything wallet-shaped runs in the webview against the WASM core held in
 * `session.handle`, with public state in IndexedDB. The shell — Tauri window or
 * browser tab — is reached only through `Platform`: it owns the config record,
 * the remembered-wallet record and the key store. Nothing else crosses that
 * boundary, and no secret is ever persisted by this module.
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
  GeneratedKey,
  GeneratedMnemonic,
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
import { historyResetFixes, MAX_FEE_RATE_SAT_VB, NETWORK_LABELS, WalletError } from "./types";
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
 * The sync time and the last broadcast belong to a particular wallet, so they
 * are dropped here rather than by each caller. Eight call sites cleared them by
 * hand and the one behind "Forget this wallet" did not, which is how a fresh
 * wallet came up wearing the previous one's sync time.
 */
function releaseWallet(): void {
  const wallet = session.handle;
  session.handle = null;
  session.wallet = null;
  session.lastSyncedAt = null;
  session.lastResult = null;
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
 * Serializes `openWallet`'s remember step across every open attempt: each
 * call to `fn` waits for every previously queued one to settle first,
 * whether that one resolved or threw, so no two attempts' keystore and
 * remembered-record writes ever interleave. `install`'s own commit needs no
 * queue - it has nothing left to await between its staleness check and the
 * write - but the writes here are each a separate round trip, and it is
 * exactly the gap between them a newer attempt could otherwise land in.
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

  // Two opens can race — the same screen firing two of its own buttons
  // (Key's "Open wallet" and "Follow this wallet"), or a slower render
  // outliving the navigation that already started a faster one. A
  // route/wallet guard in the caller only ever catches this after the
  // fact, once one of them has already written `session` — so the guard
  // belongs here instead, on the write itself. Everything above this line
  // can be interleaved by a newer `install` call bumping `openAttempt`;
  // nothing below it awaits, so once a call reaches this check, whether it
  // is still the newest one cannot change out from under it before
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
 * identity, and the OS keystore already guards the words.
 */
async function openWallet(
  secret: string,
  addressType: AddressType,
  remember: boolean,
  passphrase?: string,
): Promise<WalletInfo> {
  const { network } = await requireConfig();
  const { info, attempt } = await install(secret, network, addressType, passphrase);
  if (remember) {
    await serializeRemember(async () => {
      // Checked fresh at the start of this attempt's turn, not before
      // queuing for one: a newer attempt only has to have started, not
      // committed, to make this one stale - a check against `session.wallet`
      // here would still be looking at whatever was active before either of
      // them, since the newer one has not written it yet either. Nothing
      // else can be touching the keystore or the remembered record while
      // this turn holds the queue, so only what happened before the turn
      // began matters; there is nothing concurrent left to race.
      if (!stillCurrent(attempt)) {
        throw new WalletError("superseded", "a newer wallet-open request replaced this one");
      }
      await platform().rememberSecret(info.wallet_id, secret, passphrase);
      if (!stillCurrent(attempt)) {
        // The entry just written above can only be this attempt's own -
        // nothing else could have raced to write it while this turn held
        // the queue - so it is safe to remove outright before conceding.
        // Left alone, forgetWallet would never find it: it only follows
        // whatever the remembered record already points to, and
        // setRemembered below is exactly the call this path skips.
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
): Promise<WalletInfo> {
  return withHistoryReset(
    async () => walletIdForKey(secret, (await requireConfig()).network, addressType, passphrase),
    () => openWallet(secret, addressType, remember, passphrase),
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
 * Opens the remembered wallet with the key loaded from the OS keystore. The
 * stored entry carries the passphrase too, so unlocking never asks for one.
 *
 * `resetHistory` is `withHistoryReset` around the open. It is decided here,
 * past the keystore read, so a reset asks the OS for the key once.
 */
async function unlockWallet(resetHistory = false): Promise<WalletInfo> {
  const notRemembered = () =>
    new WalletError("not_remembered", "no wallet is saved on this device");
  const record = await platform().getRemembered();
  if (!record) throw notRemembered();
  // `install` keeps the settings' server and swaps only the network in, so a
  // wallet from another network would sync against the wrong chain.
  const config = await requireConfig();
  if (record.network !== config.network) {
    const saved = NETWORK_LABELS[record.network];
    throw new WalletError(
      "wrong_network",
      `The wallet saved on this device is on ${saved}. Choose ${saved} in Setup to open it.`,
    );
  }
  const stored = await platform().loadSecret(record.wallet_id);
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

async function syncWallet(): Promise<Balance> {
  const wallet = requireWallet();
  await wallet.sync();
  return wallet.balance();
}

async function rescanWallet(stopGap: number): Promise<Balance> {
  const wallet = requireWallet();
  await wallet.rescan(stopGap);
  return wallet.balance();
}

/** Holds the unsigned PSBT for `signAndBroadcast` and hands the screen its preview. */
function retainPsbt(built: BuiltTx): TxPreview {
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

function requireRate(feeRateSatVb: number): void {
  // Same code for the whole invalid class as the core's own
  // fee_rate_from_sat_vb, so a screen branching on `invalid_fee_rate` sees
  // it regardless of which of these two conditions actually caught it.
  if (!Number.isFinite(feeRateSatVb) || feeRateSatVb <= 0) {
    throw new WalletError("invalid_fee_rate", "fee rate must be a positive number");
  }
  if (feeRateSatVb > MAX_FEE_RATE_SAT_VB) {
    throw new WalletError(
      "invalid_fee_rate",
      `fee rate must be at most ${MAX_FEE_RATE_SAT_VB} sat/vB`,
    );
  }
}

/**
 * A payment. With `coins`, it is funded by those coins and no others, and
 * every one of them is spent.
 */
async function buildTransfer(
  recipients: Recipient[],
  feeRateSatVb: number,
  coins?: readonly CoinId[],
): Promise<TxPreview> {
  requireRate(feeRateSatVb);
  const wallet = requireWallet();
  return retainPsbt(
    await (coins
      ? wallet.build_transfer_from(coins, recipients, feeRateSatVb)
      : wallet.build_transfer(recipients, feeRateSatVb)),
  );
}

/**
 * Everything to one address — or, with `coins`, all of those coins. The
 * preview's `total_out_sat` is what arrives.
 */
async function buildDrain(
  address: string,
  feeRateSatVb: number,
  coins?: readonly CoinId[],
): Promise<TxPreview> {
  requireRate(feeRateSatVb);
  const wallet = requireWallet();
  return retainPsbt(
    await (coins
      ? wallet.build_drain_from(coins, address, feeRateSatVb)
      : wallet.build_drain(address, feeRateSatVb)),
  );
}

/**
 * Replacement for an unconfirmed transaction of ours at a higher rate. The
 * preview is interchangeable with `buildTransfer`'s: confirm it the same way.
 */
async function buildFeeBump(txid: string, feeRateSatVb: number): Promise<TxPreview> {
  requireRate(feeRateSatVb);
  return retainPsbt(await requireWallet().build_fee_bump(txid, feeRateSatVb));
}

/**
 * Takes back an unconfirmed send: a replacement paying all of it, less the
 * fee, to us. Its preview has `total_out_sat` 0 and everything in `change_sat`.
 */
async function buildCancel(txid: string, feeRateSatVb: number): Promise<TxPreview> {
  requireRate(feeRateSatVb);
  return retainPsbt(await requireWallet().build_cancel(txid, feeRateSatVb));
}

/**
 * Speeds up an unconfirmed transaction, incoming ones included, with a child
 * that spends our output of it: the two together pay `packageRateSatVb`.
 */
async function buildCpfp(txid: string, packageRateSatVb: number): Promise<TxPreview> {
  requireRate(packageRateSatVb);
  return retainPsbt(await requireWallet().build_cpfp(txid, packageRateSatVb));
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
  generateKey: (network: Network, addressType: AddressType): Promise<GeneratedKey> =>
    generateKey(network, addressType),
  generateMnemonic: (
    network: Network,
    addressType: AddressType,
    wordCount: number,
  ): Promise<GeneratedMnemonic> => generateMnemonic(network, addressType, wordCount),
  validateMnemonic: (words: string): Promise<void> => validateMnemonic(words),
  openWallet: (secret: string, addressType: AddressType, remember: boolean, passphrase?: string) =>
    openWallet(secret, addressType, remember, passphrase),
  /**
   * `openWallet` for a wallet whose saved history here cannot be read: that
   * history is deleted and the wallet opened again. The key store and the
   * settings are not touched.
   */
  resetHistoryAndOpen: (
    secret: string,
    addressType: AddressType,
    remember: boolean,
    passphrase?: string,
  ) => resetHistoryAndOpen(secret, addressType, remember, passphrase),
  closeWallet: async (): Promise<void> => releaseWallet(),
  getRemembered: (): Promise<RememberedWallet | null> => platform().getRemembered(),
  unlockWallet: () => unlockWallet(),
  /** `unlockWallet` for such a wallet, the same way; its key stays in the keystore. */
  resetHistoryAndUnlock: () => unlockWallet(true),
  forgetWallet: () => forgetWallet(),
  sync: (): Promise<Balance> => holdOpen(syncWallet),
  /** Look `stopGap` unused addresses past the last used one, then re-read the balance. */
  rescan: (stopGap: number): Promise<Balance> => holdOpen(() => rescanWallet(stopGap)),
  newAddress: (): Promise<string> => newAddress(),
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
  buildTransfer: (recipients: Recipient[], feeRateSatVb: number, coins?: readonly CoinId[]) =>
    buildTransfer(recipients, feeRateSatVb, coins),
  buildDrain: (address: string, feeRateSatVb: number, coins?: readonly CoinId[]) =>
    buildDrain(address, feeRateSatVb, coins),
  buildFeeBump: (txid: string, feeRateSatVb: number) => buildFeeBump(txid, feeRateSatVb),
  buildCancel: (txid: string, feeRateSatVb: number) => buildCancel(txid, feeRateSatVb),
  buildCpfp: (txid: string, packageRateSatVb: number) => buildCpfp(txid, packageRateSatVb),
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
