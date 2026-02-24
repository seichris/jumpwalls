function isTruthy(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseChainIds(raw: string | undefined): Set<number> {
  const input = (raw || "").trim();
  const fallback = input.length > 0 ? input : "1";
  const out = new Set<number>();

  for (const part of fallback.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) out.add(parsed);
  }

  if (out.size === 0) out.add(1);
  return out;
}

export function isPrivyFeatureEnabled() {
  const enabled = isTruthy(process.env.NEXT_PUBLIC_PRIVY_ENABLED);
  const appId = (process.env.NEXT_PUBLIC_PRIVY_APP_ID || "").trim();
  return enabled && appId.length > 0;
}

export function privyFundingSupportedChainIds() {
  return parseChainIds(process.env.NEXT_PUBLIC_PRIVY_FUNDING_CHAIN_IDS);
}

export function isPrivyFundingSupportedChain(chainId: number) {
  return privyFundingSupportedChainIds().has(chainId);
}

export function defaultPrivyFundingAmountUsd() {
  const raw = (process.env.NEXT_PUBLIC_PRIVY_DEFAULT_FUND_AMOUNT_USD || "").trim();
  if (!raw) return "50";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "50";
  return raw;
}
