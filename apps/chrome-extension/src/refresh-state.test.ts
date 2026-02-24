import { describe, expect, it } from "vitest";
import { buildRefreshErrorState, buildRefreshSuccessState } from "./refresh-state";
import type { ExtensionSettings, ExtensionState } from "./types";

const settingsEnabled: ExtensionSettings = {
  apiUrl: "http://localhost:8787",
  historyMatchingEnabled: true,
  historyLookbackDays: 90
};

const settingsDisabled: ExtensionSettings = {
  ...settingsEnabled,
  historyMatchingEnabled: false
};

const baseState: ExtensionState = {
  contract: {
    chainId: 11155111,
    rpcUrl: "https://rpc.example",
    contractAddress: "0x0000000000000000000000000000000000000001"
  },
  openRequests: [],
  matchedByRequestId: {
    "0xrequest": {
      domain: "example.com",
      historyItemCount: 2,
      latestVisitTime: 100
    }
  },
  lastUpdatedAt: 1,
  error: null
};

describe("refresh-state helpers", () => {
  it("keeps matches when history is enabled and permission granted", () => {
    const state = buildRefreshSuccessState({
      contract: baseState.contract!,
      openRequests: [],
      settings: settingsEnabled,
      permissionGranted: true,
      computedMatches: baseState.matchedByRequestId,
      now: 10
    });
    expect(state.matchedByRequestId).toEqual(baseState.matchedByRequestId);
    expect(state.lastUpdatedAt).toBe(10);
    expect(state.error).toBeNull();
  });

  it("drops matches when history permission is missing", () => {
    const state = buildRefreshSuccessState({
      contract: baseState.contract!,
      openRequests: [],
      settings: settingsEnabled,
      permissionGranted: false,
      computedMatches: baseState.matchedByRequestId,
      now: 11
    });
    expect(state.matchedByRequestId).toEqual({});
  });

  it("drops matches when history matching is disabled", () => {
    const state = buildRefreshSuccessState({
      contract: baseState.contract!,
      openRequests: [],
      settings: settingsDisabled,
      permissionGranted: true,
      computedMatches: baseState.matchedByRequestId,
      now: 12
    });
    expect(state.matchedByRequestId).toEqual({});
  });

  it("preserves previous matches on refresh error", () => {
    const state = buildRefreshErrorState(baseState, "network down", 13);
    expect(state.matchedByRequestId).toEqual(baseState.matchedByRequestId);
    expect(state.error).toBe("network down");
    expect(state.lastUpdatedAt).toBe(13);
  });
});
