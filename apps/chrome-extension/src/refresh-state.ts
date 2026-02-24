import type { DomainMatch, ExtensionSettings, ExtensionState, OpenRequest, ContractConfig } from "./types";

interface BuildSuccessStateArgs {
  contract: ContractConfig;
  openRequests: OpenRequest[];
  settings: ExtensionSettings;
  permissionGranted: boolean;
  computedMatches: Record<string, DomainMatch>;
  now?: number;
}

export function buildRefreshSuccessState(args: BuildSuccessStateArgs): ExtensionState {
  const { contract, openRequests, settings, permissionGranted, computedMatches, now } = args;
  return {
    contract,
    openRequests,
    matchedByRequestId: settings.historyMatchingEnabled && permissionGranted ? computedMatches : {},
    lastUpdatedAt: now ?? Date.now(),
    error: null
  };
}

export function buildRefreshErrorState(previousState: ExtensionState, message: string, now?: number): ExtensionState {
  return {
    ...previousState,
    lastUpdatedAt: now ?? Date.now(),
    error: message
  };
}
