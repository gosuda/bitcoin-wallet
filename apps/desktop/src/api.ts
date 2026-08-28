/**
 * The app's single entry point to the wallet.
 *
 * Everything wallet-shaped runs in the webview against the WASM core held in
 * `session.handle`, with public state in IndexedDB. Tauri is a native shell:
 * it owns the config store (`get_config` / `set_config`) and the OS keystore
 * (`remember_secret` / `load_secret` / `forget_secret`). Nothing else crosses
 * the IPC boundary, and no secret is ever persisted by this module.
 */

import { invoke } from "@tauri-apps/api/core";
import { load as loadStore } from "@tauri-apps/plugin-store";
import { deleteWalletState, makePersister } from "./persist/indexeddb";
import { session } from "./session";
import type {
  AddressType,
  AppConfig,
  Balance,
  BroadcastResult,
  FeeEstimate,
  GeneratedKey,
  Network,
  Recipient,
  RememberedWallet,
  TxPreview,
  Utxo,
  WalletInfo,
} from "./types";
import { WalletError } from "./types";
import { explorerTxUrl, generateKey, WalletApi, walletIdForKey } from "./wasm";

const STORE_FILE = "config.json";
const REMEMBERED_KEY = "remembered_wallet";

/** PSBTs awaiting confirmation, keyed by the id handed to the Send screen. */
const pending = new Map<string, string>();
let psbtCounter = 0;

function requireWallet(): WalletApi {
  const wallet = session.handle;
  if (!wallet) throw new WalletError("no_wallet", "no wallet is open");
  return wallet;
}

async function requireConfig(): Promise<AppConfig> {
  const config = session.config ?? (await invoke<AppConfig>("get_config"));
  session.config = config;
  return config;
}

async function remembered(): Promise<RememberedWallet | null> {
  const store = await loadStore(STORE_FILE);
  return (await store.get<RememberedWallet>(REMEMBERED_KEY)) ?? null;
}

async function saveRemembered(record: RememberedWallet | null): Promise<void> {
  const store = await loadStore(STORE_FILE);
  if (record) await store.set(REMEMBERED_KEY, record);
  else await store.delete(REMEMBERED_KEY);
  await store.save();
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
 */
async function install(
  secret: string,
  network: Network,
  addressType: AddressType,
): Promise<WalletInfo> {
  const base = await requireConfig();
  const config: AppConfig = { ...base, network, address_type: addressType };
  const walletId = await walletIdForKey(secret, network, addressType);
  const wallet = await WalletApi.open(config, secret, makePersister(walletId));

  releaseWallet();
  session.handle = wallet;
  const info: WalletInfo = {
    address: await wallet.address(),
    network,
    address_type: addressType,
    wallet_id: wallet.id,
  };
  session.wallet = info;
  return info;
}

async function openWallet(
  secret: string,
  addressType: AddressType,
  remember: boolean,
): Promise<WalletInfo> {
  const { network } = await requireConfig();
  const info = await install(secret, network, addressType);
  if (remember) {
    await invoke<void>("remember_secret", { walletId: info.wallet_id, secret });
    const record: RememberedWallet = {
      wallet_id: info.wallet_id,
      address: info.address,
      network: info.network,
      address_type: info.address_type,
    };
    await saveRemembered(record);
  }
  return info;
}

/** Opens the remembered wallet with the key loaded from the OS keystore. */
async function unlockWallet(): Promise<WalletInfo> {
  const notRemembered = () =>
    new WalletError("not_remembered", "no wallet is saved on this device");
  const record = await remembered();
  if (!record) throw notRemembered();
  const secret = await invoke<string | null>("load_secret", { walletId: record.wallet_id });
  if (!secret) throw notRemembered();
  return install(secret, record.network, record.address_type);
}

/** Removes the keystore entry, the local wallet state and the remembered record. */
async function forgetWallet(): Promise<void> {
  const record = await remembered();
  if (record) {
    await invoke<void>("forget_secret", { walletId: record.wallet_id });
    await deleteWalletState(record.wallet_id);
  }
  await saveRemembered(null);
  releaseWallet();
}

async function syncWallet(): Promise<Balance> {
  const wallet = requireWallet();
  await wallet.sync();
  return wallet.balance();
}

async function buildTransfer(recipients: Recipient[], feeRateSatVb: number): Promise<TxPreview> {
  if (!Number.isFinite(feeRateSatVb) || feeRateSatVb <= 0) {
    throw new WalletError("build_tx", "fee rate must be a positive number");
  }
  const built = await requireWallet().build_transfer(recipients, feeRateSatVb);
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
  const signed = await wallet.sign(psbt);
  // Network acceptance and local persistence are reported separately by the
  // core: a persist failure must not be shown as a failed send.
  const out = await wallet.broadcast(signed);
  return {
    txid: out.txid,
    explorer_url: await explorerTxUrl(wallet.network, out.txid),
    persist_error: out.persist_error,
  };
}

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (config: AppConfig) => invoke<void>("set_config", { config }),
  generateKey: (network: Network, addressType: AddressType): Promise<GeneratedKey> =>
    generateKey(network, addressType),
  openWallet: (secret: string, addressType: AddressType, remember: boolean) =>
    openWallet(secret, addressType, remember),
  closeWallet: async (): Promise<void> => releaseWallet(),
  getRemembered: (): Promise<RememberedWallet | null> => remembered(),
  unlockWallet: () => unlockWallet(),
  forgetWallet: () => forgetWallet(),
  sync: (): Promise<Balance> => syncWallet(),
  getBalance: async (): Promise<Balance> => requireWallet().balance(),
  listUtxos: async (): Promise<Utxo[]> => requireWallet().list_utxos(),
  estimateFee: async (): Promise<FeeEstimate> => requireWallet().estimate_fee(),
  buildTransfer: (recipients: Recipient[], feeRateSatVb: number) =>
    buildTransfer(recipients, feeRateSatVb),
  signAndBroadcast: (psbtId: string) => signAndBroadcast(psbtId),
  discardTx: async (psbtId: string): Promise<void> => {
    pending.delete(psbtId);
  },
} as const;
