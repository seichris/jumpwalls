import { describe, expect, it } from "vitest";
import {
  enqueueDemandSignalBuckets,
  markDemandSignalUploadFailure,
  markDemandSignalUploadSuccess,
  nextDemandSignalBatch,
  shouldUploadDemandSignals
} from "./signal-queue";
import type { DemandSignalQueueState } from "./types";

const emptyQueue: DemandSignalQueueState = {
  pendingBuckets: [],
  retryCount: 0,
  nextAttemptAt: 0,
  lastError: null,
  updatedAt: 0
};

describe("signal-queue helpers", () => {
  it("merges duplicate domain buckets and keeps counts aggregated", () => {
    const queue = enqueueDemandSignalBuckets(emptyQueue, [
      { domain: "example.com", bucketStart: "2026-01-01T10:00:00.000Z", signalCount: 1 },
      { domain: "example.com", bucketStart: "2026-01-01T10:00:00.000Z", signalCount: 2 },
      { domain: "news.example.com", bucketStart: "2026-01-01T10:00:00.000Z", signalCount: 3 }
    ]);
    expect(queue.pendingBuckets).toEqual([
      { domain: "example.com", bucketStart: "2026-01-01T10:00:00.000Z", signalCount: 3 },
      { domain: "news.example.com", bucketStart: "2026-01-01T10:00:00.000Z", signalCount: 3 }
    ]);
  });

  it("schedules retry backoff after upload failure and resets after success", () => {
    const queued = enqueueDemandSignalBuckets(emptyQueue, [
      { domain: "example.com", bucketStart: "2026-01-01T10:00:00.000Z", signalCount: 1 },
      { domain: "foo.com", bucketStart: "2026-01-01T10:00:00.000Z", signalCount: 2 }
    ]);
    const failed = markDemandSignalUploadFailure(queued, "boom", 1_000, 10_000, 120_000);
    expect(failed.retryCount).toBe(1);
    expect(failed.nextAttemptAt).toBe(11_000);
    expect(shouldUploadDemandSignals(failed, 5_000)).toBe(false);
    expect(shouldUploadDemandSignals(failed, 11_000)).toBe(true);
    const batch = nextDemandSignalBatch(failed, 1);
    expect(batch).toHaveLength(1);
    const recovered = markDemandSignalUploadSuccess(failed, 1, 12_000);
    expect(recovered.retryCount).toBe(0);
    expect(recovered.nextAttemptAt).toBe(0);
    expect(recovered.pendingBuckets).toHaveLength(1);
  });
});
