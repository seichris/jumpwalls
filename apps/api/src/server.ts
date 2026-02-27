import Fastify from "fastify";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import crypto from "node:crypto";
import { isAddress, keccak256, stringToHex, verifyMessage } from "viem";
import { getPrisma } from "./db.js";
import { combineFairUseWithLlm, parseFairUseEnforcementMode, reviewDigestFairUse } from "./fairUse.js";
import { reviewDigestFairUseWithGemini } from "./fairUseGemini.js";
import { buildReimbursementPreview } from "./x402.js";

const AGENT_CHALLENGE_PURPOSES = new Set(["signup", "heartbeat"] as const);
const AGENT_CHALLENGE_TTL_SECONDS_DEFAULT = 300;
const AGENT_HEARTBEAT_DEFAULT_TTL_SECONDS = 120;
const AGENT_HEARTBEAT_MIN_TTL_SECONDS = 30;
const AGENT_HEARTBEAT_MAX_TTL_SECONDS = 900;
const DOMAIN_SIGNAL_SOURCE_EXTENSION = "EXTENSION";
const DOMAIN_SIGNAL_MAX_BUCKETS_PER_REQUEST = 200;
const AGENT_SIGNATURE_REGEX = /^0x[a-fA-F0-9]{130}$/;

type AgentChallengePurpose = "signup" | "heartbeat";
type ParsedAgentCapability = {
  domain: string;
  paymentToken: string;
  minAmountWei: string;
  maxAmountWei: string;
  etaSeconds: number;
  minConfidence: number;
  proofTypeDefault: string | null;
  isEnabled: boolean;
};

export async function buildServer() {
  const app = Fastify({ logger: true });
  const prisma = getPrisma();
  const chainId = Number(process.env.CHAIN_ID || "0");
  const contractAddress = (process.env.CONTRACT_ADDRESS || "").toLowerCase();
  const geminiModel = (process.env.GEMINI_MODEL || "gemini-3-flash-preview").trim() || "gemini-3-flash-preview";
  const geminiTimeoutRaw = Number(process.env.GEMINI_TIMEOUT_MS || "8000");
  const geminiTimeoutMs =
    Number.isFinite(geminiTimeoutRaw) && geminiTimeoutRaw > 0
      ? Math.min(Math.max(Math.round(geminiTimeoutRaw), 1000), 30000)
      : 8000;

  function scopedWhere() {
    const where: any = {};
    if (chainId) where.chainId = chainId;
    if (contractAddress) where.contractAddress = contractAddress;
    return where;
  }

  function parseBody(rawBody: any) {
    let body: any = rawBody;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
      try {
        const text = Buffer.from(body).toString("utf8");
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return body;
  }

  function readHeaderString(value: string | string[] | undefined) {
    if (Array.isArray(value)) return String(value[0] || "").trim();
    return typeof value === "string" ? value.trim() : "";
  }

  function infoFiJobStatus(job: { deliveredAt: Date | null; remainingWei: string }) {
    if (!job.deliveredAt) return "HIRED";
    try {
      if (BigInt(job.remainingWei) === 0n) return "CLOSED";
    } catch {
      return "DELIVERED";
    }
    return "DELIVERED";
  }

  function normalizeDomain(input: string) {
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

  function extractDomainFromSource(sourceURI: string) {
    return normalizeDomain(sourceURI);
  }

  function normalizeAddress(value: unknown) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!isAddress(trimmed)) return "";
    return trimmed.toLowerCase();
  }

  function parseNonNegativeInt(value: unknown, fallback: number) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.floor(n);
    if (rounded < 0) return fallback;
    return rounded;
  }

  function parsePositiveInt(value: unknown, fallback: number) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.floor(n);
    if (rounded <= 0) return fallback;
    return rounded;
  }

  function parseStringArrayJson(raw: string) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [] as string[];
      return parsed.filter((entry): entry is string => typeof entry === "string");
    } catch {
      return [] as string[];
    }
  }

  function parseEtaByDomainJson(raw: string | null) {
    if (!raw) return {} as Record<string, number>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, number>;
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const domain = normalizeDomain(key);
        if (!domain) continue;
        const eta = parsePositiveInt(value, -1);
        if (eta <= 0) continue;
        out[domain] = eta;
      }
      return out;
    } catch {
      return {} as Record<string, number>;
    }
  }

  function medianInt(values: number[]) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle] ?? null;
    const left = sorted[middle - 1];
    const right = sorted[middle];
    if (left == null || right == null) return null;
    return Math.round((left + right) / 2);
  }

  function chainScopeData() {
    return {
      chainId: Number.isFinite(chainId) ? chainId : 0,
      contractAddress
    };
  }

  function buildAgentChallengeMessage(args: {
    purpose: AgentChallengePurpose;
    agentAddress: string;
    nonce: string;
    expiresAt: Date;
  }) {
    return [
      "InfoFi Agent Authentication",
      `Purpose: ${args.purpose}`,
      `Agent: ${args.agentAddress}`,
      `Nonce: ${args.nonce}`,
      `ExpiresAt: ${args.expiresAt.toISOString()}`,
      `ChainId: ${Number.isFinite(chainId) ? chainId : 0}`,
      `Contract: ${contractAddress || "unconfigured"}`
    ].join("\n");
  }

  async function verifyAndConsumeAgentChallenge(args: {
    purpose: AgentChallengePurpose;
    agentAddress: string;
    nonce: string;
    signature: string;
  }) {
    const challenge = await prisma.infoFiAgentAuthChallenge.findUnique({ where: { nonce: args.nonce } });
    if (!challenge) return { ok: false as const, error: "Invalid nonce" };

    if (challenge.chainId !== (Number.isFinite(chainId) ? chainId : 0) || challenge.contractAddress !== contractAddress) {
      return { ok: false as const, error: "Challenge network scope mismatch" };
    }
    if (challenge.agentAddress !== args.agentAddress) return { ok: false as const, error: "Challenge agent mismatch" };
    if (challenge.purpose !== args.purpose) return { ok: false as const, error: "Challenge purpose mismatch" };
    if (challenge.usedAt) return { ok: false as const, error: "Challenge already used" };
    if (challenge.expiresAt.getTime() <= Date.now()) return { ok: false as const, error: "Challenge expired" };

    if (!AGENT_SIGNATURE_REGEX.test(args.signature)) return { ok: false as const, error: "Invalid signature format" };
    const valid = await verifyMessage({
      address: args.agentAddress as `0x${string}`,
      message: challenge.message,
      signature: args.signature as `0x${string}`
    });
    if (!valid) return { ok: false as const, error: "Signature verification failed" };

    const used = await prisma.infoFiAgentAuthChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: new Date() }
    });
    if (used.count !== 1) return { ok: false as const, error: "Challenge already used" };

    return { ok: true as const };
  }

  function parseCapabilityEntries(raw: unknown) {
    if (!Array.isArray(raw)) return { capabilities: [] as ParsedAgentCapability[], error: "capabilities must be an array" };
    const parsed: ParsedAgentCapability[] = [];
    for (let index = 0; index < raw.length; index += 1) {
      const entry = raw[index];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}] must be an object` };
      }
      const item = entry as Record<string, unknown>;

      const domain = normalizeDomain(typeof item.domain === "string" ? item.domain : "");
      if (!domain) return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}].domain is invalid` };

      const paymentTokenRaw = typeof item.paymentToken === "string" ? item.paymentToken.trim() : "";
      let paymentToken = "";
      if (!paymentTokenRaw) {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}].paymentToken is required` };
      } else if (paymentTokenRaw.toUpperCase() === "ETH") {
        paymentToken = "ETH";
      } else if (isAddress(paymentTokenRaw)) {
        paymentToken = paymentTokenRaw.toLowerCase();
      } else {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}].paymentToken must be ETH or address` };
      }

      const minAmountWei = typeof item.minAmountWei === "string" ? item.minAmountWei.trim() : "";
      const maxAmountWei = typeof item.maxAmountWei === "string" ? item.maxAmountWei.trim() : "";
      if (!/^\d+$/.test(minAmountWei) || !/^\d+$/.test(maxAmountWei)) {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}] amount bounds must be integer strings` };
      }
      if (BigInt(maxAmountWei) < BigInt(minAmountWei)) {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}] maxAmountWei must be >= minAmountWei` };
      }

      const etaSecondsRaw = parsePositiveInt(item.etaSeconds, -1);
      if (etaSecondsRaw <= 0 || etaSecondsRaw > 7 * 24 * 60 * 60) {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}].etaSeconds must be in 1..604800` };
      }

      const minConfidenceRaw = typeof item.minConfidence === "number" ? item.minConfidence : Number(item.minConfidence ?? 0.65);
      if (!Number.isFinite(minConfidenceRaw) || minConfidenceRaw < 0 || minConfidenceRaw > 1) {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}].minConfidence must be between 0 and 1` };
      }

      const proofTypeDefaultRaw =
        typeof item.proofTypeDefault === "string" ? item.proofTypeDefault.trim() : item.proofTypeDefault == null ? "" : "";
      const proofTypeDefault = proofTypeDefaultRaw ? proofTypeDefaultRaw.slice(0, 256) : null;
      const isEnabled = typeof item.isEnabled === "boolean" ? item.isEnabled : true;

      parsed.push({
        domain,
        paymentToken,
        minAmountWei,
        maxAmountWei,
        etaSeconds: etaSecondsRaw,
        minConfidence: minConfidenceRaw,
        proofTypeDefault,
        isEnabled
      });
    }
    return { capabilities: parsed };
  }

  async function computeDomainPresenceRows(domainFilter?: string) {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const activeHeartbeats = await prisma.infoFiAgentHeartbeat.findMany({
      where: { ...scopedWhere(), expiresAt: { gt: now } },
      orderBy: [{ agentAddress: "asc" }, { lastSeenAt: "desc" }],
      take: 5000
    });

    const latestHeartbeatByAgent = new Map<string, (typeof activeHeartbeats)[number]>();
    for (const heartbeat of activeHeartbeats) {
      if (latestHeartbeatByAgent.has(heartbeat.agentAddress)) continue;
      latestHeartbeatByAgent.set(heartbeat.agentAddress, heartbeat);
    }

    const activeAgentAddresses = Array.from(latestHeartbeatByAgent.keys());
    const capabilities =
      activeAgentAddresses.length > 0
        ? await prisma.infoFiAgentCapability.findMany({
            where: {
              ...scopedWhere(),
              isEnabled: true,
              agentAddress: { in: activeAgentAddresses }
            },
            select: {
              agentAddress: true,
              domain: true,
              etaSeconds: true
            }
          })
        : [];

    const capabilityEtaByAgentDomain = new Map<string, number>();
    for (const capability of capabilities) {
      const key = `${capability.agentAddress}|${capability.domain}`;
      const existing = capabilityEtaByAgentDomain.get(key);
      if (existing == null || capability.etaSeconds < existing) {
        capabilityEtaByAgentDomain.set(key, capability.etaSeconds);
      }
    }

    const liveByDomain = new Map<
      string,
      {
        activeAgents: Set<string>;
        etaSeconds: number[];
        activeAgentAddresses: string[];
      }
    >();

    for (const [agentAddress, heartbeat] of latestHeartbeatByAgent.entries()) {
      const domains = Array.from(new Set(parseStringArrayJson(heartbeat.domainsLoggedInJson).map((d) => normalizeDomain(d)).filter(Boolean)));
      if (domains.length === 0) continue;
      const etaByDomain = parseEtaByDomainJson(heartbeat.expectedEtaJson);
      for (const domain of domains) {
        if (domainFilter && domain !== domainFilter) continue;
        const key = `${agentAddress}|${domain}`;
        const etaSeconds = etaByDomain[domain] ?? capabilityEtaByAgentDomain.get(key) ?? null;
        const entry = liveByDomain.get(domain) ?? {
          activeAgents: new Set<string>(),
          etaSeconds: [],
          activeAgentAddresses: []
        };
        if (!entry.activeAgents.has(agentAddress)) {
          entry.activeAgents.add(agentAddress);
          entry.activeAgentAddresses.push(agentAddress);
        }
        if (typeof etaSeconds === "number" && Number.isFinite(etaSeconds) && etaSeconds > 0) {
          entry.etaSeconds.push(Math.round(etaSeconds));
        }
        liveByDomain.set(domain, entry);
      }
    }

    const recentRequests = await prisma.infoFiRequest.findMany({
      where: {
        ...scopedWhere(),
        createdAt: { gte: sevenDaysAgo }
      },
      select: {
        requestId: true,
        sourceURI: true,
        createdAt: true
      }
    });

    const requestById = new Map<string, { domain: string; createdAtMs: number }>();
    const domainRequestCount = new Map<string, number>();
    for (const request of recentRequests) {
      const domain = extractDomainFromSource(request.sourceURI);
      if (!domain) continue;
      if (domainFilter && domain !== domainFilter) continue;
      requestById.set(request.requestId, { domain, createdAtMs: request.createdAt.getTime() });
      domainRequestCount.set(domain, (domainRequestCount.get(domain) || 0) + 1);
    }

    const requestIds = Array.from(requestById.keys());
    const recentOffers =
      requestIds.length > 0
        ? await prisma.infoFiOffer.findMany({
            where: {
              ...scopedWhere(),
              requestId: { in: requestIds }
            },
            select: {
              requestId: true,
              createdAt: true
            }
          })
        : [];
    const recentJobs =
      requestIds.length > 0
        ? await prisma.infoFiJob.findMany({
            where: {
              ...scopedWhere(),
              requestId: { in: requestIds }
            },
            select: {
              requestId: true,
              deliveredAt: true
            }
          })
        : [];

    const offerCountByDomain = new Map<string, number>();
    const hiredCountByDomain = new Map<string, number>();
    const deliveredCountByDomain = new Map<string, number>();
    const firstOfferAtMsByRequestId = new Map<string, number>();

    for (const offer of recentOffers) {
      const requestMeta = requestById.get(offer.requestId);
      if (!requestMeta) continue;
      offerCountByDomain.set(requestMeta.domain, (offerCountByDomain.get(requestMeta.domain) || 0) + 1);
      const offerMs = offer.createdAt.getTime();
      const existing = firstOfferAtMsByRequestId.get(offer.requestId);
      if (existing == null || offerMs < existing) firstOfferAtMsByRequestId.set(offer.requestId, offerMs);
    }
    for (const job of recentJobs) {
      const requestMeta = requestById.get(job.requestId);
      if (!requestMeta) continue;
      hiredCountByDomain.set(requestMeta.domain, (hiredCountByDomain.get(requestMeta.domain) || 0) + 1);
      if (job.deliveredAt) {
        deliveredCountByDomain.set(requestMeta.domain, (deliveredCountByDomain.get(requestMeta.domain) || 0) + 1);
      }
    }

    const firstOfferLatencyByDomain = new Map<string, number[]>();
    for (const [requestId, firstOfferMs] of firstOfferAtMsByRequestId.entries()) {
      const requestMeta = requestById.get(requestId);
      if (!requestMeta) continue;
      const latencySeconds = Math.max(0, Math.round((firstOfferMs - requestMeta.createdAtMs) / 1000));
      const existing = firstOfferLatencyByDomain.get(requestMeta.domain) ?? [];
      existing.push(latencySeconds);
      firstOfferLatencyByDomain.set(requestMeta.domain, existing);
    }

    const demandSignals = await prisma.infoFiDomainDemandSignal.findMany({
      where: {
        ...scopedWhere(),
        source: DOMAIN_SIGNAL_SOURCE_EXTENSION,
        bucketStart: { gte: dayAgo }
      },
      select: {
        domain: true,
        signalCount: true
      }
    });
    const demandScoreByDomain = new Map<string, number>();
    for (const signal of demandSignals) {
      if (domainFilter && signal.domain !== domainFilter) continue;
      demandScoreByDomain.set(signal.domain, (demandScoreByDomain.get(signal.domain) || 0) + signal.signalCount);
    }

    const domains = new Set<string>();
    for (const domain of liveByDomain.keys()) domains.add(domain);
    for (const domain of domainRequestCount.keys()) domains.add(domain);
    for (const domain of demandScoreByDomain.keys()) domains.add(domain);
    if (domainFilter) domains.add(domainFilter);

    const rows = Array.from(domains)
      .filter(Boolean)
      .map((domain) => {
        const live = liveByDomain.get(domain);
        const offerCount = offerCountByDomain.get(domain) || 0;
        const hiredCount = hiredCountByDomain.get(domain) || 0;
        const deliveredCount = deliveredCountByDomain.get(domain) || 0;
        const latencies = firstOfferLatencyByDomain.get(domain) || [];
        const activeAgents = live ? live.activeAgents.size : 0;
        const medianExpectedEtaSeconds = medianInt(live?.etaSeconds || []);
        const offerToHireRate7d = offerCount > 0 ? Number((hiredCount / offerCount).toFixed(4)) : null;
        const hireToDeliverRate7d = hiredCount > 0 ? Number((deliveredCount / hiredCount).toFixed(4)) : null;
        const medianFirstOfferLatencySeconds7d = medianInt(latencies);
        const demandScore24h = demandScoreByDomain.get(domain) || 0;
        return {
          domain,
          activeAgents,
          activeAgentAddresses: live ? [...live.activeAgentAddresses].sort() : [],
          medianExpectedEtaSeconds,
          offerToHireRate7d,
          hireToDeliverRate7d,
          medianFirstOfferLatencySeconds7d,
          demandScore24h,
          requestCount7d: domainRequestCount.get(domain) || 0
        };
      });

    return rows;
  }

  const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";
  const webOrigins = webOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(webOrigins.length > 0 ? webOrigins : ["http://localhost:3000"]);
  const corsOrigin: FastifyCorsOptions["origin"] = async (origin?: string) => {
    if (!origin) return false;
    return allowedOrigins.has(origin) ? origin : false;
  };
  await app.register(cors, { origin: corsOrigin, credentials: true });

  app.get("/health", async () => ({ ok: true }));

  app.post("/agents/challenge", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }

    const agentAddress = normalizeAddress((body as Record<string, unknown>).agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const purposeRaw = String((body as Record<string, unknown>).purpose || "signup")
      .trim()
      .toLowerCase();
    if (!AGENT_CHALLENGE_PURPOSES.has(purposeRaw as AgentChallengePurpose)) {
      return reply.code(400).send({ error: "purpose must be signup or heartbeat" });
    }
    const purpose = purposeRaw as AgentChallengePurpose;

    const ttlRaw = parsePositiveInt(
      (body as Record<string, unknown>).ttlSeconds,
      Number(process.env.AGENT_CHALLENGE_TTL_SECONDS || AGENT_CHALLENGE_TTL_SECONDS_DEFAULT)
    );
    const ttlSeconds = Math.min(Math.max(ttlRaw, 30), 3600);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const nonce = crypto.randomBytes(16).toString("hex");
    const message = buildAgentChallengeMessage({ purpose, agentAddress, nonce, expiresAt });
    const chainScope = chainScopeData();

    await prisma.infoFiAgentAuthChallenge.create({
      data: {
        agentAddress,
        nonce,
        purpose,
        message,
        expiresAt,
        ...chainScope
      }
    });

    return reply.send({
      challenge: {
        agentAddress,
        purpose,
        nonce,
        expiresAt: expiresAt.toISOString(),
        messageToSign: message,
        chainId: chainScope.chainId,
        contractAddress: chainScope.contractAddress
      }
    });
  });

  app.post("/agents/signup", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const agentAddress = normalizeAddress(data.agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const nonce = typeof data.nonce === "string" ? data.nonce.trim() : "";
    if (!nonce) return reply.code(400).send({ error: "Missing nonce" });

    const signature = typeof data.signature === "string" ? data.signature.trim() : "";
    if (!signature) return reply.code(400).send({ error: "Missing signature" });

    const parsed = parseCapabilityEntries(data.capabilities);
    if (parsed.error) return reply.code(400).send({ error: parsed.error });

    const challenge = await verifyAndConsumeAgentChallenge({
      purpose: "signup",
      agentAddress,
      nonce,
      signature
    });
    if (!challenge.ok) return reply.code(401).send({ error: challenge.error });

    const displayNameRaw = typeof data.displayName === "string" ? data.displayName.trim() : "";
    const displayName = displayNameRaw ? displayNameRaw.slice(0, 80) : null;

    const statusRaw = typeof data.status === "string" ? data.status.trim().toUpperCase() : "ACTIVE";
    if (statusRaw !== "ACTIVE" && statusRaw !== "PAUSED") {
      return reply.code(400).send({ error: "status must be ACTIVE or PAUSED" });
    }

    const chainScope = chainScopeData();

    await prisma.$transaction(async (tx) => {
      await tx.infoFiAgentProfile.upsert({
        where: {
          agentAddress_chainId_contractAddress: {
            agentAddress,
            chainId: chainScope.chainId,
            contractAddress: chainScope.contractAddress
          }
        },
        create: {
          agentAddress,
          displayName,
          status: statusRaw,
          ...chainScope
        },
        update: {
          displayName,
          status: statusRaw
        }
      });

      await tx.infoFiAgentCapability.deleteMany({
        where: {
          ...scopedWhere(),
          agentAddress
        }
      });

      if (parsed.capabilities.length > 0) {
        await tx.infoFiAgentCapability.createMany({
          data: parsed.capabilities.map((capability) => ({
            agentAddress,
            domain: capability.domain,
            paymentToken: capability.paymentToken,
            minAmountWei: capability.minAmountWei,
            maxAmountWei: capability.maxAmountWei,
            etaSeconds: capability.etaSeconds,
            minConfidence: capability.minConfidence,
            proofTypeDefault: capability.proofTypeDefault,
            isEnabled: capability.isEnabled,
            ...chainScope
          }))
        });
      }
    });

    const [profile, capabilities] = await Promise.all([
      prisma.infoFiAgentProfile.findUnique({
        where: {
          agentAddress_chainId_contractAddress: {
            agentAddress,
            chainId: chainScope.chainId,
            contractAddress: chainScope.contractAddress
          }
        }
      }),
      prisma.infoFiAgentCapability.findMany({
        where: { ...scopedWhere(), agentAddress },
        orderBy: [{ domain: "asc" }, { paymentToken: "asc" }]
      })
    ]);

    return reply.send({
      agent: {
        profile,
        capabilities
      }
    });
  });

  app.post("/agents/heartbeat", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const agentAddress = normalizeAddress(data.agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const nonce = typeof data.nonce === "string" ? data.nonce.trim() : "";
    if (!nonce) return reply.code(400).send({ error: "Missing nonce" });

    const signature = typeof data.signature === "string" ? data.signature.trim() : "";
    if (!signature) return reply.code(400).send({ error: "Missing signature" });

    if (!Array.isArray(data.domainsLoggedIn)) {
      return reply.code(400).send({ error: "domainsLoggedIn must be an array of domains" });
    }
    const domainsLoggedIn = Array.from(
      new Set(
        data.domainsLoggedIn
          .map((entry) => (typeof entry === "string" ? normalizeDomain(entry) : ""))
          .filter((entry) => entry.length > 0)
      )
    );
    if (domainsLoggedIn.length > 500) return reply.code(400).send({ error: "domainsLoggedIn exceeds 500 domains" });

    const expectedEtaByDomain: Record<string, number> = {};
    if (data.expectedEtaByDomain != null) {
      if (!data.expectedEtaByDomain || typeof data.expectedEtaByDomain !== "object" || Array.isArray(data.expectedEtaByDomain)) {
        return reply.code(400).send({ error: "expectedEtaByDomain must be an object" });
      }
      for (const [domainRaw, etaRaw] of Object.entries(data.expectedEtaByDomain as Record<string, unknown>)) {
        const domain = normalizeDomain(domainRaw);
        if (!domain) continue;
        const etaSeconds = parsePositiveInt(etaRaw, -1);
        if (etaSeconds <= 0 || etaSeconds > 7 * 24 * 60 * 60) {
          return reply.code(400).send({ error: `expectedEtaByDomain.${domain} must be in 1..604800` });
        }
        expectedEtaByDomain[domain] = etaSeconds;
      }
    }

    const ttlRequested = parsePositiveInt(data.ttlSeconds, AGENT_HEARTBEAT_DEFAULT_TTL_SECONDS);
    const ttlSeconds = Math.min(
      Math.max(ttlRequested, AGENT_HEARTBEAT_MIN_TTL_SECONDS),
      Number(process.env.AGENT_HEARTBEAT_MAX_TTL_SECONDS || AGENT_HEARTBEAT_MAX_TTL_SECONDS)
    );

    const challenge = await verifyAndConsumeAgentChallenge({
      purpose: "heartbeat",
      agentAddress,
      nonce,
      signature
    });
    if (!challenge.ok) return reply.code(401).send({ error: challenge.error });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const chainScope = chainScopeData();
    const clientVersion = typeof data.clientVersion === "string" ? data.clientVersion.trim().slice(0, 64) : null;
    const signatureDigest = keccak256(stringToHex(signature.toLowerCase()));

    await prisma.$transaction(async (tx) => {
      await tx.infoFiAgentProfile.upsert({
        where: {
          agentAddress_chainId_contractAddress: {
            agentAddress,
            chainId: chainScope.chainId,
            contractAddress: chainScope.contractAddress
          }
        },
        create: {
          agentAddress,
          status: "ACTIVE",
          ...chainScope
        },
        update: {
          status: "ACTIVE"
        }
      });

      await tx.infoFiAgentHeartbeat.create({
        data: {
          agentAddress,
          domainsLoggedInJson: JSON.stringify(domainsLoggedIn),
          expectedEtaJson: JSON.stringify(expectedEtaByDomain),
          lastSeenAt: now,
          expiresAt,
          signatureDigest,
          clientVersion,
          ...chainScope
        }
      });
    });

    return reply.send({
      heartbeat: {
        agentAddress,
        domainsLoggedIn,
        expectedEtaByDomain,
        lastSeenAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttlSeconds
      }
    });
  });

  app.post("/agents/decisions", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const agentAddress = normalizeAddress(data.agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const requestId = typeof data.requestId === "string" ? data.requestId.trim().toLowerCase() : "";
    if (!/^0x[a-fA-F0-9]{64}$/.test(requestId)) return reply.code(400).send({ error: "requestId must be bytes32 hex" });

    const domain = normalizeDomain(typeof data.domain === "string" ? data.domain : "");
    if (!domain) return reply.code(400).send({ error: "Invalid domain" });

    const decisionRaw = typeof data.decision === "string" ? data.decision.trim().toUpperCase() : "";
    if (!["SKIP", "OFFERED", "FAILED"].includes(decisionRaw)) {
      return reply.code(400).send({ error: "decision must be SKIP, OFFERED, or FAILED" });
    }

    const confidence = Number(data.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return reply.code(400).send({ error: "confidence must be in [0,1]" });
    }

    const reasonCode = typeof data.reasonCode === "string" ? data.reasonCode.trim().slice(0, 64) : "";
    if (!reasonCode) return reply.code(400).send({ error: "reasonCode is required" });

    const reasonDetail = typeof data.reasonDetail === "string" ? data.reasonDetail.trim().slice(0, 1024) : null;

    const offerAmountWeiRaw = typeof data.offerAmountWei === "string" ? data.offerAmountWei.trim() : "";
    const offerAmountWei = offerAmountWeiRaw ? (/^\d+$/.test(offerAmountWeiRaw) ? offerAmountWeiRaw : null) : null;
    if (offerAmountWeiRaw && !offerAmountWei) {
      return reply.code(400).send({ error: "offerAmountWei must be an integer string" });
    }

    const etaSecondsRaw = data.etaSeconds == null ? null : parsePositiveInt(data.etaSeconds, -1);
    if (etaSecondsRaw != null && (etaSecondsRaw <= 0 || etaSecondsRaw > 7 * 24 * 60 * 60)) {
      return reply.code(400).send({ error: "etaSeconds must be in 1..604800" });
    }

    const offerIdRaw = typeof data.offerId === "string" ? data.offerId.trim().toLowerCase() : "";
    const offerId = offerIdRaw ? (/^0x[a-fA-F0-9]{64}$/.test(offerIdRaw) ? offerIdRaw : null) : null;
    if (offerIdRaw && !offerId) return reply.code(400).send({ error: "offerId must be bytes32 hex" });

    const txHashRaw = typeof data.txHash === "string" ? data.txHash.trim().toLowerCase() : "";
    const txHash = txHashRaw ? (/^0x[a-fA-F0-9]{64}$/.test(txHashRaw) ? txHashRaw : null) : null;
    if (txHashRaw && !txHash) return reply.code(400).send({ error: "txHash must be transaction hash hex" });

    const chainScope = chainScopeData();
    await prisma.infoFiAgentProfile.upsert({
      where: {
        agentAddress_chainId_contractAddress: {
          agentAddress,
          chainId: chainScope.chainId,
          contractAddress: chainScope.contractAddress
        }
      },
      create: {
        agentAddress,
        status: "ACTIVE",
        ...chainScope
      },
      update: {
        status: "ACTIVE"
      }
    });

    const created = await prisma.infoFiAgentDecisionLog.create({
      data: {
        agentAddress,
        requestId,
        domain,
        decision: decisionRaw,
        confidence,
        reasonCode,
        reasonDetail,
        offerAmountWei,
        etaSeconds: etaSecondsRaw,
        offerId,
        txHash,
        ...chainScope
      }
    });

    return reply.code(201).send({ decision: created });
  });

  app.get("/agents/:address", async (req, reply) => {
    const params = req.params as { address?: string };
    const agentAddress = normalizeAddress(params.address || "");
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agent address" });

    const [profile, capabilities, latestHeartbeat] = await Promise.all([
      prisma.infoFiAgentProfile.findFirst({
        where: { ...scopedWhere(), agentAddress }
      }),
      prisma.infoFiAgentCapability.findMany({
        where: { ...scopedWhere(), agentAddress },
        orderBy: [{ domain: "asc" }, { paymentToken: "asc" }]
      }),
      prisma.infoFiAgentHeartbeat.findFirst({
        where: { ...scopedWhere(), agentAddress },
        orderBy: { lastSeenAt: "desc" }
      })
    ]);

    if (!profile && !latestHeartbeat) return reply.send({ agent: null });

    const nowMs = Date.now();
    const heartbeat = latestHeartbeat
      ? {
          agentAddress: latestHeartbeat.agentAddress,
          domainsLoggedIn: parseStringArrayJson(latestHeartbeat.domainsLoggedInJson),
          expectedEtaByDomain: parseEtaByDomainJson(latestHeartbeat.expectedEtaJson),
          lastSeenAt: latestHeartbeat.lastSeenAt.toISOString(),
          expiresAt: latestHeartbeat.expiresAt.toISOString(),
          isActive: latestHeartbeat.expiresAt.getTime() > nowMs,
          clientVersion: latestHeartbeat.clientVersion
        }
      : null;

    return reply.send({
      agent: {
        profile,
        capabilities,
        heartbeat
      }
    });
  });

  app.get("/domains/presence", async (req) => {
    const q = req.query as { take?: string; minActiveAgents?: string };
    const take = Math.min(Math.max(parseNonNegativeInt(q.take, 100), 1), 500);
    const minActiveAgents = Math.min(Math.max(parseNonNegativeInt(q.minActiveAgents, 1), 0), 500);

    const rows = await computeDomainPresenceRows();
    const domains = rows
      .filter((row) => row.activeAgents >= minActiveAgents)
      .sort(
        (left, right) =>
          right.activeAgents - left.activeAgents ||
          right.demandScore24h - left.demandScore24h ||
          left.domain.localeCompare(right.domain)
      )
      .slice(0, take);
    return { domains };
  });

  app.get("/domains/:domain/summary", async (req, reply) => {
    const params = req.params as { domain?: string };
    const domain = normalizeDomain(params.domain || "");
    if (!domain) return reply.code(400).send({ error: "Invalid domain" });

    const rows = await computeDomainPresenceRows(domain);
    const row = rows.find((entry) => entry.domain === domain) || {
      domain,
      activeAgents: 0,
      activeAgentAddresses: [],
      medianExpectedEtaSeconds: null,
      offerToHireRate7d: null,
      hireToDeliverRate7d: null,
      medianFirstOfferLatencySeconds7d: null,
      demandScore24h: 0,
      requestCount7d: 0
    };

    return { summary: row };
  });

  app.post("/signals/extension/domains", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const clientIdHash = typeof data.clientIdHash === "string" ? data.clientIdHash.trim().toLowerCase() : "";
    if (!/^[a-z0-9:_-]{12,128}$/i.test(clientIdHash)) {
      return reply.code(400).send({ error: "clientIdHash must match [a-z0-9:_-]{12,128}" });
    }
    if (!Array.isArray(data.buckets) || data.buckets.length === 0) {
      return reply.code(400).send({ error: "buckets must be a non-empty array" });
    }
    if (data.buckets.length > DOMAIN_SIGNAL_MAX_BUCKETS_PER_REQUEST) {
      return reply.code(400).send({ error: `buckets exceeds ${DOMAIN_SIGNAL_MAX_BUCKETS_PER_REQUEST}` });
    }

    const mergedByKey = new Map<string, { domain: string; bucketStart: Date; signalCount: number }>();
    for (let index = 0; index < data.buckets.length; index += 1) {
      const entry = data.buckets[index];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return reply.code(400).send({ error: `buckets[${index}] must be an object` });
      }
      const item = entry as Record<string, unknown>;
      const domain = normalizeDomain(typeof item.domain === "string" ? item.domain : "");
      if (!domain) return reply.code(400).send({ error: `buckets[${index}].domain is invalid` });

      const bucketStartInput = item.bucketStart;
      const bucketStartDate = new Date(
        typeof bucketStartInput === "number" || typeof bucketStartInput === "string" ? bucketStartInput : Number.NaN
      );
      if (!Number.isFinite(bucketStartDate.getTime())) {
        return reply.code(400).send({ error: `buckets[${index}].bucketStart is invalid` });
      }
      const bucketStart = new Date(Math.floor(bucketStartDate.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000));

      const signalCount = parsePositiveInt(item.signalCount, -1);
      if (signalCount <= 0 || signalCount > 10000) {
        return reply.code(400).send({ error: `buckets[${index}].signalCount must be in 1..10000` });
      }

      const key = `${domain}|${bucketStart.toISOString()}`;
      const existing = mergedByKey.get(key);
      if (existing) {
        existing.signalCount += signalCount;
      } else {
        mergedByKey.set(key, { domain, bucketStart, signalCount });
      }
    }

    const chainScope = chainScopeData();
    const source = DOMAIN_SIGNAL_SOURCE_EXTENSION;
    let accepted = 0;
    await prisma.$transaction(async (tx) => {
      for (const bucket of mergedByKey.values()) {
        const dedupeKey = {
          domain: bucket.domain,
          bucketStart: bucket.bucketStart,
          source,
          clientIdHash,
          chainId: chainScope.chainId,
          contractAddress: chainScope.contractAddress
        };
        const seen = await tx.infoFiDomainDemandSignalClient.findUnique({
          where: {
            domain_bucketStart_source_clientIdHash_chainId_contractAddress: dedupeKey
          }
        });
        let uniqueClientIncrement = 0;
        if (!seen) {
          await tx.infoFiDomainDemandSignalClient.create({
            data: dedupeKey
          });
          uniqueClientIncrement = 1;
        }

        await tx.infoFiDomainDemandSignal.upsert({
          where: {
            domain_bucketStart_source_chainId_contractAddress: {
              domain: bucket.domain,
              bucketStart: bucket.bucketStart,
              source,
              chainId: chainScope.chainId,
              contractAddress: chainScope.contractAddress
            }
          },
          create: {
            domain: bucket.domain,
            bucketStart: bucket.bucketStart,
            source,
            signalCount: bucket.signalCount,
            uniqueClientCount: uniqueClientIncrement,
            ...chainScope
          },
          update: {
            signalCount: { increment: bucket.signalCount },
            uniqueClientCount: { increment: uniqueClientIncrement }
          }
        });
        accepted += 1;
      }
    });

    return reply.code(202).send({
      accepted,
      source,
      bucketUnit: "hour"
    });
  });

  app.get("/requests", async (req) => {
    const q = req.query as { requestId?: string; requester?: string; status?: string; take?: string };
    const where: any = { ...scopedWhere() };
    if (q.requester) where.requester = q.requester.toLowerCase();
    if (q.status) where.status = q.status.toUpperCase();

    if (q.requestId) {
      const request = await prisma.infoFiRequest.findFirst({
        where: { ...where, requestId: q.requestId.toLowerCase() }
      });
      if (!request) return { request: null };
      const offers = await prisma.infoFiOffer.findMany({
        where: { ...scopedWhere(), requestId: request.requestId },
        orderBy: { createdAt: "asc" }
      });
      const job = await prisma.infoFiJob.findFirst({
        where: { ...scopedWhere(), requestId: request.requestId }
      });
      return { request: { ...request, offers, job } };
    }

    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const requests = await prisma.infoFiRequest.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take
    });
    return { requests };
  });

  app.get("/offers", async (req) => {
    const q = req.query as { offerId?: string; requestId?: string; consultant?: string; status?: string; take?: string };
    const where: any = { ...scopedWhere() };
    if (q.requestId) where.requestId = q.requestId.toLowerCase();
    if (q.consultant) where.consultant = q.consultant.toLowerCase();
    if (q.status) where.status = q.status.toUpperCase();

    if (q.offerId) {
      const offer = await prisma.infoFiOffer.findFirst({
        where: { ...where, offerId: q.offerId.toLowerCase() }
      });
      return { offer };
    }

    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const offers = await prisma.infoFiOffer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take
    });
    return { offers };
  });

  app.get("/jobs", async (req) => {
    const q = req.query as {
      jobId?: string;
      requestId?: string;
      requester?: string;
      consultant?: string;
      status?: string;
      take?: string;
    };
    const where: any = { ...scopedWhere() };
    if (q.requestId) where.requestId = q.requestId.toLowerCase();
    if (q.requester) where.requester = q.requester.toLowerCase();
    if (q.consultant) where.consultant = q.consultant.toLowerCase();

    if (q.jobId) {
      const job = await prisma.infoFiJob.findFirst({
        where: { ...where, jobId: q.jobId.toLowerCase() }
      });
      if (!job) return { job: null };
      const payouts = await prisma.infoFiPayout.findMany({ where: { jobId: job.jobId }, orderBy: { createdAt: "asc" } });
      const refunds = await prisma.infoFiRefund.findMany({ where: { jobId: job.jobId }, orderBy: { createdAt: "asc" } });
      const ratings = await prisma.infoFiRating.findMany({ where: { jobId: job.jobId }, orderBy: { createdAt: "asc" } });
      const digest = await prisma.infoFiDigest.findFirst({ where: { jobId: job.jobId }, orderBy: { createdAt: "desc" } });
      return { job: { ...job, status: infoFiJobStatus(job), payouts, refunds, ratings, digest } };
    }

    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const jobs = await prisma.infoFiJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take
    });
    const statusQuery = q.status ? q.status.toUpperCase() : "";
    const result = jobs
      .map((job) => ({ ...job, status: infoFiJobStatus(job) }))
      .filter((job) => (statusQuery ? job.status === statusQuery : true));
    return { jobs: result };
  });

  app.get("/jobs/:jobId/reimbursement-preview", async (req, reply) => {
    const params = req.params as { jobId?: string };
    const jobId = typeof params.jobId === "string" ? params.jobId.trim().toLowerCase() : "";
    if (!jobId) return reply.code(400).send({ error: "Missing jobId" });

    const job = await prisma.infoFiJob.findFirst({
      where: { ...scopedWhere(), jobId }
    });
    if (!job) return reply.code(404).send({ error: "Job not found" });

    const digest = await prisma.infoFiDigest.findFirst({
      where: { jobId: job.jobId },
      orderBy: { createdAt: "desc" }
    });

    const preview = await buildReimbursementPreview({
      jobId: job.jobId,
      chainId: job.chainId,
      paymentToken: job.paymentToken,
      consultant: job.consultant,
      remainingWei: job.remainingWei,
      citationsJson: digest?.citationsJson ?? null
    });

    return reply.send({ preview });
  });

  app.get("/digests", async (req) => {
    const q = req.query as { digestId?: string; jobId?: string; take?: string };
    if (q.digestId) {
      const digest = await prisma.infoFiDigest.findUnique({ where: { id: q.digestId } });
      return { digest };
    }
    const where: any = {};
    if (q.jobId) where.jobId = q.jobId.toLowerCase();
    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const digests = await prisma.infoFiDigest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take
    });
    return { digests };
  });

  app.get("/digests/:id", async (req, reply) => {
    const params = req.params as { id?: string };
    const digest = await prisma.infoFiDigest.findUnique({ where: { id: params.id || "" } });
    if (!digest) return reply.code(404).send({ error: "Digest not found" });
    return reply.send({ digest });
  });

  app.post("/digests", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }

    const jobId = typeof body.jobId === "string" ? body.jobId.trim().toLowerCase() : "";
    const sourceURI = typeof body.sourceURI === "string" ? body.sourceURI.trim() : null;
    const question = typeof body.question === "string" ? body.question.trim() : null;
    const digest = typeof body.digest === "string" ? body.digest.trim() : "";
    const consultantAddress = typeof body.consultantAddress === "string" ? body.consultantAddress.trim().toLowerCase() : "";
    const proof = typeof body.proof === "string" ? body.proof.trim() : null;
    let citationsJson: string | null = null;
    if (body.citations !== undefined) {
      try {
        citationsJson = JSON.stringify(body.citations ?? null);
      } catch {
        return reply.code(400).send({ error: "citations must be JSON-serializable" });
      }
    }

    if (!jobId || !digest || !consultantAddress) {
      return reply.code(400).send({ error: "Missing required fields: jobId, digest, consultantAddress" });
    }

    const heuristicFairUse = reviewDigestFairUse({
      digest,
      sourceURI,
      question,
      citations: body.citations,
      proof
    });
    const requestGeminiApiKey = readHeaderString(req.headers["x-gemini-api-key"]);
    const serverGeminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
    const geminiApiKey = requestGeminiApiKey || serverGeminiApiKey;
    let fairUse = combineFairUseWithLlm(heuristicFairUse, null);
    if (geminiApiKey) {
      try {
        const llmReview = await reviewDigestFairUseWithGemini({
          apiKey: geminiApiKey,
          model: geminiModel,
          timeoutMs: geminiTimeoutMs,
          keySource: requestGeminiApiKey ? "request-header" : "server-env",
          input: {
            digest,
            sourceURI,
            question,
            citations: body.citations,
            proof
          }
        });
        fairUse = combineFairUseWithLlm(heuristicFairUse, llmReview);
      } catch (err) {
        req.log.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            model: geminiModel
          },
          "Gemini fair-use second pass failed; using heuristic-only result"
        );
      }
    }

    const fairUseMode = parseFairUseEnforcementMode(process.env.FAIR_USE_ENFORCEMENT_MODE);
    if (fairUseMode === "block" && fairUse.verdict === "block") {
      return reply.code(422).send({
        error: `Fair-use review blocked this digest: ${fairUse.summary}`,
        fairUse
      });
    }

    const digestHash = keccak256(stringToHex(digest)).toLowerCase();
    const id = crypto.randomUUID().replace(/-/g, "");
    const apiOrigin = (process.env.API_ORIGIN || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, "");
    const metadataURI = `${apiOrigin}/digests/${id}`;

    const created = await prisma.infoFiDigest.create({
      data: {
        id,
        jobId,
        sourceURI,
        question,
        digest,
        digestHash,
        metadataURI,
        consultantAddress,
        proof,
        citationsJson,
        fairUseVerdict: fairUse.verdict,
        fairUseRiskLevel: fairUse.riskLevel,
        fairUseScore: fairUse.score,
        fairUsePolicyVersion: fairUse.policyVersion,
        fairUseReportJson: JSON.stringify(fairUse)
      }
    });

    return reply.code(201).send({ digest: created, fairUse });
  });

  return app;
}
