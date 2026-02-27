import assert from "node:assert/strict";
import test from "node:test";
import { pickBestCandidate, scheduleDeliveryRetry } from "./logic.js";

test("pickBestCandidate returns best matching capability above confidence threshold", () => {
  const candidate = pickBestCandidate(
    {
      requestId: "0xrequest",
      paymentToken: "ETH",
      maxAmountWei: "1000000000000000000"
    },
    "sub.example.com",
    [
      {
        domain: "example.com",
        paymentToken: "ETH",
        minAmountWei: "100000000000000000",
        maxAmountWei: "1000000000000000000",
        etaSeconds: 300,
        minConfidence: 0.65,
        proofTypeDefault: null,
        isEnabled: true
      },
      {
        domain: "example.com",
        paymentToken: "ETH",
        minAmountWei: "100000000000000000",
        maxAmountWei: "1000000000000000000",
        etaSeconds: 900,
        minConfidence: 0.65,
        proofTypeDefault: null,
        isEnabled: true
      },
      {
        domain: "example.com",
        paymentToken: "0x0000000000000000000000000000000000000001",
        minAmountWei: "1",
        maxAmountWei: "2",
        etaSeconds: 60,
        minConfidence: 0.1,
        proofTypeDefault: null,
        isEnabled: true
      }
    ]
  );
  assert.ok(candidate);
  assert.equal(candidate.capability.etaSeconds, 300);
  assert.equal(candidate.offerAmountWei.toString(), "1000000000000000000");
});

test("scheduleDeliveryRetry backs off and disables once retries are exhausted", () => {
  const first = scheduleDeliveryRetry({
    previous: undefined,
    nowMs: 1_000,
    error: "rpc timeout",
    maxRetries: 3,
    baseBackoffMs: 10_000,
    maxBackoffMs: 60_000
  });
  assert.equal(first.disabled, false);
  assert.equal(first.nextAttemptAt, 11_000);

  const second = scheduleDeliveryRetry({
    previous: first,
    nowMs: 11_000,
    error: "rpc timeout",
    maxRetries: 3,
    baseBackoffMs: 10_000,
    maxBackoffMs: 60_000
  });
  assert.equal(second.disabled, false);
  assert.equal(second.nextAttemptAt, 31_000);

  const third = scheduleDeliveryRetry({
    previous: second,
    nowMs: 31_000,
    error: "rpc timeout",
    maxRetries: 3,
    baseBackoffMs: 10_000,
    maxBackoffMs: 60_000
  });
  assert.equal(third.disabled, true);
  assert.equal(third.nextAttemptAt, Number.MAX_SAFE_INTEGER);
});
