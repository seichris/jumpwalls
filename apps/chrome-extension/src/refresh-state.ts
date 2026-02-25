import type { ContractConfig, DomainMatch, ExtensionState, OpenRequest } from "./types";

interface BuildSuccessStateArgs {
  contract: ContractConfig;
  openRequests: OpenRequest[];
  computedMatches: Record<string, DomainMatch>;
  now?: number;
}

export function buildRefreshSuccessState(args: BuildSuccessStateArgs): ExtensionState {
  const { contract, openRequests, computedMatches, now } = args;
  return {
    contract,
    openRequests,
    matchedByRequestId: computedMatches,
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
