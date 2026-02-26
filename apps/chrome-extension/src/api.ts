import type { ContractConfig, OpenRequest } from "./types";

export function normalizeApiUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function parseApiUrl(raw: string): URL {
  const normalized = normalizeApiUrl(raw);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("API URL must be a valid absolute URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("API URL must use http:// or https://");
  }
  return parsed;
}

export function apiOriginForDisplay(raw: string): string {
  return parseApiUrl(raw).origin;
}

export function apiOriginPermissionPattern(raw: string): string {
  const parsed = parseApiUrl(raw);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export async function fetchContractConfig(apiUrl: string): Promise<ContractConfig> {
  const url = `${normalizeApiUrl(apiUrl)}/contract`;
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch contract config (${response.status})`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data.contractAddress !== "string" || typeof data.chainId !== "number" || typeof data.rpcUrl !== "string") {
    throw new Error("Unexpected /contract response payload");
  }

  return {
    chainId: data.chainId,
    rpcUrl: data.rpcUrl,
    contractAddress: data.contractAddress.toLowerCase() as `0x${string}`,
    contractKind: typeof data.contractKind === "string" ? data.contractKind : undefined
  };
}

export async function fetchOpenRequests(apiUrl: string, take = 250): Promise<OpenRequest[]> {
  const url = `${normalizeApiUrl(apiUrl)}/requests?status=OPEN&take=${take}`;
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch open requests (${response.status})`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (!Array.isArray(payload.requests)) return [];
  return payload.requests as OpenRequest[];
}
