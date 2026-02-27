import { NATIVE_TOKEN } from "@infofi/shared";

export type WorkerCapabilityPolicy = {
  domain: string;
  paymentToken: string;
  minAmountWei: string;
  maxAmountWei: string;
  etaSeconds: number;
  minConfidence: number;
  proofTypeDefault: string | null;
  isEnabled: boolean;
};

export type WorkerOpenRequest = {
  requestId: string;
  paymentToken: string;
  maxAmountWei: string;
};

export type WorkerCandidate = {
  capability: WorkerCapabilityPolicy;
  offerAmountWei: bigint;
  confidence: number;
  domain: string;
};

export type DeliveryDigestRef = {
  digestHash: string;
  metadataURI: string;
};

export type DeliveryRetryState = {
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  disabled: boolean;
  storedDigest: DeliveryDigestRef | null;
};

export function normalizeDomain(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const asUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const hostname = new URL(asUrl).hostname.trim().toLowerCase();
    if (!hostname) return "";
    return hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    const lowered = trimmed.toLowerCase();
    const host = lowered
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#:]/)[0] || "";
    return host.replace(/\.$/, "");
  }
}

export function extractDomainFromSource(sourceURI: string) {
  return normalizeDomain(sourceURI);
}

export function domainsOverlap(left: string, right: string) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

export function normalizeToken(token: string) {
  const lowered = token.trim().toLowerCase();
  if (lowered === "eth") return NATIVE_TOKEN;
  return lowered;
}

export function tokenMatches(requestToken: string, capabilityToken: string) {
  return normalizeToken(requestToken) === normalizeToken(capabilityToken);
}

export function computeCandidateConfidence(budgetFit: number) {
  return 0.45 * 1 + 0.25 * budgetFit + 0.2 * 1 + 0.1 * 0.8;
}

export function pickBestCandidate(
  request: WorkerOpenRequest,
  domain: string,
  capabilities: WorkerCapabilityPolicy[]
): WorkerCandidate | null {
  const requestMaxAmount = BigInt(request.maxAmountWei);
  const candidates: WorkerCandidate[] = [];

  for (const capability of capabilities) {
    if (!capability.isEnabled) continue;
    const capabilityDomain = normalizeDomain(capability.domain);
    if (!capabilityDomain || !domainsOverlap(capabilityDomain, domain)) continue;
    if (!tokenMatches(request.paymentToken, capability.paymentToken)) continue;

    const minAmount = BigInt(capability.minAmountWei);
    const maxAmount = BigInt(capability.maxAmountWei);
    if (requestMaxAmount < minAmount) continue;

    const offerAmount = requestMaxAmount < maxAmount ? requestMaxAmount : maxAmount;
    if (offerAmount < minAmount) continue;

    const budgetFit = requestMaxAmount >= maxAmount ? 1 : 0.85;
    const confidence = computeCandidateConfidence(budgetFit);
    if (confidence < capability.minConfidence) continue;

    candidates.push({
      capability,
      offerAmountWei: offerAmount,
      confidence,
      domain
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.capability.etaSeconds - right.capability.etaSeconds ||
      (right.offerAmountWei === left.offerAmountWei ? 0 : right.offerAmountWei > left.offerAmountWei ? 1 : -1)
  );
  return candidates[0] || null;
}

export function nextDeliveryRetryDelayMs(attempts: number, baseMs: number, maxMs: number) {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  const exponent = Math.min(10, safeAttempts - 1);
  const uncapped = baseMs * Math.pow(2, exponent);
  return Math.min(maxMs, Math.max(baseMs, uncapped));
}

export function scheduleDeliveryRetry(args: {
  previous: DeliveryRetryState | undefined;
  nowMs: number;
  error: string;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}): DeliveryRetryState {
  const previousAttempts = Math.max(0, args.previous?.attempts || 0);
  const attempts = previousAttempts + 1;
  if (attempts >= args.maxRetries) {
    return {
      attempts,
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      lastError: args.error.slice(0, 512),
      disabled: true,
      storedDigest: args.previous?.storedDigest ?? null
    };
  }

  const delayMs = nextDeliveryRetryDelayMs(attempts, args.baseBackoffMs, args.maxBackoffMs);
  return {
    attempts,
    nextAttemptAt: args.nowMs + delayMs,
    lastError: args.error.slice(0, 512),
    disabled: false,
    storedDigest: args.previous?.storedDigest ?? null
  };
}
