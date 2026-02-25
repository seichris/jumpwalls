import { describe, expect, it } from "vitest";
import { buildRefreshErrorState, buildRefreshSuccessState } from "./refresh-state";
import type { ExtensionState } from "./types";

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
  it("keeps computed matches", () => {
    const state = buildRefreshSuccessState({
      contract: baseState.contract!,
      openRequests: [],
      computedMatches: baseState.matchedByRequestId,
      now: 10
    });
    expect(state.matchedByRequestId).toEqual(baseState.matchedByRequestId);
    expect(state.lastUpdatedAt).toBe(10);
    expect(state.error).toBeNull();
  });

  it("stores empty matches when none are provided", () => {
    const state = buildRefreshSuccessState({
      contract: baseState.contract!,
      openRequests: [],
      computedMatches: {},
      now: 11
    });
    expect(state.matchedByRequestId).toEqual({});
  });

  it("preserves previous matches on refresh error", () => {
    const state = buildRefreshErrorState(baseState, "network down", 12);
    expect(state.matchedByRequestId).toEqual(baseState.matchedByRequestId);
    expect(state.error).toBe("network down");
    expect(state.lastUpdatedAt).toBe(12);
  });
});
