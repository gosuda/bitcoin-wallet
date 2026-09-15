export const NETWORKS = ["bitcoin", "testnet3", "testnet4", "signet", "regtest"] as const;
export type Network = (typeof NETWORKS)[number];

export const ADDRESS_TYPES = ["p2pkh", "p2wpkh", "nested_p2wpkh", "p2tr", "p2pk"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

/**
 * The types a wallet can be opened on.
 *
 * `p2pk` stays in the union because the core still derives and prints such a
 * key, and a config stored before this may name it — but it cannot back a
 * wallet: its descriptor is a bare script with no signing context, and the
 * core refuses to open one rather than let a send reach that.
 */
export const OPENABLE_ADDRESS_TYPES = ADDRESS_TYPES.filter(
  (t): t is Exclude<AddressType, "p2pk"> => t !== "p2pk",
);

/** Mirrors `wallet_core::BackendConfig` (serde-tagged on `kind`). */
export interface BackendConfig {
  kind: "esplora";
  url: string;
}

export interface AppConfig {
  network: Network;
  backend: BackendConfig;
  address_type: AddressType;
}

export interface WalletInfo {
  address: string;
  network: Network;
  address_type: AddressType;
  wallet_id: string;
  /** True for a BIP32 account (mnemonic): it has a separate change keychain. */
  is_hd: boolean;
  /**
   * True when the wallet derives a range of addresses.
   *
   * Every HD wallet is ranged, but not every ranged wallet is HD: an imported
   * `wpkh(xpub/*)` rotates receive addresses with no change keychain. Receive
   * surfaces want this, not `is_hd`.
   */
  is_ranged: boolean;
  /** True when opened from an xpub or public descriptor: it cannot sign. */
  is_watch_only: boolean;
}

/** Non-secret record of the wallet whose key is kept in the OS keystore. */
export interface RememberedWallet {
  wallet_id: string;
  address: string;
  network: Network;
  address_type: AddressType;
}

/**
 * What `load_secret` returns: secret material, held only long enough to open
 * the wallet.
 *
 * The BIP39 passphrase is stored alongside the words because it is part of the
 * same wallet's identity — the words on their own open a different wallet — and
 * the OS keystore is already the boundary that protects them.
 */
export interface StoredSecret {
  secret: string;
  /** `null` for a single key, and for a mnemonic saved without one. */
  passphrase: string | null;
}

export interface Balance {
  confirmed: number;
  trusted_pending: number;
  untrusted_pending: number;
  immature: number;
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  confirmations: number | null;
  address: string;
}

/** One wallet-relevant transaction, newest first from `list_transactions`. */
export interface TxSummary {
  txid: string;
  /** Net effect in sats: positive when received, negative when sent (fee included). */
  net_sat: number;
  /** Total value of inputs this wallet owns. */
  sent_sat: number;
  /** Total value of outputs this wallet owns (change included). */
  received_sat: number;
  /** `null` when the wallet does not know every input. */
  fee_sat: number | null;
  /** `null` while unconfirmed. */
  confirmations: number | null;
  /** Seconds since the epoch; `null` when the transaction was never seen. */
  timestamp: number | null;
}

export interface FeeEstimate {
  sat_per_vb_by_target: Record<string, number>;
}

/** The public half of the wallet: enough to watch it, not to spend from it. */
export interface PublicDescriptors {
  external: string;
  /** Change keychain; `null` for a single key. */
  internal: string | null;
  /** Account xpub of an HD wallet; `null` for a single key. */
  account_xpub: string | null;
  fingerprint: string | null;
}

export interface TxInput {
  txid: string;
  vout: number;
  /** `null` when the spent output is not one the wallet has seen. */
  value_sat: number | null;
  ours: boolean;
}

export interface TxOutput {
  /** `null` for a script with no address form. */
  address: string | null;
  value_sat: number;
  ours: boolean;
}

/** Everything the wallet knows about one transaction in its history. */
export interface TxDetail {
  txid: string;
  net_sat: number;
  sent_sat: number;
  received_sat: number;
  fee_sat: number | null;
  fee_rate_sat_vb: number | null;
  confirmations: number | null;
  block_height: number | null;
  timestamp: number | null;
  vsize: number;
  inputs: TxInput[];
  outputs: TxOutput[];
}

/**
 * Best known rate for `target` blocks (mirrors `FeeEstimate::for_target`):
 * the exact target, else the closest faster one, else the closest slower one.
 */
export function rateForTarget(estimate: FeeEstimate, target: number): number | null {
  const entries = Object.entries(estimate.sat_per_vb_by_target)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([k]) => Number.isFinite(k))
    .sort((a, b) => a[0] - b[0]);
  const exact = entries.find(([k]) => k === target);
  if (exact) return exact[1];
  const faster = entries.filter(([k]) => k < target).at(-1);
  if (faster) return faster[1];
  const slower = entries.find(([k]) => k > target);
  return slower ? slower[1] : null;
}

/**
 * Mirrors `wallet_core::wallet::MAX_FEE_RATE_SAT_VB`. Past this a rate is
 * almost certainly a mistake — a misplaced decimal, sat/vB confused with
 * sat/vkB — rather than an urgent bump, and the core refuses it outright.
 */
export const MAX_FEE_RATE_SAT_VB = 10_000;

/**
 * `null` when `rate` is a fee this UI will submit; otherwise why not, so a
 * screen can say so before the round trip to `build_transfer`/`build_drain`/
 * `build_fee_bump` fails with `invalid_fee_rate`.
 *
 * Not quite the core's own contract: `fee_rate_from_sat_vb` accepts `0` and
 * raises it to the floor, but an empty numeric input reads as `Number("")
 * === 0` in every browser, so treating a bare `0` as valid here would let a
 * cleared field silently enable Review. Refusing it is a deliberate product
 * choice on top of a core rule this UI otherwise mirrors exactly.
 */
export function feeRateError(rate: number): string | null {
  if (!Number.isFinite(rate)) return "Enter a fee rate.";
  if (rate <= 0) return "Fee rate must be more than 0 sat/vB.";
  if (rate > MAX_FEE_RATE_SAT_VB) {
    return `Fee rate can't be over ${MAX_FEE_RATE_SAT_VB.toLocaleString("en-US")} sat/vB.`;
  }
  return null;
}

/** Returned once by `generate_key`; never persisted by the UI. */
export interface GeneratedKey {
  priv_hex: string;
  wif: string;
  pub_hex: string;
  address: string;
}

/**
 * Returned once by `generate_mnemonic`. `words` is the backup phrase: show it,
 * let the user copy it, and drop it — it is never stored by the UI.
 */
export interface GeneratedMnemonic {
  words: string;
  /** First receive address of the account (external keychain, index 0). */
  address: string;
}

/** Word counts `generate_mnemonic` accepts. */
export const WORD_COUNTS = [12, 24] as const;
export type WordCount = (typeof WORD_COUNTS)[number];

export interface Recipient {
  address: string;
  amount_sat: number;
}

export interface TxPreview {
  psbt_id: string;
  fee_sat: number;
  vsize: number;
  total_out_sat: number;
  change_sat: number;
  input_count: number;
}

export interface BroadcastResult {
  txid: string;
  /** `null` where no public explorer exists (regtest); the UI hides the link. */
  explorer_url: string | null;
  /** Set when the send succeeded but local wallet state could not be saved. */
  persist_error: string | null;
}

export interface AppError {
  code: string;
  message: string;
  /** Structured data for the codes that carry more than prose — amounts, a
   * reason — mirroring `wallet_core::Error::details`. Absent otherwise. */
  details?: Record<string, unknown>;
}

/** Frontend failure carrying the same `{ code, message, details? }` shape the commands return. */
export class WalletError extends Error implements AppError {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WalletError";
    this.code = code;
    // Not `this.details = details`: under `exactOptionalPropertyTypes`, an
    // optional property left unset and one explicitly set to `undefined`
    // are different types, and only the former matches `AppError`.
    if (details !== undefined) this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.message === "string";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Copy for the codes worth saying something more specific about than the
 * message the core already wrote — using `details` where it helps.
 * Everything else falls through to `value.message` unchanged: most codes
 * already carry a clear message, and the fix this table exists for is that
 * `errorMessage` used to append the raw code to every one of them.
 */
function detailedMessage(value: AppError): string | null {
  const d = value.details;
  switch (value.code) {
    case "insufficient_funds":
      if (isFiniteNumber(d?.needed_sat) && isFiniteNumber(d?.available_sat)) {
        return `Need ${(d.needed_sat - d.available_sat).toLocaleString("en-US")} more sat.`;
      }
      return null;
    case "timeout":
      return isFiniteNumber(d?.secs) ? `The backend did not answer within ${d.secs} s.` : null;
    case "invalid_fee_rate":
      return `Enter a fee rate greater than 0, up to ${MAX_FEE_RATE_SAT_VB.toLocaleString("en-US")} sat/vB.`;
    case "dust":
      return isFiniteNumber(d?.output)
        ? `Output ${d.output + 1} is too small to send — it is below the network's dust limit.`
        : null;
    case "fee_too_low":
      if (isFiniteNumber(d?.required_sat_vb)) {
        return `The fee rate must be at least ${d.required_sat_vb} sat/vB to replace the original.`;
      }
      if (isFiniteNumber(d?.required_sat)) {
        return `The fee must be at least ${d.required_sat.toLocaleString("en-US")} sat to replace the original.`;
      }
      return null;
    case "not_replaceable":
      return "This transaction can no longer be replaced.";
    case "corrupt_state":
      return typeof d?.reason === "string"
        ? `The saved wallet data could not be read (${d.reason}).`
        : "The saved wallet data could not be read.";
    default:
      return null;
  }
}

export function errorMessage(value: unknown): string {
  if (isAppError(value)) return detailedMessage(value) ?? value.message;
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : "unexpected error";
}

export const NETWORK_LABELS: Record<Network, string> = {
  bitcoin: "Bitcoin",
  testnet3: "Testnet3",
  testnet4: "Testnet4",
  signet: "Signet",
  regtest: "Regtest",
};

export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  p2pkh: "P2PKH (legacy)",
  p2wpkh: "P2WPKH (segwit)",
  nested_p2wpkh: "P2SH-P2WPKH (nested)",
  p2tr: "P2TR (taproot)",
  p2pk: "P2PK (bare, not indexed)",
};

/** Mirrors `Network::default_esplora_url` in wallet-core. */
export const DEFAULT_ESPLORA_URL: Record<Network, string> = {
  bitcoin: "https://mempool.space/api",
  testnet3: "https://mempool.space/testnet/api",
  testnet4: "https://mempool.space/testnet4/api",
  signet: "https://mempool.space/signet/api",
  regtest: "http://127.0.0.1:3002",
};

/** Host of the configured Esplora endpoint, for compact meta text (e.g. "mempool.space"). */
export function backendHost(backend: BackendConfig): string {
  try {
    return new URL(backend.url).host;
  } catch {
    return backend.url;
  }
}
