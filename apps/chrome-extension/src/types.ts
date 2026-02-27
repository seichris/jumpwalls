export interface ContractConfig {
  chainId: number;
  rpcUrl: string;
  contractAddress: `0x${string}`;
  contractKind?: string;
}

export interface OpenRequest {
  requestId: `0x${string}`;
  requester: `0x${string}`;
  paymentToken: `0x${string}`;
  maxAmountWei: string;
  sourceURI: string;
  question: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainMatch {
  domain: string;
  historyItemCount: number;
  latestVisitTime: number;
}

export interface ExtensionSettings {
  apiUrl: string;
  historyLookbackDays: number;
  subscriptionByDomain: Record<string, boolean>;
  shareDemandSignals: boolean;
  demandSignalClientId: string;
}

export interface DemandSignalBucket {
  domain: string;
  bucketStart: string;
  signalCount: number;
}

export interface DemandSignalQueueState {
  pendingBuckets: DemandSignalBucket[];
  retryCount: number;
  nextAttemptAt: number;
  lastError: string | null;
  updatedAt: number;
}

export interface ExtensionState {
  contract: ContractConfig | null;
  openRequests: OpenRequest[];
  matchedByRequestId: Record<string, DomainMatch>;
  lastUpdatedAt: number;
  error: string | null;
}

export interface BackgroundStateResponse {
  settings: ExtensionSettings;
  state: ExtensionState;
}

export interface EthereumBridgeResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

export type RuntimeMessage =
  | { type: "INFOFI_GET_STATE" }
  | { type: "INFOFI_REFRESH_STATE" }
  | { type: "INFOFI_SET_SETTINGS"; settings: ExtensionSettings }
  | { type: "INFOFI_ETHEREUM_REQUEST"; method: string; params?: unknown[] };
