/**
 * The wallet core, running in the webview.
 *
 * `wallet-wasm` is the one wallet implementation: this module initializes the
 * WebAssembly binary once (lazily, on first use) and re-exports its API with
 * the app's own types instead of the generated `any`. No wallet operation goes
 * through Tauri.
 *
 * Two shape mismatches are normalized here so the rest of the app never sees
 * them: the core spells the nested-segwit type `np2wpkh` in its free functions
 * (config JSON uses the serde name `nested_p2wpkh`), and `estimate_fee`
 * arrives as a `Map` because `serde-wasm-bindgen` maps Rust maps to JS `Map`s.
 */

import type {
  AddressType,
  AppConfig,
  Balance,
  FeeEstimate,
  GeneratedKey,
  GeneratedMnemonic,
  Network,
  PublicDescriptors,
  Recipient,
  TxDetail,
  TxInput,
  TxOutput,
  TxSummary,
  Utxo,
} from "../types";
import init, {
  address_for_key,
  default_esplora_url,
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
export interface BuiltTx {
  psbt_base64: string;
  fee_sat: number;
  vsize: number;
  total_out_sat: number;
  change_sat: number;
  input_count: number;
}

/** Broadcast outcome. A set `persist_error` means the send succeeded anyway. */
export interface Broadcast {
  txid: string;
  persist_error: string | null;
}

/** `AddressType::id` in the core; only the nested form differs from serde's name. */
const CORE_ADDRESS_TYPE: Record<AddressType, string> = {
  p2pk: "p2pk",
  p2pkh: "p2pkh",
  p2wpkh: "p2wpkh",
  nested_p2wpkh: "np2wpkh",
  p2tr: "p2tr",
};

function fromCoreAddressType(id: string): AddressType {
  const found = (Object.keys(CORE_ADDRESS_TYPE) as AddressType[]).find(
    (t) => CORE_ADDRESS_TYPE[t] === id,
  );
  if (!found) throw new Error(`unknown address type '${id}'`);
  return found;
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

/** `sat_per_vb_by_target` arrives as a nested `Map`; flatten it to a record. */
function toFeeEstimate(raw: unknown): FeeEstimate {
  const outer =
    raw instanceof Map
      ? raw.get("sat_per_vb_by_target")
      : (raw as { sat_per_vb_by_target?: unknown }).sat_per_vb_by_target;
  const entries =
    outer instanceof Map
      ? [...outer.entries()]
      : outer && typeof outer === "object"
        ? Object.entries(outer)
        : [];
  const byTarget: Record<string, number> = {};
  for (const [target, rate] of entries) byTarget[String(target)] = Number(rate);
  return { sat_per_vb_by_target: byTarget };
}

/** Field access over either shape serde-wasm-bindgen may hand back. */
function reader(raw: unknown): (key: string) => unknown {
  return (key) => (raw instanceof Map ? raw.get(key) : (raw as Record<string, unknown>)[key]);
}

/** `None` crosses as `undefined`; the UI contract is `null`. */
function optionalNumber(value: unknown): number | null {
  return value === undefined || value === null ? null : Number(value);
}

function optionalString(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

/** A history row. */
function toTxSummary(raw: unknown): TxSummary {
  const read = reader(raw);
  return {
    txid: String(read("txid")),
    net_sat: Number(read("net_sat")),
    sent_sat: Number(read("sent_sat")),
    received_sat: Number(read("received_sat")),
    fee_sat: optionalNumber(read("fee_sat")),
    confirmations: optionalNumber(read("confirmations")),
    timestamp: optionalNumber(read("timestamp")),
  };
}

function toTxDetail(raw: unknown): TxDetail {
  const read = reader(raw);
  const inputs = (read("inputs") as unknown[]).map((i): TxInput => {
    const r = reader(i);
    return {
      txid: String(r("txid")),
      vout: Number(r("vout")),
      value_sat: optionalNumber(r("value_sat")),
      ours: Boolean(r("ours")),
    };
  });
  const outputs = (read("outputs") as unknown[]).map((o): TxOutput => {
    const r = reader(o);
    return {
      address: optionalString(r("address")),
      value_sat: Number(r("value_sat")),
      ours: Boolean(r("ours")),
    };
  });
  return {
    txid: String(read("txid")),
    net_sat: Number(read("net_sat")),
    sent_sat: Number(read("sent_sat")),
    received_sat: Number(read("received_sat")),
    fee_sat: optionalNumber(read("fee_sat")),
    fee_rate_sat_vb: optionalNumber(read("fee_rate_sat_vb")),
    confirmations: optionalNumber(read("confirmations")),
    block_height: optionalNumber(read("block_height")),
    timestamp: optionalNumber(read("timestamp")),
    vsize: Number(read("vsize")),
    inputs,
    outputs,
  };
}

function toPublicDescriptors(raw: unknown): PublicDescriptors {
  const read = reader(raw);
  return {
    external: String(read("external")),
    internal: optionalString(read("internal")),
    account_xpub: optionalString(read("account_xpub")),
    fingerprint: optionalString(read("fingerprint")),
  };
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

  get address_type(): AddressType {
    return fromCoreAddressType(this.inner.address_type);
  }

  /** A BIP32 account (mnemonic) rather than a single key. */
  get isHd(): boolean {
    return this.inner.is_hd;
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
    return (await this.inner.list_utxos()) as Utxo[];
  }

  async list_transactions(): Promise<TxSummary[]> {
    const rows = (await this.inner.list_transactions()) as unknown[];
    return rows.map(toTxSummary);
  }

  async estimate_fee(): Promise<FeeEstimate> {
    return toFeeEstimate(await this.inner.estimate_fee());
  }

  chain_height(): Promise<number> {
    return this.inner.chain_height();
  }

  async build_transfer(recipients: Recipient[], feeRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_transfer(recipients, feeRateSatVb)) as BuiltTx;
  }

  /**
   * Everything the wallet has, to one address, minus the fee. `total_out_sat`
   * is exactly what arrives: there is no change output to absorb a rounding.
   */
  async build_drain(address: string, feeRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_drain(address, feeRateSatVb)) as BuiltTx;
  }

  /**
   * Replacement for an unconfirmed transaction of ours at a higher fee rate.
   * Same shape as `build_transfer`, so it signs and broadcasts the same way.
   */
  async build_fee_bump(txid: string, feeRateSatVb: number): Promise<BuiltTx> {
    return (await this.inner.build_fee_bump(txid, feeRateSatVb)) as BuiltTx;
  }

  sign(psbtBase64: string): Promise<string> {
    return this.inner.sign(psbtBase64);
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

/** Generate a fresh key. The only call that returns secret material. */
export async function generateKey(
  network: Network,
  addressType: AddressType,
): Promise<GeneratedKey> {
  await load();
  return generate_key(network, CORE_ADDRESS_TYPE[addressType]) as GeneratedKey;
}

/**
 * Generate a fresh BIP39 phrase and the account's first address. Returns secret
 * material: hand `words` to the user once and never persist it.
 */
export async function generateMnemonic(
  network: Network,
  addressType: AddressType,
  wordCount: number,
): Promise<GeneratedMnemonic> {
  await load();
  return generate_mnemonic(network, CORE_ADDRESS_TYPE[addressType], wordCount) as GeneratedMnemonic;
}

/** Throws with a readable reason when `words` is not a valid BIP39 phrase. */
export async function validateMnemonic(words: string): Promise<void> {
  await load();
  validate_mnemonic(words);
}

/**
 * Address for a secret, without opening a wallet: that key's address for
 * hex/WIF, the account's first receive address for a mnemonic. `passphrase` is
 * the optional BIP39 one and applies only to a mnemonic.
 */
export async function addressForKey(
  secret: string,
  network: Network,
  addressType: AddressType,
  passphrase?: string,
): Promise<string> {
  await load();
  return address_for_key(secret, network, CORE_ADDRESS_TYPE[addressType], passphrase);
}

/**
 * Non-secret wallet id: the IndexedDB record key and the OS-keystore entry name.
 *
 * `passphrase` belongs in the id, not beside it — the same words under two
 * passphrases are two wallets, and this is what keeps them from sharing a
 * stored record or a keychain entry.
 */
export async function walletIdForKey(
  secret: string,
  network: Network,
  addressType: AddressType,
  passphrase?: string,
): Promise<string> {
  await load();
  return wallet_id_for_key(secret, network, CORE_ADDRESS_TYPE[addressType], passphrase);
}

/** Default public Esplora endpoint for a network. */
export async function defaultEsploraUrl(network: Network): Promise<string> {
  await load();
  return default_esplora_url(network);
}

/**
 * Block-explorer page for a txid, on the explorer fronting `backendUrl` when it
 * has one; `null` on regtest, where there is nothing public to open.
 */
export async function explorerTxUrl(
  network: Network,
  backendUrl: string,
  txid: string,
): Promise<string | null> {
  await load();
  return explorer_tx_url(network, backendUrl, txid) ?? null;
}
