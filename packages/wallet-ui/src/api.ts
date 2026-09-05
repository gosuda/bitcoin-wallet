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
  FeeEstimate,
  GeneratedKey,
  GeneratedMnemonic,
  Network,
  PublicDescriptors,
  Recipient,
  RememberedWallet,
  TxDetail,
  TxPreview,
  TxSummary,
  Utxo,
  WalletInfo,
} from "./types";
import { WalletError } from "./types";
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

/** Drops the open wallet and anything derived from it. */
function releaseWallet(): void {
  const wallet = session.handle;
  session.handle = null;
  session.wallet = null;
  pending.clear();
  wallet?.free();
}

/**
 * Opens the wallet for `secret` against `network`/`addressType`, backed by the
 * IndexedDB record for its wallet id. The secret is used here and dropped.
 *
 * `passphrase` is the optional BIP39 one. It goes into the wallet id as much as
 * the words do, so the same phrase under two passphrases gets two ids — two
 * IndexedDB records and two keystore entries, never a collision.
 */
async function install(
  secret: string,
  network: Network,
  addressType: AddressType,
  passphrase?: string,
): Promise<WalletInfo> {
  const base = await requireConfig();
  const config: AppConfig = { ...base, network, address_type: addressType };
  const walletId = await walletIdForKey(secret, network, addressType, passphrase);
  const wallet = await WalletApi.open(config, secret, makePersister(walletId), passphrase);

  releaseWallet();
  session.handle = wallet;
  const info: WalletInfo = {
    address: await wallet.address(),
    network,
    address_type: addressType,
    wallet_id: wallet.id,
    is_hd: wallet.isHd,
    is_watch_only: wallet.isWatchOnly,
  };
  session.wallet = info;
  return info;
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
  const info = await install(secret, network, addressType, passphrase);
  if (remember) {
    await platform().rememberSecret(info.wallet_id, secret, passphrase);
    const record: RememberedWallet = {
      wallet_id: info.wallet_id,
      address: info.address,
      network: info.network,
      address_type: info.address_type,
    };
    await platform().setRemembered(record);
  }
  return info;
}

/**
 * Opens the remembered wallet with the key loaded from the OS keystore. The
 * stored entry carries the passphrase too, so unlocking never asks for one.
 */
async function unlockWallet(): Promise<WalletInfo> {
  const notRemembered = () =>
    new WalletError("not_remembered", "no wallet is saved on this device");
  const record = await platform().getRemembered();
  if (!record) throw notRemembered();
  const stored = await platform().loadSecret(record.wallet_id);
  if (!stored?.secret) throw notRemembered();
  return install(
    stored.secret,
    record.network,
    record.address_type,
    stored.passphrase ?? undefined,
  );
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
  if (!Number.isFinite(feeRateSatVb) || feeRateSatVb <= 0) {
    throw new WalletError("build_tx", "fee rate must be a positive number");
  }
}

async function buildTransfer(recipients: Recipient[], feeRateSatVb: number): Promise<TxPreview> {
  requireRate(feeRateSatVb);
  return retainPsbt(await requireWallet().build_transfer(recipients, feeRateSatVb));
}

/** Everything to one address. The preview's `total_out_sat` is what arrives. */
async function buildDrain(address: string, feeRateSatVb: number): Promise<TxPreview> {
  requireRate(feeRateSatVb);
  return retainPsbt(await requireWallet().build_drain(address, feeRateSatVb));
}

/**
 * Replacement for an unconfirmed transaction of ours at a higher rate. The
 * preview is interchangeable with `buildTransfer`'s: confirm it the same way.
 */
async function buildFeeBump(txid: string, feeRateSatVb: number): Promise<TxPreview> {
  requireRate(feeRateSatVb);
  return retainPsbt(await requireWallet().build_fee_bump(txid, feeRateSatVb));
}

async function signAndBroadcast(psbtId: string): Promise<BroadcastResult> {
  const wallet = requireWallet();
  const psbt = pending.get(psbtId);
  if (psbt === undefined) {
    throw new WalletError("unknown_psbt", "transaction preview expired; build it again");
  }
  pending.delete(psbtId);
  const signed = await wallet.sign(psbt);
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
  closeWallet: async (): Promise<void> => releaseWallet(),
  getRemembered: (): Promise<RememberedWallet | null> => platform().getRemembered(),
  unlockWallet: () => unlockWallet(),
  forgetWallet: () => forgetWallet(),
  sync: (): Promise<Balance> => syncWallet(),
  /** Look `stopGap` unused addresses past the last used one, then re-read the balance. */
  rescan: async (stopGap: number): Promise<Balance> => {
    const wallet = requireWallet();
    await wallet.rescan(stopGap);
    return wallet.balance();
  },
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
  listTransactions: async (): Promise<TxSummary[]> => requireWallet().list_transactions(),
  estimateFee: async (): Promise<FeeEstimate> => requireWallet().estimate_fee(),
  buildTransfer: (recipients: Recipient[], feeRateSatVb: number) =>
    buildTransfer(recipients, feeRateSatVb),
  buildDrain: (address: string, feeRateSatVb: number) => buildDrain(address, feeRateSatVb),
  buildFeeBump: (txid: string, feeRateSatVb: number) => buildFeeBump(txid, feeRateSatVb),
  signAndBroadcast: (psbtId: string) => signAndBroadcast(psbtId),
  discardTx: async (psbtId: string): Promise<void> => {
    pending.delete(psbtId);
  },
} as const;
