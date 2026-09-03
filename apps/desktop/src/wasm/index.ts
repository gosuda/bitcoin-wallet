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
  Recipient,
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

/** A history row; `None` fields cross as `undefined`, and the UI contract is `null`. */
function toTxSummary(raw: unknown): TxSummary {
  const read = (key: string): unknown =>
    raw instanceof Map ? raw.get(key) : (raw as Record<string, unknown>)[key];
  const optional = (key: string): number | null => {
    const value = read(key);
    return value === undefined || value === null ? null : Number(value);
  };
  return {
    txid: String(read("txid")),
    net_sat: Number(read("net_sat")),
    sent_sat: Number(read("sent_sat")),
    received_sat: Number(read("received_sat")),
    fee_sat: optional("fee_sat"),
    confirmations: optional("confirmations"),
    timestamp: optional("timestamp"),
  };
}

/** An open wallet. Every chain operation runs here, in the webview. */
export class WalletApi {
  private readonly inner: Wallet;

  private constructor(inner: Wallet) {
    this.inner = inner;
  }

  /** Open (or create) the wallet for `secret`, backed by `persister`. */
  static async open(
    config: AppConfig,
    secret: string,
    persister: WalletPersister,
  ): Promise<WalletApi> {
    await load();
    return new WalletApi(await Wallet.open(config, secret, persister));
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

/** Address for a hex/WIF secret, without opening a wallet. */
export async function addressForKey(
  secret: string,
  network: Network,
  addressType: AddressType,
): Promise<string> {
  await load();
  return address_for_key(secret, network, CORE_ADDRESS_TYPE[addressType]);
}

/** Non-secret wallet id: the IndexedDB record key and the OS-keystore entry name. */
export async function walletIdForKey(
  secret: string,
  network: Network,
  addressType: AddressType,
): Promise<string> {
  await load();
  return wallet_id_for_key(secret, network, CORE_ADDRESS_TYPE[addressType]);
}

/** Default public Esplora endpoint for a network. */
export async function defaultEsploraUrl(network: Network): Promise<string> {
  await load();
  return default_esplora_url(network);
}

/** Block-explorer URL for a txid on a network. */
export async function explorerTxUrl(network: Network, txid: string): Promise<string> {
  await load();
  return explorer_tx_url(network, txid);
}
