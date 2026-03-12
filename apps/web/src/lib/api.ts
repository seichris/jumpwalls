import type {
  InfoFiDigest,
  InfoFiDomainPresenceRow,
  InfoFiDomainPresenceSummary,
  InfoFiAuthSession,
  InfoFiJob,
  InfoFiJobWithDetails,
  InfoFiOffer,
  InfoFiReimbursementPreview,
  InfoFiRequest,
  InfoFiRequestWithDetails,
  InfoFiUserProfile,
  InfoFiUserProfileResponse,
} from "./infofi-types";

export type InfoFiAgentIdentity = {
  agentAddress: string;
  displayName: string | null;
  clientVersion: string | null;
};

export type FastConfig = {
  treasuryAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenId: string;
  explorerUrl?: string | null;
};

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
}

function normalizeDomainPresenceRow(row: Partial<InfoFiDomainPresenceRow>): InfoFiDomainPresenceRow {
  return {
    domain: typeof row.domain === "string" ? row.domain : "",
    activeAgents: typeof row.activeAgents === "number" ? row.activeAgents : 0,
    activeAgentAddresses: Array.isArray(row.activeAgentAddresses)
      ? row.activeAgentAddresses.filter((entry): entry is string => typeof entry === "string")
      : [],
    medianExpectedEtaSeconds:
      typeof row.medianExpectedEtaSeconds === "number" && Number.isFinite(row.medianExpectedEtaSeconds)
        ? row.medianExpectedEtaSeconds
        : null,
    offerToHireRate7d: typeof row.offerToHireRate7d === "number" ? row.offerToHireRate7d : null,
    hireToDeliverRate7d: typeof row.hireToDeliverRate7d === "number" ? row.hireToDeliverRate7d : null,
    medianFirstOfferLatencySeconds7d:
      typeof row.medianFirstOfferLatencySeconds7d === "number" ? row.medianFirstOfferLatencySeconds7d : null,
    demandScore24h: typeof row.demandScore24h === "number" ? row.demandScore24h : 0,
    demandUniqueClients24h: typeof row.demandUniqueClients24h === "number" ? row.demandUniqueClients24h : 0,
    demandScore24hRedacted: typeof row.demandScore24hRedacted === "boolean" ? row.demandScore24hRedacted : false,
    requestCount7d: typeof row.requestCount7d === "number" ? row.requestCount7d : 0
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const jsonUnknown: unknown = await response.json().catch(() => null);
  const jsonObj = jsonUnknown && typeof jsonUnknown === "object" ? jsonUnknown : null;
  if (!response.ok) {
    const msg =
      jsonObj && typeof (jsonObj as { error?: unknown }).error === "string"
        ? ((jsonObj as { error: string }).error)
        : `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return ((jsonObj ?? {}) as unknown) as T;
}

export async function getRequests(params?: {
  requester?: string;
  status?: string;
  take?: number;
}): Promise<InfoFiRequest[]> {
  const search = new URLSearchParams();
  if (params?.requester) search.set("requester", params.requester);
  if (params?.status) search.set("status", params.status);
  if (params?.take) search.set("take", String(params.take));
  const url = `${apiBase()}/requests${search.size ? `?${search.toString()}` : ""}`;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = await parseResponse<{ requests?: InfoFiRequest[] }>(response);
  return data.requests ?? [];
}

export async function getRequestById(requestId: string): Promise<InfoFiRequestWithDetails | null> {
  const url = `${apiBase()}/requests?requestId=${encodeURIComponent(requestId)}`;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = await parseResponse<{ request?: InfoFiRequestWithDetails | null }>(response);
  return data.request ?? null;
}

export async function getOffers(params?: {
  requestId?: string;
  consultant?: string;
  status?: string;
  take?: number;
}): Promise<InfoFiOffer[]> {
  const search = new URLSearchParams();
  if (params?.requestId) search.set("requestId", params.requestId);
  if (params?.consultant) search.set("consultant", params.consultant);
  if (params?.status) search.set("status", params.status);
  if (params?.take) search.set("take", String(params.take));
  const url = `${apiBase()}/offers${search.size ? `?${search.toString()}` : ""}`;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = await parseResponse<{ offers?: InfoFiOffer[] }>(response);
  return data.offers ?? [];
}

export async function getJobs(params?: {
  requester?: string;
  consultant?: string;
  status?: string;
  take?: number;
}): Promise<InfoFiJob[]> {
  const search = new URLSearchParams();
  if (params?.requester) search.set("requester", params.requester);
  if (params?.consultant) search.set("consultant", params.consultant);
  if (params?.status) search.set("status", params.status);
  if (params?.take) search.set("take", String(params.take));
  const url = `${apiBase()}/jobs${search.size ? `?${search.toString()}` : ""}`;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = await parseResponse<{ jobs?: InfoFiJob[] }>(response);
  return data.jobs ?? [];
}

export async function getJobById(jobId: string): Promise<InfoFiJobWithDetails | null> {
  const url = `${apiBase()}/jobs?jobId=${encodeURIComponent(jobId)}`;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = await parseResponse<{ job?: InfoFiJobWithDetails | null }>(response);
  return data.job ?? null;
}

export async function getJobReimbursementPreview(jobId: string): Promise<InfoFiReimbursementPreview | null> {
  const response = await fetch(`${apiBase()}/jobs/${encodeURIComponent(jobId)}/reimbursement-preview`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  const data = await parseResponse<{ preview?: InfoFiReimbursementPreview | null }>(response);
  return data.preview ?? null;
}

export async function createDigest(input: {
  jobId: string;
  digest: string;
  consultantAddress: string;
  sourceURI?: string | null;
  question?: string | null;
  proof?: string | null;
  citations?: unknown;
}): Promise<InfoFiDigest> {
  const response = await fetch(`${apiBase()}/digests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ digest: InfoFiDigest }>(response);
  return data.digest;
}

export async function getDigestById(digestId: string): Promise<InfoFiDigest | null> {
  const response = await fetch(`${apiBase()}/digests/${encodeURIComponent(digestId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  const data = await parseResponse<{ digest?: InfoFiDigest | null }>(response);
  return data.digest ?? null;
}

function parseDigestIdFromMetadataURI(metadataURI: string): string | null {
  if (!metadataURI) return null;
  try {
    const parsed = new URL(metadataURI);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    if (parts[parts.length - 2] !== "digests") return null;
    return parts[parts.length - 1] || null;
  } catch {
    const parts = metadataURI.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    if (parts[parts.length - 2] !== "digests") return null;
    return parts[parts.length - 1] || null;
  }
}

export async function getDigestByMetadataURI(metadataURI: string): Promise<InfoFiDigest | null> {
  const id = parseDigestIdFromMetadataURI(metadataURI);
  if (!id) return null;
  return getDigestById(id);
}

export async function getInfoFiIds(params: {
  requester: string;
  sourceURI: string;
  question: string;
  salt: string;
  consultant?: string;
  amountWei?: string;
  etaSeconds?: string;
  offerId?: string;
}): Promise<{ requestId: string; offerId: string | null; jobId: string | null }> {
  const search = new URLSearchParams();
  search.set("requester", params.requester);
  search.set("sourceURI", params.sourceURI);
  search.set("question", params.question);
  search.set("salt", params.salt);
  if (params.consultant) search.set("consultant", params.consultant);
  if (params.amountWei) search.set("amountWei", params.amountWei);
  if (params.etaSeconds) search.set("etaSeconds", params.etaSeconds);
  if (params.offerId) search.set("offerId", params.offerId);
  const response = await fetch(`${apiBase()}/infofi/id?${search.toString()}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await parseResponse<{ requestId: string; offerId: string | null; jobId: string | null }>(response);
  return data;
}

export async function getDomainPresence(params?: { take?: number; minActiveAgents?: number }): Promise<InfoFiDomainPresenceRow[]> {
  const search = new URLSearchParams();
  if (params?.take) search.set("take", String(params.take));
  if (params?.minActiveAgents != null) search.set("minActiveAgents", String(params.minActiveAgents));
  const response = await fetch(`${apiBase()}/domains/presence${search.size ? `?${search.toString()}` : ""}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await parseResponse<{ domains?: InfoFiDomainPresenceRow[] }>(response);
  const rows = Array.isArray(data.domains) ? data.domains : [];
  return rows.map((row) => normalizeDomainPresenceRow(row));
}

export async function getDomainSummary(domain: string): Promise<InfoFiDomainPresenceSummary | null> {
  if (!domain.trim()) return null;
  const response = await fetch(`${apiBase()}/domains/${encodeURIComponent(domain)}/summary`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  const data = await parseResponse<{ summary?: InfoFiDomainPresenceSummary | null }>(response);
  return data.summary ? normalizeDomainPresenceRow(data.summary) : null;
}

export async function getAgentIdentity(agentAddress: string): Promise<InfoFiAgentIdentity | null> {
  const normalized = agentAddress.trim().toLowerCase();
  if (!normalized) return null;
  const response = await fetch(`${apiBase()}/agents/${encodeURIComponent(normalized)}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  const data = await parseResponse<{
    agent?: {
      profile?: {
        agentAddress?: string;
        displayName?: string | null;
      } | null;
      heartbeat?: {
        agentAddress?: string;
        clientVersion?: string | null;
      } | null;
    } | null;
  }>(response);
  if (!data.agent) return null;
  const addressFromPayload =
    (typeof data.agent.profile?.agentAddress === "string" ? data.agent.profile.agentAddress : "") ||
    (typeof data.agent.heartbeat?.agentAddress === "string" ? data.agent.heartbeat.agentAddress : "") ||
    normalized;
  return {
    agentAddress: addressFromPayload.toLowerCase(),
    displayName: typeof data.agent.profile?.displayName === "string" ? data.agent.profile.displayName : null,
    clientVersion: typeof data.agent.heartbeat?.clientVersion === "string" ? data.agent.heartbeat.clientVersion : null,
  };
}

export async function createUserAuthChallenge(address: string): Promise<{ nonce: string; messageToSign: string; expiresAt: string }> {
  const response = await fetch(`${apiBase()}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ address }),
  });
  const data = await parseResponse<{ challenge: { nonce: string; messageToSign: string; expiresAt: string } }>(response);
  return data.challenge;
}

export async function verifyUserAuthChallenge(input: { address: string; nonce: string; signature: string }) {
  const response = await fetch(`${apiBase()}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ session: InfoFiAuthSession }>(response);
  return data.session;
}

export async function getAuthSession() {
  const response = await fetch(`${apiBase()}/auth/session`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await parseResponse<{ session: InfoFiAuthSession }>(response);
  return data.session;
}

export async function getUserProfile() {
  const response = await fetch(`${apiBase()}/user/profile`, {
    credentials: "include",
    cache: "no-store",
  });
  return await parseResponse<InfoFiUserProfileResponse>(response);
}

export async function createFastBindChallenge(input: { address: string; publicKey: string }) {
  const response = await fetch(`${apiBase()}/user/fast/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{
    challenge: { nonce: string; address: string; publicKey: string; messageToSign: string; expiresAt: string };
  }>(response);
  return data.challenge;
}

export async function bindFastWallet(input: {
  address: string;
  publicKey: string;
  nonce: string;
  signature: string;
  messageBytes: string;
}) {
  const response = await fetch(`${apiBase()}/user/fast/bind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ user: InfoFiUserProfile }>(response);
  return data.user;
}

export async function createFastRequest(input: {
  sourceURI: string;
  question: string;
  maxAmountWei: string;
  fundingCertificate: unknown;
}) {
  const response = await fetch(`${apiBase()}/fast/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ request: InfoFiRequest }>(response);
  return data.request;
}

export async function getFastConfig() {
  const response = await fetch(`${apiBase()}/fast/config`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await parseResponse<{ config: FastConfig }>(response);
  return data.config;
}

export async function createFastOffer(input: {
  requestId: string;
  amountWei: string;
  etaSeconds: number;
  proofType: string;
}) {
  const response = await fetch(`${apiBase()}/fast/offers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ offer: InfoFiOffer }>(response);
  return data.offer;
}

export async function hireFastOffer(offerId: string) {
  const response = await fetch(`${apiBase()}/fast/offers/${encodeURIComponent(offerId)}/hire`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseResponse<{ job: InfoFiJob }>(response);
  return data.job;
}

export async function deliverFastJob(input: {
  jobId: string;
  digestHash: string;
  metadataURI: string;
  proofTypeOrURI: string;
}) {
  const response = await fetch(`${apiBase()}/fast/jobs/${encodeURIComponent(input.jobId)}/deliver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ job: InfoFiJob }>(response);
  return data.job;
}

export async function acceptFastJob(jobId: string) {
  const response = await fetch(`${apiBase()}/fast/jobs/${encodeURIComponent(jobId)}/accept`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseResponse<{ job: InfoFiJob }>(response);
  return data.job;
}

export async function refundFastJob(jobId: string) {
  const response = await fetch(`${apiBase()}/fast/jobs/${encodeURIComponent(jobId)}/refund`, {
    method: "POST",
    credentials: "include",
  });
  const data = await parseResponse<{ job: InfoFiJob }>(response);
  return data.job;
}
