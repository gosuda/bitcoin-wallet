export const NETWORKS = ["bitcoin", "testnet3", "testnet4", "signet", "regtest"] as const;
export type Network = (typeof NETWORKS)[number];

export const ADDRESS_TYPES = ["p2pkh", "p2wpkh", "nested_p2wpkh", "p2tr", "p2pk"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

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
}

/** Non-secret record of the wallet whose key is kept in the OS keystore. */
export interface RememberedWallet {
  wallet_id: string;
  address: string;
  network: Network;
  address_type: AddressType;
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

export interface FeeEstimate {
  sat_per_vb_by_target: Record<string, number>;
}

/** Returned once by `generate_key`; never persisted by the UI. */
export interface GeneratedKey {
  priv_hex: string;
  wif: string;
  pub_hex: string;
  address: string;
}

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
  explorer_url: string;
  /** Set when the send succeeded but local wallet state could not be saved. */
  persist_error: string | null;
}

export interface AppError {
  code: string;
  message: string;
}

/** Frontend failure carrying the same `{ code, message }` shape the commands return. */
export class WalletError extends Error implements AppError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === "string" && typeof v.message === "string";
}

export function errorMessage(value: unknown): string {
  if (isAppError(value)) return `${value.message} (${value.code})`;
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
