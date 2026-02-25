import { describe, expect, it } from "vitest";
import { computeSubscriptionMatches } from "./matching";
import type { OpenRequest } from "./types";

function buildRequest(requestId: `0x${string}`, sourceURI: string): OpenRequest {
  return {
    requestId,
    requester: "0x0000000000000000000000000000000000000001",
    paymentToken: "0x0000000000000000000000000000000000000000",
    maxAmountWei: "1000000",
    sourceURI,
    question: "Summarize this source",
    status: "OPEN",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("subscription matching", () => {
  it("matches when the exact domain is marked as subscribed", () => {
    const openRequests = [buildRequest("0x0000000000000000000000000000000000000000000000000000000000000001", "wsj.com")];
    const matches = computeSubscriptionMatches(openRequests, { "wsj.com": true });
    expect(Object.keys(matches)).toEqual([openRequests[0].requestId]);
    expect(matches[openRequests[0].requestId]?.domain).toBe("wsj.com");
  });

  it("ignores domains marked as not subscribed", () => {
    const openRequests = [buildRequest("0x0000000000000000000000000000000000000000000000000000000000000002", "economist.com")];
    const matches = computeSubscriptionMatches(openRequests, { "economist.com": false });
    expect(matches).toEqual({});
  });

  it("matches when either domain is a subdomain of the other", () => {
    const openRequests = [
      buildRequest("0x0000000000000000000000000000000000000000000000000000000000000003", "https://premium.ft.com"),
      buildRequest("0x0000000000000000000000000000000000000000000000000000000000000004", "https://nytimes.com")
    ];
    const matches = computeSubscriptionMatches(openRequests, {
      "ft.com": true,
      "news.nytimes.com": true
    });
    expect(Object.keys(matches).sort()).toEqual([openRequests[0].requestId, openRequests[1].requestId].sort());
  });
});
