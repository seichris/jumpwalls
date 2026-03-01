import { EMPTY_SIGNAL_QUEUE } from "./constants";
import { normalizeDomain } from "./domain";
import type { DemandSignalBucket, DemandSignalQueueState } from "./types";

function normalizeBucket(bucket: DemandSignalBucket): DemandSignalBucket | null {
  const domain = normalizeDomain(bucket.domain);
  const bucketStart = typeof bucket.bucketStart === "string" ? bucket.bucketStart.trim() : "";
  const signalCount = Number(bucket.signalCount);
  if (!domain || !bucketStart || !Number.isFinite(signalCount) || signalCount <= 0) return null;
  return {
    domain,
    bucketStart,
    signalCount: Math.floor(signalCount)
  };
}

export function shouldUploadDemandSignals(queue: DemandSignalQueueState, nowMs = Date.now()): boolean {
  return queue.pendingBuckets.length > 0 && nowMs >= queue.nextAttemptAt;
}

export function enqueueDemandSignalBuckets(
  queue: DemandSignalQueueState,
  buckets: DemandSignalBucket[],
  maxPending = 500,
  nowMs = Date.now()
): DemandSignalQueueState {
  const mergedByKey = new Map<string, DemandSignalBucket>();
  for (const bucket of queue.pendingBuckets) {
    const normalized = normalizeBucket(bucket);
    if (!normalized) continue;
    mergedByKey.set(`${normalized.domain}|${normalized.bucketStart}`, normalized);
  }
  for (const bucket of buckets) {
    const normalized = normalizeBucket(bucket);
    if (!normalized) continue;
    const key = `${normalized.domain}|${normalized.bucketStart}`;
    const existing = mergedByKey.get(key);
    if (existing) {
      existing.signalCount += normalized.signalCount;
    } else {
      mergedByKey.set(key, normalized);
    }
  }
  const pendingBuckets = Array.from(mergedByKey.values())
    .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart) || left.domain.localeCompare(right.domain))
    .slice(-maxPending);
  return {
    ...queue,
    pendingBuckets,
    updatedAt: nowMs
  };
}

export function nextDemandSignalBatch(queue: DemandSignalQueueState, batchSize = 50): DemandSignalBucket[] {
  return queue.pendingBuckets.slice(0, Math.max(1, batchSize));
}

export function markDemandSignalUploadSuccess(
  queue: DemandSignalQueueState,
  uploadedCount: number,
  nowMs = Date.now()
): DemandSignalQueueState {
  const count = Math.max(0, Math.floor(uploadedCount));
  const pendingBuckets = queue.pendingBuckets.slice(count);
  return {
    ...queue,
    pendingBuckets,
    retryCount: 0,
    nextAttemptAt: 0,
    lastError: null,
    updatedAt: nowMs
  };
}

export function markDemandSignalUploadFailure(
  queue: DemandSignalQueueState,
  error: string,
  nowMs = Date.now(),
  baseBackoffMs = 30_000,
  maxBackoffMs = 6 * 60 * 60 * 1000
): DemandSignalQueueState {
  const retryCount = Math.max(0, queue.retryCount) + 1;
  const exponent = Math.max(0, retryCount - 1);
  const uncappedDelay = baseBackoffMs * Math.pow(2, Math.min(exponent, 10));
  const delayMs = Math.min(maxBackoffMs, Math.max(baseBackoffMs, uncappedDelay));
  return {
    ...queue,
    retryCount,
    nextAttemptAt: nowMs + delayMs,
    lastError: error.trim().slice(0, 256) || "upload failed",
    updatedAt: nowMs
  };
}

export const EMPTY_DEMAND_SIGNAL_QUEUE: DemandSignalQueueState = EMPTY_SIGNAL_QUEUE;
