/**
 * The wallet core, running in the webview.
 *
 * `wallet-wasm` is the one wallet implementation: this module initializes the
 * WebAssembly binary once (lazily, on first use) and re-exports its API with
 * the app's own types instead of the generated `any`. No wallet operation goes
 * through Tauri.
 *
 * Shape mismatches are normalized here so the rest of the app never sees them:
 * `estimate_fee` arrives as a `Map` because `serde-wasm-bindgen` maps Rust maps
 * to JS `Map`s, and a Rust `None` inside a result arrives as `undefined` where
 * the app's types say `null`. Names need no translation: the core accepts and
 * returns the same address-type names the app uses.
 */

import type {
  AddressType,
  AppConfig,
  Balance,
  CoinId,
  FeeEstimate,
  GeneratedKey,
  GeneratedMnemonic,
  Network,
  PsbtReview,
  PublicDescriptors,
  Recipient,
  TxDetail,
  TxPreview,
  TxSummary,
  Utxo,
} from "../types";
import {
  toFeeEstimate,
  toPsbtReview,
  toPublicDescriptors,
  toTxDetail,
  toTxSummary,
  toUtxo,
} from "./normalize";
import init, {
  explorer_tx_url,
  generate_key,
  generate_mnemonic,
  validate_mnemonic,
  Wallet,
  wallet_id_for_key,
} from "./pkg/wallet_wasm.js";
import wasmUrl from "./pkg/wallet_wasm_bg.wasm?url";

/** Public wallet state the core hands to the platform for storage. */
export interface WalletPersister {
  /** Everything stored for this wallet so far, or `null` when nothing is. */
  initialize(): Promise<string | null>;
  /** Replace the stored record with the aggregated changeset. */
  persist(json: string): Promise<void>;
}

/** Unsigned transaction from `build_transfer`; the PSBT stays in the app. */
export interface BuiltTx extends Omit<TxPreview, "psbt_id"> {
  psbt_base64: string;
}

/** Broadcast outcome. A set `persist_error` means the send succeeded anyway. */
export interface Broadcast {
  txid: string;
  persist_error: string | null;
}

let ready: Promise<void> | null = null;

/** Instantiates the module once. Every export below awaits this first. */
function load(): Promise<void> {
  ready ??= init({ module_or_path: wasmUrl })
    .then(() => undefined)
    .catch((e: unknown) => {
      ready = null;
      throw e;
    });
  return ready;
}

/** An open wallet. Every chain operation runs here, in the webview. */
export class WalletApi {
  private readonly inner: Wallet;

  private constructor(inner: Wallet) {
    this.inner = inner;
  }

  /**
   * Open (or create) the wallet for `secret`, backed by `persister`.
   *
   * `passphrase` is the optional BIP39 one and applies only to a mnemonic. It
   * is part of the seed, so the same words under a different passphrase are a
   * different wallet with a different id: `persister` has to be the one for
   * that id (see `walletIdForKey`).
   */
  static async open(
    config: AppConfig,
    secret: string,
    persister: WalletPersister,
    passphrase?: string,
  ): Promise<WalletApi> {
    await load();
    return new WalletApi(await Wallet.open(config, secret, persister, passphrase));
  }

  get id(): string {
    return this.inner.id;
  }

  get network(): Network {
    return this.inner.network as Network;
  }

  /** A BIP32 account (mnemonic) rather than a single key. */
  get isHd(): boolean {
    return this.inner.is_hd;
  }

  /** Derives a range of addresses. Ranged without being HD is possible. */
  get isRanged(): boolean {
    return this.inner.is_ranged;
  }

  /** Public keys only: watches and receives, cannot sign. */
  get isWatchOnly(): boolean {
    return this.inner.is_watch_only;
  }

  address(): Promise<string> {
    return this.inner.address();
  }

  /** Reveal a fresh receive address. A single-key wallet returns its one address. */
  newAddress(): Promise<string> {
    return this.inner.new_address();
  }

  sync(): Promise<void> {
    return this.inner.sync();
  }

  /**
   * Walk the keychains from the start again, `stopGap` unused addresses past
   * the last used one. For a restored wallet that shows too little.
   */
  rescan(stopGap: number): Promise<void> {
    return this.inner.rescan(stopGap);
  }

  /** The public half of the wallet, for a watch-only copy elsewhere. */
  async public_descriptors(): Promise<PublicDescriptors> {
    return toPublicDescriptors(await this.inner.public_descriptors());
  }

  /** Full detail of one of our transactions, or `null` for an unknown txid. */
  async transaction(txid: string): Promise<TxDetail | null> {
    const raw: unknown = await this.inner.transaction(txid);
    return raw === null || raw === undefined ? null : toTxDetail(raw);
  }

  async balance(): Promise<Balance> {
    return (await this.inner.balance()) as Balance;
  }

  async list_utxos(): Promise<Utxo[]> {
    const rows = (await this.inner.list_utxos()) as unknown[];
    return rows.map(toUtxo);
  }

  /** Freeze a coin or unfreeze it; the choice is saved with the wallet. */
  set_frozen(coin: CoinId, frozen: boolean): Promise<void> {
    return this.inner.set_frozen(coin.txid, coin.vout, frozen);
  }

  async list_transactions(): Promise<TxSummary[]> {
    const rows = (await this.inner.list_transactions()) as unknown[];
    return rows.map(toTxSummary);
  }

  async estimate_fee(): Promise<FeeEstimate> {
    return toFeeEstimate(await this.inner.estimate_fee());
  }

  async build_transfer(recipients: Recipient[], feeRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_transfer(recipients, feeRateSatVb)) as BuiltTx;
  }

  /** `build_transfer` funded by `coins` alone; every one of them is spent. */
  async build_transfer_from(
    coins: readonly CoinId[],
    recipients: Recipient[],
    feeRateSatVb: number,
  ): Promise<BuiltTx> {
    return (await this.inner.build_transfer_from(coins, recipients, feeRateSatVb)) as BuiltTx;
  }

  /**
   * Everything the wallet has, to one address, minus the fee. `total_out_sat`
   * is exactly what arrives: there is no change output to absorb a rounding.
   */
  async build_drain(address: string, feeRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_drain(address, feeRateSatVb)) as BuiltTx;
  }

  /** `build_drain` of `coins` alone: all of them, less the fee, to one address. */
  async build_drain_from(
    coins: readonly CoinId[],
    address: string,
    feeRateSatVb: number,
  ): Promise<BuiltTx> {
    return (await this.inner.build_drain_from(coins, address, feeRateSatVb)) as BuiltTx;
  }

  /**
   * Replacement for an unconfirmed transaction of ours at a higher fee rate.
   * Same shape as `build_transfer`, so it signs and broadcasts the same way.
   */
  async build_fee_bump(txid: string, feeRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_fee_bump(txid, feeRateSatVb)) as BuiltTx;
  }

  /** A replacement paying all of an unconfirmed send back to us. */
  async build_cancel(txid: string, feeRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_cancel(txid, feeRateSatVb)) as BuiltTx;
  }

  /** A child spending our output of `txid`, so the pair pays the package rate. */
  async build_cpfp(txid: string, packageRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_cpfp(txid, packageRateSatVb)) as BuiltTx;
  }

  sign(psbtBase64: string): Promise<string> {
    return this.inner.sign(psbtBase64);
  }

  /** Reads a PSBT made elsewhere (base64 or hex). Signs nothing. */
  async import_psbt(psbt: string): Promise<PsbtReview> {
    return toPsbtReview(await this.inner.import_psbt(psbt));
  }

  /** Signs every input of ours in a PSBT made elsewhere, and finalizes what it can. */
  async sign_psbt(psbt: string): Promise<PsbtReview> {
    return toPsbtReview(await this.inner.sign_psbt(psbt));
  }

  async broadcast(signedPsbtBase64: string): Promise<Broadcast> {
    const out = (await this.inner.broadcast(signedPsbtBase64)) as {
      txid: string;
      persist_error?: string | null;
    };
    // `None` crosses as `undefined`; the UI contract is `string | null`.
    return { txid: out.txid, persist_error: out.persist_error ?? null };
  }

  /** Releases the WASM instance. The handle is unusable afterwards. */
  free(): void {
    this.inner.free();
  }
}

/** Wraps `call` to instantiate the module first, as every plain call below needs. */
function afterLoad<A extends unknown[], R>(call: (...args: A) => R): (...args: A) => Promise<R> {
  return async (...args) => {
    await load();
    return call(...args);
  };
}

/** Generate a fresh key. The only call that returns secret material. */
export const generateKey = afterLoad(
  (network: Network, addressType: AddressType) =>
    generate_key(network, addressType) as GeneratedKey,
);

/**
 * Generate a fresh BIP39 phrase and the account's first address. Returns secret
 * material: hand `words` to the user once and never persist it.
 */
export const generateMnemonic = afterLoad(
  (network: Network, addressType: AddressType, wordCount: number) =>
    generate_mnemonic(network, addressType, wordCount) as GeneratedMnemonic,
);

/** Throws with a readable reason when `words` is not a valid BIP39 phrase. */
export const validateMnemonic = afterLoad((words: string) => validate_mnemonic(words));

/**
 * Non-secret wallet id: the IndexedDB record key and the OS-keystore entry name.
 *
 * `passphrase` belongs in the id, not beside it — the same words under two
 * passphrases are two wallets, and this is what keeps them from sharing a
 * stored record or a keychain entry.
 */
export const walletIdForKey = afterLoad(
  (secret: string, network: Network, addressType: AddressType, passphrase?: string) =>
    wallet_id_for_key(secret, network, addressType, passphrase),
);

/**
 * Block-explorer page for a txid, on the explorer fronting `backendUrl` when it
 * has one; `null` on regtest, where there is nothing public to open.
 */
export const explorerTxUrl = afterLoad(
  (network: Network, backendUrl: string, txid: string) =>
    explorer_tx_url(network, backendUrl, txid) ?? null,
);
