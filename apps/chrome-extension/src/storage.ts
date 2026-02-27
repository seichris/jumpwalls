import { DEFAULT_SETTINGS, EMPTY_SIGNAL_QUEUE, EMPTY_STATE, STORAGE_SETTINGS_KEY, STORAGE_SIGNAL_QUEUE_KEY, STORAGE_STATE_KEY } from "./constants";
import { normalizeDomain } from "./domain";
import type { DemandSignalBucket, DemandSignalQueueState, ExtensionSettings, ExtensionState } from "./types";

function normalizeSubscriptionByDomain(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};

  const normalized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string" || typeof value !== "boolean") continue;
    const domain = normalizeDomain(key);
    if (!domain) continue;
    normalized[domain] = value;
  }
  return normalized;
}

function generateClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  const raw = stored[STORAGE_SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  const demandSignalClientId =
    typeof raw?.demandSignalClientId === "string" && raw.demandSignalClientId.trim().length >= 12
      ? raw.demandSignalClientId.trim().toLowerCase()
      : generateClientId();
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    subscriptionByDomain: {
      ...DEFAULT_SETTINGS.subscriptionByDomain,
      ...normalizeSubscriptionByDomain(raw?.subscriptionByDomain)
    },
    shareDemandSignals: typeof raw?.shareDemandSignals === "boolean" ? raw.shareDemandSignals : DEFAULT_SETTINGS.shareDemandSignals,
    demandSignalClientId
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_SETTINGS_KEY]: {
      ...settings,
      subscriptionByDomain: normalizeSubscriptionByDomain(settings.subscriptionByDomain)
    }
  });
}

export async function getState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get(STORAGE_STATE_KEY);
  return { ...EMPTY_STATE, ...(stored[STORAGE_STATE_KEY] as Partial<ExtensionState> | undefined) };
}

export async function saveState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_STATE_KEY]: state });
}

function normalizeDemandSignalBuckets(raw: unknown): DemandSignalBucket[] {
  if (!Array.isArray(raw)) return [];
  const normalized: DemandSignalBucket[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const domain = normalizeDomain(typeof item.domain === "string" ? item.domain : "");
    const bucketStart = typeof item.bucketStart === "string" ? item.bucketStart.trim() : "";
    const signalCount = Number(item.signalCount);
    if (!domain || !bucketStart || !Number.isFinite(signalCount) || signalCount <= 0) continue;
    normalized.push({
      domain,
      bucketStart,
      signalCount: Math.floor(signalCount)
    });
  }
  return normalized;
}

export async function getSignalQueue(): Promise<DemandSignalQueueState> {
  const stored = await chrome.storage.local.get(STORAGE_SIGNAL_QUEUE_KEY);
  const raw = stored[STORAGE_SIGNAL_QUEUE_KEY] as Partial<DemandSignalQueueState> | undefined;
  return {
    ...EMPTY_SIGNAL_QUEUE,
    ...raw,
    pendingBuckets: normalizeDemandSignalBuckets(raw?.pendingBuckets),
    retryCount: typeof raw?.retryCount === "number" && Number.isFinite(raw.retryCount) && raw.retryCount >= 0 ? Math.floor(raw.retryCount) : 0,
    nextAttemptAt:
      typeof raw?.nextAttemptAt === "number" && Number.isFinite(raw.nextAttemptAt) && raw.nextAttemptAt >= 0
        ? Math.floor(raw.nextAttemptAt)
        : 0,
    lastError: typeof raw?.lastError === "string" && raw.lastError.trim() ? raw.lastError.trim().slice(0, 256) : null,
    updatedAt: typeof raw?.updatedAt === "number" && Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0 ? Math.floor(raw.updatedAt) : 0
  };
}

export async function saveSignalQueue(queue: DemandSignalQueueState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_SIGNAL_QUEUE_KEY]: {
      ...queue,
      pendingBuckets: normalizeDemandSignalBuckets(queue.pendingBuckets)
    }
  });
}
