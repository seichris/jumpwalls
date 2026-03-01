import { REFRESH_ALARM } from "./constants";
import {
  apiOriginForDisplay,
  apiOriginPermissionPattern,
  fetchContractConfig,
  fetchOpenRequests,
  postExtensionDomainSignals,
  normalizeApiUrl
} from "./api";
import { domainMatches, extractDomainFromSource, extractDomainFromUrl, normalizeDomain } from "./domain";
import { computeSubscriptionMatches } from "./matching";
import { buildRefreshErrorState, buildRefreshSuccessState } from "./refresh-state";
import {
  enqueueDemandSignalBuckets,
  markDemandSignalUploadFailure,
  markDemandSignalUploadSuccess,
  nextDemandSignalBatch,
  shouldUploadDemandSignals
} from "./signal-queue";
import { getSettings, getSignalQueue, getState, saveSettings, saveSignalQueue, saveState } from "./storage";
import type { BackgroundStateResponse, DemandSignalQueueState, DomainMatch, RuntimeMessage } from "./types";

async function historyPermissionGranted(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ["history"] });
}

function badgeTextFromMatchCount(count: number): string {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

async function updateBadge(matchCount: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: "#d12b2b" });
  await chrome.action.setBadgeText({ text: badgeTextFromMatchCount(matchCount) });
}

const DEMAND_SIGNAL_BATCH_SIZE = 50;
const DEMAND_SIGNAL_MAX_PENDING = 500;
const DEMAND_SIGNAL_RETRY_BASE_MS = 30_000;
const DEMAND_SIGNAL_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

async function computeHistoryMatches(lookbackDays: number, openRequests: Awaited<ReturnType<typeof fetchOpenRequests>>) {
  const domainToRequests = new Map<string, typeof openRequests>();
  for (const request of openRequests) {
    const domain = extractDomainFromSource(request.sourceURI);
    if (!domain) continue;
    const existing = domainToRequests.get(domain) || [];
    existing.push(request);
    domainToRequests.set(domain, existing);
  }

  const matches: Record<string, DomainMatch> = {};
  const startTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  for (const [domain, requestsForDomain] of domainToRequests.entries()) {
    const historyItems = await chrome.history.search({ text: domain, startTime, maxResults: 100 });
    const matchingItems = historyItems.filter((item) => {
      if (!item.url) return false;
      const visitedDomain = extractDomainFromUrl(item.url);
      return visitedDomain ? domainMatches(domain, visitedDomain) : false;
    });
    if (matchingItems.length === 0) continue;

    const latestVisitTime = matchingItems.reduce((acc, item) => Math.max(acc, item.lastVisitTime || 0), 0);
    for (const request of requestsForDomain) {
      matches[request.requestId] = { domain, historyItemCount: matchingItems.length, latestVisitTime };
    }
  }

  return matches;
}

function currentHourBucketIso(): string {
  const hourMs = 60 * 60 * 1000;
  return new Date(Math.floor(Date.now() / hourMs) * hourMs).toISOString();
}

function buildDemandSignalBuckets(
  openRequests: Awaited<ReturnType<typeof fetchOpenRequests>>,
  matchedByRequestId: Record<string, DomainMatch>
) {
  const countsByDomain = new Map<string, number>();
  for (const request of openRequests) {
    const matched = matchedByRequestId[request.requestId];
    if (!matched) continue;
    const domain = normalizeDomain(matched.domain || extractDomainFromSource(request.sourceURI) || "");
    if (!domain) continue;
    countsByDomain.set(domain, (countsByDomain.get(domain) || 0) + 1);
  }

  const bucketStart = currentHourBucketIso();
  return Array.from(countsByDomain.entries()).map(([domain, signalCount]) => ({
    domain,
    bucketStart,
    signalCount
  }));
}

async function flushDemandSignalQueue(
  apiUrl: string,
  clientIdHash: string,
  queue: DemandSignalQueueState
): Promise<DemandSignalQueueState> {
  let nextQueue = queue;
  if (!shouldUploadDemandSignals(nextQueue)) return nextQueue;

  while (nextQueue.pendingBuckets.length > 0 && shouldUploadDemandSignals(nextQueue)) {
    const batch = nextDemandSignalBatch(nextQueue, DEMAND_SIGNAL_BATCH_SIZE);
    if (batch.length === 0) break;
    try {
      await postExtensionDomainSignals(apiUrl, {
        clientIdHash,
        buckets: batch
      });
      nextQueue = markDemandSignalUploadSuccess(nextQueue, batch.length);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Demand-signal upload should not break refresh UX.
      // eslint-disable-next-line no-console
      console.warn("[infofi-extension] demand signal upload failed", reason);
      nextQueue = markDemandSignalUploadFailure(
        nextQueue,
        reason,
        Date.now(),
        DEMAND_SIGNAL_RETRY_BASE_MS,
        DEMAND_SIGNAL_RETRY_MAX_MS
      );
      break;
    }
  }

  return nextQueue;
}

async function refreshState(): Promise<BackgroundStateResponse> {
  const settings = await getSettings();
  const apiUrl = normalizeApiUrl(settings.apiUrl);
  try {
    const apiPermissionPattern = apiOriginPermissionPattern(apiUrl);
    const apiPermissionGranted = await chrome.permissions.contains({ origins: [apiPermissionPattern] });
    if (!apiPermissionGranted) {
      throw new Error(
        `Missing permission for API origin ${apiOriginForDisplay(apiUrl)}. Open extension settings and save to grant access.`
      );
    }

    const [contract, openRequests] = await Promise.all([fetchContractConfig(apiUrl), fetchOpenRequests(apiUrl)]);
    const historyMatches =
      (await historyPermissionGranted()) ? await computeHistoryMatches(settings.historyLookbackDays, openRequests) : {};
    const subscriptionMatches = computeSubscriptionMatches(openRequests, settings.subscriptionByDomain);
    const matchedByRequestId = {
      ...subscriptionMatches,
      ...historyMatches
    };

    const state = buildRefreshSuccessState({
      contract,
      openRequests,
      computedMatches: matchedByRequestId
    });
    await saveState(state);
    if (settings.shareDemandSignals && settings.demandSignalClientId) {
      const buckets = buildDemandSignalBuckets(openRequests, matchedByRequestId);
      let queue = await getSignalQueue();
      if (buckets.length > 0) {
        queue = enqueueDemandSignalBuckets(queue, buckets, DEMAND_SIGNAL_MAX_PENDING);
      }
      queue = await flushDemandSignalQueue(apiUrl, settings.demandSignalClientId, queue);
      await saveSignalQueue(queue);
    } else {
      await saveSignalQueue({
        pendingBuckets: [],
        retryCount: 0,
        nextAttemptAt: 0,
        lastError: null,
        updatedAt: Date.now()
      });
    }
    await updateBadge(Object.keys(state.matchedByRequestId).length);
    return { settings, state };
  } catch (error) {
    const previousState = await getState();
    const state = buildRefreshErrorState(
      previousState,
      error instanceof Error ? error.message : "Failed to refresh extension state"
    );
    await saveState(state);
    await updateBadge(Object.keys(state.matchedByRequestId).length);
    return { settings, state };
  }
}

async function setup(): Promise<void> {
  const settings = await getSettings();
  await saveSettings(settings);
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 5 });
  await refreshState();
}

chrome.runtime.onInstalled.addListener(() => {
  void setup();
});

chrome.runtime.onStartup.addListener(() => {
  void setup();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  void refreshState();
});

chrome.history?.onVisited.addListener((item) => {
  void (async () => {
    if (!(await historyPermissionGranted())) return;
    const settings = await getSettings();
    const visitedDomain = item.url ? extractDomainFromUrl(item.url) : null;
    if (!visitedDomain) return;
    const state = await getState();
    const openDomains = state.openRequests
      .map((request) => extractDomainFromSource(request.sourceURI))
      .filter((value): value is string => Boolean(value));
    if (openDomains.some((domain) => domainMatches(domain, visitedDomain))) {
      await refreshState();
    }
  })();
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "INFOFI_GET_STATE") {
    void (async () => {
      const [settings, state] = await Promise.all([getSettings(), getState()]);
      sendResponse({ settings, state } as BackgroundStateResponse);
    })();
    return true;
  }

  if (message.type === "INFOFI_REFRESH_STATE") {
    void refreshState().then(sendResponse);
    return true;
  }

  if (message.type === "INFOFI_SET_SETTINGS") {
    void (async () => {
      await saveSettings(message.settings);
      const result = await refreshState();
      sendResponse(result);
    })();
    return true;
  }

  return false;
});

void setup();
