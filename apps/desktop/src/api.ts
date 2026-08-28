import { invoke } from "@tauri-apps/api/core";
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

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  setConfig: (config: AppConfig) => invoke<void>("set_config", { config }),
  generateKey: (network: Network, addressType: AddressType) =>
    invoke<GeneratedKey>("generate_key", { network, addressType }),
  openWallet: (secret: string, addressType: AddressType, remember: boolean) =>
    invoke<WalletInfo>("open_wallet", { secret, addressType, remember }),
  closeWallet: () => invoke<void>("close_wallet"),
  getRemembered: () => invoke<RememberedWallet | null>("get_remembered"),
  unlockWallet: () => invoke<WalletInfo>("unlock_wallet"),
  forgetWallet: () => invoke<void>("forget_wallet"),
  sync: () => invoke<Balance>("sync"),
  getBalance: () => invoke<Balance>("get_balance"),
  listUtxos: () => invoke<Utxo[]>("list_utxos"),
  estimateFee: () => invoke<FeeEstimate>("estimate_fee"),
  buildTransfer: (recipients: Recipient[], feeRateSatVb: number) =>
    invoke<TxPreview>("build_transfer", { recipients, feeRateSatVb }),
  signAndBroadcast: (psbtId: string) => invoke<BroadcastResult>("sign_and_broadcast", { psbtId }),
  discardTx: (psbtId: string) => invoke<void>("discard_tx", { psbtId }),
} as const;
