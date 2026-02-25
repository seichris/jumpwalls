import { domainMatches, extractDomainFromSource } from "./domain";
import type { DomainMatch, OpenRequest } from "./types";

function domainsOverlap(left: string, right: string): boolean {
  return domainMatches(left, right) || domainMatches(right, left);
}

export function computeSubscriptionMatches(
  openRequests: OpenRequest[],
  subscriptionByDomain: Record<string, boolean>
): Record<string, DomainMatch> {
  const subscribedDomains = Object.entries(subscriptionByDomain)
    .filter(([, hasSubscription]) => hasSubscription)
    .map(([domain]) => domain);
  if (subscribedDomains.length === 0) return {};

  const matches: Record<string, DomainMatch> = {};
  for (const request of openRequests) {
    const requestDomain = extractDomainFromSource(request.sourceURI);
    if (!requestDomain) continue;

    if (!subscribedDomains.some((subscribedDomain) => domainsOverlap(subscribedDomain, requestDomain))) continue;
    matches[request.requestId] = {
      domain: requestDomain,
      historyItemCount: 0,
      latestVisitTime: 0
    };
  }
  return matches;
}
