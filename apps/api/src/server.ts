import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import crypto from "node:crypto";
import { isAddress, keccak256, stringToHex, verifyMessage } from "viem";
import { getPrisma } from "./db.js";
import { combineFairUseWithLlm, parseFairUseEnforcementMode, reviewDigestFairUse } from "./fairUse.js";
import { reviewDigestFairUseWithGemini } from "./fairUseGemini.js";
import {
  FAST_SETTLEMENT_TOKEN_DECIMALS,
  FAST_SETTLEMENT_TOKEN_ID_HEX,
  FAST_SETTLEMENT_TOKEN_SYMBOL,
  fastTreasuryAddress,
  normalizeFastAddress,
  publicKeyToFastAddress,
  submitFastTreasuryTransfer,
  type FastTransactionCertificate,
  utf8ToHex,
  verifyFastFundingCertificate,
  verifyFastMessageSignature,
} from "./fast.js";
import { buildReimbursementPreview } from "./x402.js";

const AGENT_CHALLENGE_PURPOSES = new Set(["signup", "heartbeat"] as const);
const AGENT_CHALLENGE_TTL_SECONDS_DEFAULT = 300;
const AGENT_HEARTBEAT_DEFAULT_TTL_SECONDS = 120;
const AGENT_HEARTBEAT_MIN_TTL_SECONDS = 30;
const AGENT_HEARTBEAT_MAX_TTL_SECONDS = 900;
const DOMAIN_SIGNAL_SOURCE_EXTENSION = "EXTENSION";
const DOMAIN_SIGNAL_MAX_BUCKETS_PER_REQUEST = 200;
const AGENT_SIGNATURE_REGEX = /^0x[a-fA-F0-9]{130}$/;
const FAST_SIGNATURE_HEX_REGEX = /^[a-fA-F0-9]{128}$/;
const FAST_PUBLIC_KEY_REGEX = /^[a-fA-F0-9]{64}$/;
const RATE_LIMIT_STORE_SWEEP_MAX = 10_000;
const USER_AUTH_CHALLENGE_TTL_SECONDS_DEFAULT = 300;
const USER_SESSION_TTL_SECONDS_DEFAULT = 60 * 60 * 24 * 7;
const USER_SESSION_COOKIE = "infofi_user_session";

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
type AgentSetupMode = "listener-only" | "live-agent-notify" | "auto-offer";

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

  function domainsOverlap(left: string, right: string) {
    return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
  }

  function normalizeAddress(value: unknown) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!isAddress(trimmed)) return "";
    return trimmed.toLowerCase();
  }

  function normalizeFastAddressOrEmpty(value: unknown) {
    if (typeof value !== "string") return "";
    try {
      return normalizeFastAddress(value);
    } catch {
      return "";
    }
  }

  function sha256Hex(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  function randomTokenHex(bytes = 32) {
    return crypto.randomBytes(bytes).toString("hex");
  }

  function parseCookieHeader(headerValue: string | string[] | undefined) {
    const raw = Array.isArray(headerValue) ? headerValue[0] || "" : headerValue || "";
    const out: Record<string, string> = {};
    for (const part of raw.split(";")) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      const key = part.slice(0, idx).trim();
      if (!key) continue;
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
  }

  function appendSetCookie(reply: FastifyReply, cookie: string) {
    const current = reply.getHeader("set-cookie");
    if (!current) {
      reply.header("set-cookie", cookie);
      return;
    }
    if (Array.isArray(current)) {
      reply.header("set-cookie", [...current, cookie]);
      return;
    }
    reply.header("set-cookie", [String(current), cookie]);
  }

  function buildSessionCookie(value: string, maxAgeSeconds: number) {
    const secure = webOrigin.startsWith("https://") ? "; Secure" : "";
    return `${USER_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
  }

  function clearSessionCookie() {
    const secure = webOrigin.startsWith("https://") ? "; Secure" : "";
    return `${USER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
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

  const demandKAnonymityMinClients = parsePositiveInt(process.env.DEMAND_K_ANONYMITY_MIN_CLIENTS, 10);
  const heartbeatMaxDomains = parsePositiveInt(process.env.AGENT_HEARTBEAT_MAX_DOMAINS, 100);
  const signupMaxCapabilities = parsePositiveInt(process.env.AGENT_SIGNUP_MAX_CAPABILITIES, 250);
  const challengeRateLimitPerMinute = parsePositiveInt(process.env.AGENT_CHALLENGE_RATE_LIMIT_PER_MINUTE, 30);
  const signupRateLimitPerHour = parsePositiveInt(process.env.AGENT_SIGNUP_RATE_LIMIT_PER_HOUR, 20);
  const heartbeatRateLimitPerMinute = parsePositiveInt(process.env.AGENT_HEARTBEAT_RATE_LIMIT_PER_MINUTE, 120);
  const decisionRateLimitPerMinute = parsePositiveInt(process.env.AGENT_DECISION_RATE_LIMIT_PER_MINUTE, 480);
  const extensionSignalRateLimitPerMinute = parsePositiveInt(process.env.EXT_SIGNAL_RATE_LIMIT_PER_MINUTE, 120);
  const extensionSignalMaxBucketAgeHours = parsePositiveInt(process.env.EXT_SIGNAL_MAX_BUCKET_AGE_HOURS, 24 * 7);
  const extensionSignalMaxFutureSkewMinutes = parsePositiveInt(process.env.EXT_SIGNAL_MAX_FUTURE_SKEW_MINUTES, 60);
  const rateLimitStore = new Map<string, { count: number; resetAtMs: number }>();

  function consumeRateLimit(key: string, maxRequests: number, windowMs: number) {
    const nowMs = Date.now();
    const existing = rateLimitStore.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      rateLimitStore.set(key, { count: 1, resetAtMs: nowMs + windowMs });
      return { allowed: true as const, remaining: Math.max(0, maxRequests - 1), retryAfterSeconds: 0 };
    }
    if (existing.count >= maxRequests) {
      return {
        allowed: false as const,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000))
      };
    }
    existing.count += 1;
    rateLimitStore.set(key, existing);
    if (rateLimitStore.size > RATE_LIMIT_STORE_SWEEP_MAX) {
      for (const [entryKey, entryValue] of rateLimitStore.entries()) {
        if (entryValue.resetAtMs <= nowMs) rateLimitStore.delete(entryKey);
      }
    }
    return { allowed: true as const, remaining: Math.max(0, maxRequests - existing.count), retryAfterSeconds: 0 };
  }

  function requestIp(req: FastifyRequest) {
    const forwarded = readHeaderString(req.headers["x-forwarded-for"]);
    if (forwarded) {
      const first = forwarded.split(",")[0];
      if (first && first.trim()) return first.trim().slice(0, 96);
    }
    if (typeof req.ip === "string" && req.ip.trim()) return req.ip.trim().slice(0, 96);
    return "unknown";
  }

  function rateLimitError(reply: FastifyReply, retryAfterSeconds: number) {
    return reply.code(429).send({
      error: "Rate limit exceeded",
      retryAfterSeconds
    });
  }

  function normalizeAllowedOrigin(raw: string) {
    const value = raw.trim();
    if (!value) return "";
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.origin;
    } catch {
      return "";
    }
  }

  function isIpLikeHost(hostname: string) {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
    return hostname.includes(":");
  }

  function expandWwwOriginAliases(origin: string) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:") return [] as string[];
      const host = parsed.hostname.toLowerCase();
      if (!host || host === "localhost" || isIpLikeHost(host)) return [] as string[];
      if (host.startsWith("www.")) {
        const withoutWww = host.slice(4);
        if (!withoutWww || !withoutWww.includes(".")) return [] as string[];
        const alias = new URL(origin);
        alias.hostname = withoutWww;
        return [alias.origin];
      }
      // Only auto-add `www.` for likely apex domains (e.g. jumpwalls.com).
      const labels = host.split(".").filter(Boolean);
      if (labels.length !== 2) return [] as string[];
      const alias = new URL(origin);
      alias.hostname = `www.${host}`;
      return [alias.origin];
    } catch {
      return [] as string[];
    }
  }

  function buildAllowedOrigins(raw: string) {
    const configured = raw
      .split(",")
      .map((entry) => normalizeAllowedOrigin(entry))
      .filter(Boolean);
    const seeds = configured.length > 0 ? configured : ["http://localhost:3000"];
    const out = new Set<string>();
    for (const seed of seeds) {
      out.add(seed);
      for (const alias of expandWwwOriginAliases(seed)) out.add(alias);
    }
    return out;
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

  function buildUserChallengeMessage(args: {
    purpose: "session" | "fast-bind";
    evmAddress: string;
    nonce: string;
    expiresAt: Date;
    fastAddress?: string;
    fastPublicKey?: string;
  }) {
    return [
      "InfoFi User Authentication",
      `Purpose: ${args.purpose}`,
      `Address: ${args.evmAddress}`,
      args.fastAddress ? `FastAddress: ${args.fastAddress}` : null,
      args.fastPublicKey ? `FastPublicKey: ${args.fastPublicKey}` : null,
      `Nonce: ${args.nonce}`,
      `ExpiresAt: ${args.expiresAt.toISOString()}`,
      `ChainId: ${Number.isFinite(chainId) ? chainId : 0}`,
      `Contract: ${contractAddress || "unconfigured"}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function verifyAndConsumeUserChallenge(args: {
    purpose: "session" | "fast-bind";
    evmAddress: string;
    nonce: string;
    verify: (challenge: {
      message: string;
      fastAddress: string | null;
      fastPublicKey: string | null;
    }) => Promise<boolean>;
  }) {
    const challenge = await prisma.infoFiUserAuthChallenge.findUnique({ where: { nonce: args.nonce } });
    if (!challenge) return { ok: false as const, error: "Invalid nonce" };
    if (challenge.evmAddress !== args.evmAddress) return { ok: false as const, error: "Challenge user mismatch" };
    if (challenge.purpose !== args.purpose) return { ok: false as const, error: "Challenge purpose mismatch" };
    if (challenge.usedAt) return { ok: false as const, error: "Challenge already used" };
    if (challenge.expiresAt.getTime() <= Date.now()) return { ok: false as const, error: "Challenge expired" };

    const valid = await args.verify({
      message: challenge.message,
      fastAddress: challenge.fastAddress,
      fastPublicKey: challenge.fastPublicKey,
    });
    if (!valid) return { ok: false as const, error: "Signature verification failed" };

    const used = await prisma.infoFiUserAuthChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: new Date() }
    });
    if (used.count !== 1) return { ok: false as const, error: "Challenge already used" };

    return {
      ok: true as const,
      challenge,
    };
  }

  async function readUserSession(req: FastifyRequest) {
    const cookies = parseCookieHeader(req.headers.cookie);
    const rawToken = cookies[USER_SESSION_COOKIE];
    if (!rawToken) return null;
    const tokenHash = sha256Hex(rawToken);
    const session = await prisma.infoFiUserSession.findUnique({ where: { tokenHash } });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await prisma.infoFiUserSession.deleteMany({ where: { id: session.id } });
      return null;
    }
    return session;
  }

  async function touchUserSession(sessionId: string) {
    await prisma.infoFiUserSession.updateMany({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() }
    });
  }

  async function requireUserSession(req: FastifyRequest, reply: FastifyReply) {
    const session = await readUserSession(req);
    if (!session) {
      reply.code(401).send({ error: "User session required" });
      return null;
    }
    await touchUserSession(session.id);
    return session;
  }

  async function getUserProfileForAddress(evmAddress: string) {
    const normalized = normalizeAddress(evmAddress);
    if (!normalized) return null;
    return await prisma.infoFiUserProfile.findUnique({ where: { evmAddress: normalized } });
  }

  async function requireFastBoundProfile(evmAddress: string) {
    const profile = await getUserProfileForAddress(evmAddress);
    if (!profile?.fastAddress || !profile.fastPublicKey) {
      throw new Error("FAST wallet is not bound for this account.");
    }
    return profile;
  }

  function parseCapabilityEntries(raw: unknown) {
    if (!Array.isArray(raw)) return { capabilities: [] as ParsedAgentCapability[], error: "capabilities must be an array" };
    const parsed: ParsedAgentCapability[] = [];
    const capabilityKeys = new Set<string>();
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

      const dedupeKey = `${domain}|${paymentToken}`;
      if (capabilityKeys.has(dedupeKey)) {
        return { capabilities: [] as ParsedAgentCapability[], error: `capabilities[${index}] duplicates domain/paymentToken pair` };
      }
      capabilityKeys.add(dedupeKey);

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

  function parseDomainList(raw: unknown) {
    if (!Array.isArray(raw)) return [] as string[];
    return Array.from(
      new Set(
        raw
          .map((entry) => (typeof entry === "string" ? normalizeDomain(entry) : ""))
          .filter((entry) => entry.length > 0)
      )
    );
  }

  function parseRequestedDomainsFromInput(data: Record<string, unknown>) {
    const fromList = parseDomainList(data.domains);
    const fromSingle = typeof data.domain === "string" ? [normalizeDomain(data.domain)] : [];
    const fromCsv =
      typeof data.domainsCsv === "string"
        ? data.domainsCsv
            .split(",")
            .map((entry) => normalizeDomain(entry))
            .filter(Boolean)
        : [];
    return Array.from(new Set([...fromList, ...fromSingle, ...fromCsv].filter(Boolean)));
  }

  function parseRequestedDomainsFromQuery(data: Record<string, unknown>) {
    const domainsRaw = typeof data.domains === "string" ? data.domains : "";
    const domainRaw = typeof data.domain === "string" ? data.domain : "";
    return Array.from(
      new Set(
        [...domainsRaw.split(","), ...domainRaw.split(",")]
          .map((entry) => normalizeDomain(entry))
          .filter(Boolean)
      )
    );
  }

  function parseSetupMode(raw: unknown) {
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (value === "listener-only" || value === "live-agent-notify" || value === "auto-offer") {
      return value as AgentSetupMode;
    }
    return null;
  }

  function parseNotificationChannel(raw: unknown) {
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!value) return null;
    if (["terminal", "slack", "telegram", "email", "webhook"].includes(value)) return value;
    return null;
  }

  function extractProvidedEnvKeys(data: Record<string, unknown>) {
    const keys = new Set<string>();

    const envKeysRaw = data.envKeysPresent;
    if (Array.isArray(envKeysRaw)) {
      for (const keyRaw of envKeysRaw) {
        if (typeof keyRaw !== "string") continue;
        const key = keyRaw.trim().toUpperCase();
        if (key) keys.add(key);
      }
    }

    const envRaw = data.env;
    if (envRaw && typeof envRaw === "object" && !Array.isArray(envRaw)) {
      for (const [keyRaw, value] of Object.entries(envRaw as Record<string, unknown>)) {
        const key = keyRaw.trim().toUpperCase();
        if (!key) continue;
        if (typeof value === "string" && !value.trim()) continue;
        if (value == null) continue;
        keys.add(key);
      }
    }

    return keys;
  }

  function buildSetupPlan(input: Record<string, unknown>) {
    const networkRaw = typeof input.network === "string" ? input.network.trim().toLowerCase() : "";
    const network = ["mainnet", "sepolia", "local"].includes(networkRaw) ? networkRaw : null;
    const mode = parseSetupMode(input.mode);
    const domains = parseRequestedDomainsFromInput(input);
    const notificationChannel = parseNotificationChannel(input.notificationChannel);
    const pollIntervalSecondsRaw = parsePositiveInt(input.pollIntervalSeconds, -1);
    const pollIntervalSeconds = pollIntervalSecondsRaw > 0 ? pollIntervalSecondsRaw : null;
    const alertUnseenOnly = typeof input.alertUnseenOnly === "boolean" ? input.alertUnseenOnly : true;
    const allowOnchainWrites = typeof input.allowOnchainWrites === "boolean" ? input.allowOnchainWrites : false;
    const envKeysPresent = Array.from(extractProvidedEnvKeys(input)).sort();
    const envKeySet = new Set(envKeysPresent);
    const requestedDomains = Array.from(new Set(domains)).sort();

    const missing: string[] = [];
    const questions: string[] = [];
    const warnings: string[] = [];

    if (!network) {
      missing.push("network");
      questions.push("Which network should I target: mainnet, sepolia, or local?");
    }
    if (!mode) {
      missing.push("mode");
      questions.push("Which mode should I run: listener-only, live-agent-notify, or auto-offer?");
    }
    if (requestedDomains.length === 0) {
      missing.push("domains");
      questions.push("Which domains should this service cover?");
    }
    if (!notificationChannel) {
      missing.push("notificationChannel");
      questions.push("Which notification channel should I use: terminal, slack, telegram, email, or webhook?");
    }
    if (!pollIntervalSeconds) {
      missing.push("pollIntervalSeconds");
      questions.push("What polling interval (seconds) should I use?");
    }

    if (requestedDomains.includes("x.com") && !requestedDomains.includes("twitter.com")) {
      warnings.push("Consider also adding twitter.com for legacy X links.");
    }

    const requiredEnvKeysByMode: Record<AgentSetupMode, string[]> = {
      "listener-only": ["API_URL"],
      "live-agent-notify": ["API_URL", "PRIVATE_KEY"],
      "auto-offer": ["API_URL", "PRIVATE_KEY", "CHAIN_ID", "RPC_URL", "CONTRACT_ADDRESS"]
    };
    const requiredEnvKeys = mode ? requiredEnvKeysByMode[mode] : [];
    const missingEnvKeys = requiredEnvKeys.filter((key) => !envKeySet.has(key));
    for (const key of missingEnvKeys) {
      missing.push(`env.${key}`);
      questions.push(`Please provide or confirm ${key}.`);
    }

    if (mode === "auto-offer" && !allowOnchainWrites) {
      missing.push("allowOnchainWrites");
      questions.push("Auto-offer performs on-chain writes. Do you approve on-chain writes for this setup?");
    }

    return {
      normalized: {
        network,
        mode,
        domains: requestedDomains,
        notificationChannel,
        pollIntervalSeconds,
        alertUnseenOnly,
        allowOnchainWrites,
        envKeysPresent
      },
      missing,
      questions,
      warnings,
      readyForExecution: missing.length === 0
    };
  }

  async function computeAgentReadiness(agentAddress: string, requestedDomains: string[]) {
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

    const nowMs = Date.now();
    const enabledCapabilities = capabilities.filter((capability) => capability.isEnabled);
    const capabilityDomains = Array.from(
      new Set(enabledCapabilities.map((capability) => normalizeDomain(capability.domain)).filter(Boolean))
    );
    const heartbeatDomains = latestHeartbeat
      ? Array.from(new Set(parseStringArrayJson(latestHeartbeat.domainsLoggedInJson).map((entry) => normalizeDomain(entry)).filter(Boolean)))
      : [];
    const hasActiveHeartbeat = Boolean(latestHeartbeat && latestHeartbeat.expiresAt.getTime() > nowMs);
    const profileStatus = profile?.status ? String(profile.status).toUpperCase() : null;
    const isProfileActive = profileStatus === "ACTIVE";

    const listedDomains = hasActiveHeartbeat
      ? heartbeatDomains.filter((domain) => capabilityDomains.some((capabilityDomain) => domainsOverlap(capabilityDomain, domain)))
      : [];
    const sortedListedDomains = Array.from(new Set(listedDomains)).sort();

    const requested = Array.from(new Set(requestedDomains.map((domain) => normalizeDomain(domain)).filter(Boolean))).sort();
    const uncoveredCapabilities = requested.filter(
      (domain) => !capabilityDomains.some((capabilityDomain) => domainsOverlap(capabilityDomain, domain))
    );
    const notLive = requested.filter((domain) => !sortedListedDomains.some((listedDomain) => domainsOverlap(listedDomain, domain)));

    const missingRequirements: string[] = [];
    const nextActions: string[] = [];

    if (!profile) {
      missingRequirements.push("agent_profile");
      nextActions.push("Run /agents/signup to create the agent profile and capabilities.");
    }
    if (profile && !isProfileActive) {
      missingRequirements.push("profile_status_active");
      nextActions.push("Update agent profile status to ACTIVE via /agents/signup.");
    }
    if (enabledCapabilities.length === 0) {
      missingRequirements.push("enabled_capabilities");
      nextActions.push("Add at least one enabled capability via /agents/signup.");
    }
    if (!latestHeartbeat) {
      missingRequirements.push("heartbeat");
      nextActions.push("Send a signed heartbeat via /agents/heartbeat.");
    } else if (!hasActiveHeartbeat) {
      missingRequirements.push("active_heartbeat");
      nextActions.push("Send a fresh heartbeat (previous heartbeat is expired).");
    }
    if (requested.length > 0 && uncoveredCapabilities.length > 0) {
      missingRequirements.push("requested_domain_capability");
      nextActions.push("Add capabilities covering requested domains.");
    }
    if (requested.length > 0 && notLive.length > 0) {
      missingRequirements.push("requested_domain_live");
      nextActions.push("Heartbeat must include requested domains in domainsLoggedIn.");
    }

    const readyBase = Boolean(profile && isProfileActive && enabledCapabilities.length > 0 && hasActiveHeartbeat && sortedListedDomains.length > 0);
    const ready = requested.length === 0 ? readyBase : readyBase && uncoveredCapabilities.length === 0 && notLive.length === 0;

    return {
      ready,
      chainScope: chainScopeData(),
      agentAddress,
      profile: profile
        ? {
            status: profileStatus,
            displayName: profile.displayName,
            updatedAt: profile.updatedAt.toISOString()
          }
        : null,
      hasEnabledCapabilities: enabledCapabilities.length > 0,
      enabledCapabilityCount: enabledCapabilities.length,
      capabilityDomains,
      heartbeat: latestHeartbeat
        ? {
            lastSeenAt: latestHeartbeat.lastSeenAt.toISOString(),
            expiresAt: latestHeartbeat.expiresAt.toISOString(),
            isActive: hasActiveHeartbeat,
            domainsLoggedIn: heartbeatDomains
          }
        : null,
      listedDomains: sortedListedDomains,
      requestedDomains: requested,
      requestedDomainsCoverage: {
        uncoveredCapabilities,
        notLive
      },
      missingRequirements: Array.from(new Set(missingRequirements)),
      nextActions: Array.from(new Set(nextActions))
    };
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
    const capabilityDomainsByAgent = new Map<string, string[]>();
    for (const capability of capabilities) {
      const key = `${capability.agentAddress}|${capability.domain}`;
      const existing = capabilityEtaByAgentDomain.get(key);
      if (existing == null || capability.etaSeconds < existing) {
        capabilityEtaByAgentDomain.set(key, capability.etaSeconds);
      }
      const domains = capabilityDomainsByAgent.get(capability.agentAddress) ?? [];
      if (!domains.includes(capability.domain)) domains.push(capability.domain);
      capabilityDomainsByAgent.set(capability.agentAddress, domains);
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
      const capabilityDomains = capabilityDomainsByAgent.get(agentAddress) ?? [];
      if (capabilityDomains.length === 0) continue;
      const domains = Array.from(new Set(parseStringArrayJson(heartbeat.domainsLoggedInJson).map((d) => normalizeDomain(d)).filter(Boolean)));
      if (domains.length === 0) continue;
      const etaByDomain = parseEtaByDomainJson(heartbeat.expectedEtaJson);
      for (const domain of domains) {
        if (domainFilter && domain !== domainFilter) continue;
        if (!capabilityDomains.some((capabilityDomain) => domainsOverlap(capabilityDomain, domain))) continue;
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
        signalCount: true,
        uniqueClientCount: true
      }
    });
    const demandScoreByDomain = new Map<string, number>();
    const demandUniqueClientsByDomain = new Map<string, number>();
    for (const signal of demandSignals) {
      if (domainFilter && signal.domain !== domainFilter) continue;
      demandScoreByDomain.set(signal.domain, (demandScoreByDomain.get(signal.domain) || 0) + signal.signalCount);
      demandUniqueClientsByDomain.set(
        signal.domain,
        (demandUniqueClientsByDomain.get(signal.domain) || 0) + Math.max(0, signal.uniqueClientCount)
      );
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
        const rawDemandScore24h = demandScoreByDomain.get(domain) || 0;
        const demandUniqueClients24h = demandUniqueClientsByDomain.get(domain) || 0;
        const demandScore24hRedacted = demandUniqueClients24h < demandKAnonymityMinClients;
        const demandScore24h = demandScore24hRedacted ? 0 : rawDemandScore24h;
        return {
          domain,
          activeAgents,
          activeAgentAddresses: live ? [...live.activeAgentAddresses].sort() : [],
          medianExpectedEtaSeconds,
          offerToHireRate7d,
          hireToDeliverRate7d,
          medianFirstOfferLatencySeconds7d,
          demandScore24h,
          demandUniqueClients24h,
          demandScore24hRedacted,
          requestCount7d: domainRequestCount.get(domain) || 0
        };
      });

    return rows;
  }

  const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";
  const allowedOrigins = buildAllowedOrigins(webOrigin);
  const corsOrigin: FastifyCorsOptions["origin"] = async (origin?: string) => {
    if (!origin) return false;
    const normalized = normalizeAllowedOrigin(origin);
    if (!normalized) return false;
    return allowedOrigins.has(normalized) ? normalized : false;
  };
  await app.register(cors, { origin: corsOrigin, credentials: true });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/challenge", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const evmAddress = normalizeAddress(data.address);
    if (!evmAddress) return reply.code(400).send({ error: "Valid EVM address is required" });

    const nonce = randomTokenHex(16);
    const expiresAt = new Date(Date.now() + USER_AUTH_CHALLENGE_TTL_SECONDS_DEFAULT * 1000);
    const message = buildUserChallengeMessage({
      purpose: "session",
      evmAddress,
      nonce,
      expiresAt,
    });
    await prisma.infoFiUserAuthChallenge.create({
      data: {
        evmAddress,
        nonce,
        purpose: "session",
        message,
        expiresAt,
      }
    });
    return reply.send({
      challenge: {
        nonce,
        messageToSign: message,
        expiresAt: expiresAt.toISOString(),
      }
    });
  });

  app.post("/auth/verify", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const evmAddress = normalizeAddress(data.address);
    const nonce = typeof data.nonce === "string" ? data.nonce.trim() : "";
    const signature = typeof data.signature === "string" ? data.signature.trim() : "";
    if (!evmAddress || !nonce || !signature) {
      return reply.code(400).send({ error: "Missing address, nonce, or signature" });
    }

    const verified = await verifyAndConsumeUserChallenge({
      purpose: "session",
      evmAddress,
      nonce,
      verify: async ({ message }) =>
        await verifyMessage({
          address: evmAddress as `0x${string}`,
          message,
          signature: signature as `0x${string}`
        }),
    });
    if (!verified.ok) return reply.code(401).send({ error: verified.error });

    const rawSessionToken = randomTokenHex(32);
    const expiresAt = new Date(Date.now() + USER_SESSION_TTL_SECONDS_DEFAULT * 1000);
    const tokenHash = sha256Hex(rawSessionToken);
    await prisma.infoFiUserSession.create({
      data: {
        tokenHash,
        evmAddress,
        expiresAt,
      }
    });
    await prisma.infoFiUserProfile.upsert({
      where: { evmAddress },
      create: { evmAddress },
      update: {}
    });
    appendSetCookie(reply, buildSessionCookie(rawSessionToken, USER_SESSION_TTL_SECONDS_DEFAULT));
    return reply.send({
      session: {
        authenticated: true,
        evmAddress,
        expiresAt: expiresAt.toISOString(),
      }
    });
  });

  app.get("/auth/session", async (req, reply) => {
    const session = await readUserSession(req);
    if (!session) {
      appendSetCookie(reply, clearSessionCookie());
      return reply.send({
        session: {
          authenticated: false,
          evmAddress: null,
          expiresAt: null,
        }
      });
    }
    return reply.send({
      session: {
        authenticated: true,
        evmAddress: session.evmAddress,
        expiresAt: session.expiresAt.toISOString(),
      }
    });
  });

  app.get("/user/profile", async (req, reply) => {
    const session = await readUserSession(req);
    if (!session) {
      appendSetCookie(reply, clearSessionCookie());
      return reply.send({
        authenticated: false,
        user: null,
      });
    }
    const profile = await getUserProfileForAddress(session.evmAddress);
    return reply.send({
      authenticated: true,
      user: profile
        ? {
            evmAddress: profile.evmAddress,
            fastAddress: profile.fastAddress,
            fastPublicKey: profile.fastPublicKey,
            fastBoundAt: profile.fastBoundAt?.toISOString() ?? null,
            updatedAt: profile.updatedAt.toISOString(),
          }
        : {
            evmAddress: session.evmAddress,
            fastAddress: null,
            fastPublicKey: null,
            fastBoundAt: null,
            updatedAt: session.updatedAt.toISOString(),
          },
    });
  });

  app.post("/user/fast/challenge", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const fastAddress = normalizeFastAddressOrEmpty(data.address);
    const fastPublicKey = typeof data.publicKey === "string" ? data.publicKey.trim().toLowerCase() : "";
    if (!fastAddress) return reply.code(400).send({ error: "Valid FAST address is required" });
    if (!FAST_PUBLIC_KEY_REGEX.test(fastPublicKey)) {
      return reply.code(400).send({ error: "FAST public key must be 32-byte hex" });
    }
    if (publicKeyToFastAddress(fastPublicKey) !== fastAddress) {
      return reply.code(400).send({ error: "FAST address does not match the public key" });
    }

    const nonce = randomTokenHex(16);
    const expiresAt = new Date(Date.now() + USER_AUTH_CHALLENGE_TTL_SECONDS_DEFAULT * 1000);
    const message = buildUserChallengeMessage({
      purpose: "fast-bind",
      evmAddress: session.evmAddress,
      fastAddress,
      fastPublicKey,
      nonce,
      expiresAt,
    });
    await prisma.infoFiUserAuthChallenge.create({
      data: {
        evmAddress: session.evmAddress,
        nonce,
        purpose: "fast-bind",
        message,
        fastAddress,
        fastPublicKey,
        expiresAt,
      }
    });
    return reply.send({
      challenge: {
        nonce,
        address: fastAddress,
        publicKey: fastPublicKey,
        messageToSign: message,
        expiresAt: expiresAt.toISOString(),
      }
    });
  });

  app.post("/user/fast/bind", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const fastAddress = normalizeFastAddressOrEmpty(data.address);
    const fastPublicKey = typeof data.publicKey === "string" ? data.publicKey.trim().toLowerCase() : "";
    const nonce = typeof data.nonce === "string" ? data.nonce.trim() : "";
    const signature = typeof data.signature === "string" ? data.signature.trim() : "";
    const messageBytes = typeof data.messageBytes === "string" ? data.messageBytes.trim() : "";
    if (!fastAddress || !FAST_PUBLIC_KEY_REGEX.test(fastPublicKey) || !nonce || !messageBytes || !FAST_SIGNATURE_HEX_REGEX.test(signature)) {
      return reply.code(400).send({ error: "Missing or invalid FAST bind payload" });
    }
    if (publicKeyToFastAddress(fastPublicKey) !== fastAddress) {
      return reply.code(400).send({ error: "FAST address does not match the public key" });
    }

    const verified = await verifyAndConsumeUserChallenge({
      purpose: "fast-bind",
      evmAddress: session.evmAddress,
      nonce,
      verify: async (challenge) => {
        if (challenge.fastAddress !== fastAddress) return false;
        if (challenge.fastPublicKey !== fastPublicKey) return false;
        if (utf8ToHex(challenge.message) !== messageBytes.trim().toLowerCase()) return false;
        return await verifyFastMessageSignature({
          publicKeyHex: fastPublicKey,
          signatureHex: signature,
          messageBytesHex: messageBytes,
        });
      },
    });
    if (!verified.ok) return reply.code(401).send({ error: verified.error });

    const profile = await prisma.infoFiUserProfile.upsert({
      where: { evmAddress: session.evmAddress },
      create: {
        evmAddress: session.evmAddress,
        fastAddress,
        fastPublicKey,
        fastBoundAt: new Date(),
      },
      update: {
        fastAddress,
        fastPublicKey,
        fastBoundAt: new Date(),
      }
    });
    return reply.send({
      user: {
        evmAddress: profile.evmAddress,
        fastAddress: profile.fastAddress,
        fastPublicKey: profile.fastPublicKey,
        fastBoundAt: profile.fastBoundAt?.toISOString() ?? null,
        updatedAt: profile.updatedAt.toISOString(),
      }
    });
  });

  app.get("/fast/config", async () => {
    return {
      config: {
        treasuryAddress: await fastTreasuryAddress(),
        tokenSymbol: FAST_SETTLEMENT_TOKEN_SYMBOL,
        tokenDecimals: FAST_SETTLEMENT_TOKEN_DECIMALS,
        tokenId: FAST_SETTLEMENT_TOKEN_ID_HEX,
      }
    };
  });

  function mapBaseRequest(request: any) {
    return {
      ...request,
      rail: "BASE",
      requesterFastAddress: null,
    };
  }

  function mapFastRequest(request: any) {
    return {
      ...request,
      rail: "FAST",
      chainId: 0,
      contractAddress: "",
    };
  }

  function mapBaseOffer(offer: any) {
    return {
      ...offer,
      rail: "BASE",
      consultantFastAddress: null,
      token: null,
    };
  }

  function mapFastOffer(offer: any) {
    return {
      ...offer,
      rail: "FAST",
      consultantFastAddress: offer.consultantFastAddress,
      chainId: 0,
      contractAddress: "",
      token: FAST_SETTLEMENT_TOKEN_SYMBOL,
    };
  }

  function mapBaseJob(job: any) {
    return {
      ...job,
      rail: "BASE",
      status: infoFiJobStatus(job),
      requesterFastAddress: null,
      consultantFastAddress: null,
    };
  }

  function mapFastJob(job: any) {
    return {
      ...job,
      rail: "FAST",
      chainId: 0,
      contractAddress: "",
    };
  }

  function mapFastTransfersToPayouts(jobId: string, transfers: any[]) {
    return transfers
      .filter((entry) => entry.direction === "PAYOUT" && entry.status === "COMPLETED")
      .map((entry) => ({
        id: entry.id,
        jobId,
        token: entry.paymentToken,
        recipient: entry.toAddress,
        amountWei: entry.amountWei,
        txHash: entry.txHash || "",
        logIndex: 0,
        blockNumber: 0,
        createdAt: entry.createdAt,
      }));
  }

  function mapFastTransfersToRefunds(jobId: string, transfers: any[]) {
    return transfers
      .filter((entry) => entry.direction === "REFUND" && entry.status === "COMPLETED")
      .map((entry) => ({
        id: entry.id,
        jobId,
        token: entry.paymentToken,
        funder: entry.toAddress,
        amountWei: entry.amountWei,
        txHash: entry.txHash || "",
        logIndex: 0,
        blockNumber: 0,
        createdAt: entry.createdAt,
      }));
  }

  function sortByUpdatedAtDesc<T extends { updatedAt: Date }>(rows: T[]) {
    return [...rows].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  app.post("/agents/setup/plan", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const plan = buildSetupPlan(data);
    return reply.send({ plan });
  });

  app.post("/agents/setup/submit", async (req, reply) => {
    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const plan = buildSetupPlan(data);
    return reply.send({
      setup: {
        status: plan.readyForExecution ? "ready" : "needs_input",
        plan
      }
    });
  });

  app.post("/agents/challenge", async (req, reply) => {
    const challengeIpLimit = consumeRateLimit(
      `agents:challenge:ip:${requestIp(req)}`,
      challengeRateLimitPerMinute,
      60_000
    );
    if (!challengeIpLimit.allowed) return rateLimitError(reply, challengeIpLimit.retryAfterSeconds);

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }

    const agentAddress = normalizeAddress((body as Record<string, unknown>).agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const challengeAgentLimit = consumeRateLimit(
      `agents:challenge:agent:${agentAddress}`,
      challengeRateLimitPerMinute,
      60_000
    );
    if (!challengeAgentLimit.allowed) return rateLimitError(reply, challengeAgentLimit.retryAfterSeconds);

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
    const signupIpLimit = consumeRateLimit(
      `agents:signup:ip:${requestIp(req)}`,
      signupRateLimitPerHour,
      60 * 60 * 1000
    );
    if (!signupIpLimit.allowed) return rateLimitError(reply, signupIpLimit.retryAfterSeconds);

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const agentAddress = normalizeAddress(data.agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const signupAgentLimit = consumeRateLimit(
      `agents:signup:agent:${agentAddress}`,
      signupRateLimitPerHour,
      60 * 60 * 1000
    );
    if (!signupAgentLimit.allowed) return rateLimitError(reply, signupAgentLimit.retryAfterSeconds);

    const nonce = typeof data.nonce === "string" ? data.nonce.trim() : "";
    if (!nonce) return reply.code(400).send({ error: "Missing nonce" });

    const signature = typeof data.signature === "string" ? data.signature.trim() : "";
    if (!signature) return reply.code(400).send({ error: "Missing signature" });

    const parsed = parseCapabilityEntries(data.capabilities);
    if (parsed.error) return reply.code(400).send({ error: parsed.error });
    if (parsed.capabilities.length > signupMaxCapabilities) {
      return reply.code(400).send({ error: `capabilities exceeds ${signupMaxCapabilities}` });
    }

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
    const heartbeatIpLimit = consumeRateLimit(
      `agents:heartbeat:ip:${requestIp(req)}`,
      heartbeatRateLimitPerMinute,
      60_000
    );
    if (!heartbeatIpLimit.allowed) return rateLimitError(reply, heartbeatIpLimit.retryAfterSeconds);

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const agentAddress = normalizeAddress(data.agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const heartbeatAgentLimit = consumeRateLimit(
      `agents:heartbeat:agent:${agentAddress}`,
      heartbeatRateLimitPerMinute,
      60_000
    );
    if (!heartbeatAgentLimit.allowed) return rateLimitError(reply, heartbeatAgentLimit.retryAfterSeconds);

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
    if (domainsLoggedIn.length > heartbeatMaxDomains) {
      return reply.code(400).send({ error: `domainsLoggedIn exceeds ${heartbeatMaxDomains} domains` });
    }

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

    const enabledCapabilities = await prisma.infoFiAgentCapability.findMany({
      where: {
        ...scopedWhere(),
        agentAddress,
        isEnabled: true
      },
      select: { domain: true }
    });
    const capabilityDomains = Array.from(new Set(enabledCapabilities.map((entry) => normalizeDomain(entry.domain)).filter(Boolean)));
    if (capabilityDomains.length === 0) {
      return reply.code(400).send({ error: "Agent has no enabled capabilities; call /agents/signup first" });
    }
    const invalidDomains = domainsLoggedIn.filter(
      (domain) => !capabilityDomains.some((capabilityDomain) => domainsOverlap(capabilityDomain, domain))
    );
    if (invalidDomains.length > 0) {
      return reply.code(400).send({
        error: "domainsLoggedIn contains domains not covered by enabled capabilities",
        invalidDomains: invalidDomains.slice(0, 20)
      });
    }

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
    const decisionIpLimit = consumeRateLimit(
      `agents:decisions:ip:${requestIp(req)}`,
      decisionRateLimitPerMinute,
      60_000
    );
    if (!decisionIpLimit.allowed) return rateLimitError(reply, decisionIpLimit.retryAfterSeconds);

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const agentAddress = normalizeAddress(data.agentAddress);
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agentAddress" });

    const decisionAgentLimit = consumeRateLimit(
      `agents:decisions:agent:${agentAddress}`,
      decisionRateLimitPerMinute,
      60_000
    );
    if (!decisionAgentLimit.allowed) return rateLimitError(reply, decisionAgentLimit.retryAfterSeconds);

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

  app.get("/agents/:address/readiness", async (req, reply) => {
    const params = req.params as { address?: string };
    const q = req.query as { domains?: string; domain?: string };
    const agentAddress = normalizeAddress(params.address || "");
    if (!agentAddress) return reply.code(400).send({ error: "Invalid agent address" });
    const requestedDomains = parseRequestedDomainsFromQuery(q as Record<string, unknown>);
    const readiness = await computeAgentReadiness(agentAddress, requestedDomains);
    return reply.send({ readiness });
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
      demandUniqueClients24h: 0,
      demandScore24hRedacted: true,
      requestCount7d: 0
    };

    return { summary: row };
  });

  app.post("/signals/extension/domains", async (req, reply) => {
    const signalIpLimit = consumeRateLimit(
      `signals:extension:ip:${requestIp(req)}`,
      extensionSignalRateLimitPerMinute,
      60_000
    );
    if (!signalIpLimit.allowed) return rateLimitError(reply, signalIpLimit.retryAfterSeconds);

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const clientIdHash = typeof data.clientIdHash === "string" ? data.clientIdHash.trim().toLowerCase() : "";
    if (!/^[a-z0-9:_-]{12,128}$/i.test(clientIdHash)) {
      return reply.code(400).send({ error: "clientIdHash must match [a-z0-9:_-]{12,128}" });
    }
    const signalClientLimit = consumeRateLimit(
      `signals:extension:client:${clientIdHash}`,
      extensionSignalRateLimitPerMinute,
      60_000
    );
    if (!signalClientLimit.allowed) return rateLimitError(reply, signalClientLimit.retryAfterSeconds);
    if (!Array.isArray(data.buckets) || data.buckets.length === 0) {
      return reply.code(400).send({ error: "buckets must be a non-empty array" });
    }
    if (data.buckets.length > DOMAIN_SIGNAL_MAX_BUCKETS_PER_REQUEST) {
      return reply.code(400).send({ error: `buckets exceeds ${DOMAIN_SIGNAL_MAX_BUCKETS_PER_REQUEST}` });
    }

    const mergedByKey = new Map<string, { domain: string; bucketStart: Date; signalCount: number }>();
    const nowMs = Date.now();
    const minBucketStartMs = nowMs - extensionSignalMaxBucketAgeHours * 60 * 60 * 1000;
    const maxBucketStartMs = nowMs + extensionSignalMaxFutureSkewMinutes * 60 * 1000;
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
      if (bucketStart.getTime() < minBucketStartMs || bucketStart.getTime() > maxBucketStartMs) {
        return reply.code(400).send({ error: `buckets[${index}].bucketStart out of accepted range` });
      }

      const signalCount = parsePositiveInt(item.signalCount, -1);
      if (signalCount <= 0 || signalCount > 1000) {
        return reply.code(400).send({ error: `buckets[${index}].signalCount must be in 1..1000` });
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

  async function executeFastTransferLedger(args: {
    externalRef: string;
    requestId?: string | null;
    jobId?: string | null;
    direction: "PAYOUT" | "REFUND";
    fromAddress: string;
    toAddress: string;
    amountWei: string;
  }) {
    const existing = await prisma.infoFiFastTransfer.findUnique({ where: { externalRef: args.externalRef } });
    if (existing?.status === "COMPLETED") return existing;
    if (existing?.status === "PENDING") {
      throw new Error(`FAST ${args.direction.toLowerCase()} is already pending.`);
    }

    const transfer =
      existing ||
      (await prisma.infoFiFastTransfer.create({
        data: {
          externalRef: args.externalRef,
          requestId: args.requestId ?? null,
          jobId: args.jobId ?? null,
          direction: args.direction,
          status: "PENDING",
          paymentToken: FAST_SETTLEMENT_TOKEN_SYMBOL,
          fromAddress: args.fromAddress,
          toAddress: args.toAddress,
          amountWei: args.amountWei,
        }
      }));

    try {
      const submitted = await submitFastTreasuryTransfer({
        to: args.toAddress,
        amountWei: args.amountWei,
      });
      return await prisma.infoFiFastTransfer.update({
        where: { id: transfer.id },
        data: {
          status: "COMPLETED",
          txHash: submitted.txHash,
          nonce: submitted.nonce,
          certificateJson: JSON.stringify(submitted.certificate),
          errorMessage: null,
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.infoFiFastTransfer.updateMany({
        where: { id: transfer.id },
        data: {
          status: "FAILED",
          errorMessage: message.slice(0, 1000),
        }
      });
      throw error;
    }
  }

  app.post("/fast/requests", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const sourceURI = typeof data.sourceURI === "string" ? data.sourceURI.trim() : "";
    const question = typeof data.question === "string" ? data.question.trim() : "";
    const maxAmountWei = typeof data.maxAmountWei === "string" ? data.maxAmountWei.trim() : "";
    const fundingCertificate = data.fundingCertificate as FastTransactionCertificate | undefined;
    if (!sourceURI || !question || !/^\d+$/.test(maxAmountWei) || BigInt(maxAmountWei) <= 0n) {
      return reply.code(400).send({ error: "Valid sourceURI, question, and maxAmountWei are required" });
    }
    if (!fundingCertificate || typeof fundingCertificate !== "object") {
      return reply.code(400).send({ error: "Funding certificate is required" });
    }

    const profile = await requireFastBoundProfile(session.evmAddress).catch((error: unknown) => {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (!profile) return;

    const treasuryAddress = await fastTreasuryAddress();
    const funding = await verifyFastFundingCertificate({
      certificate: fundingCertificate,
      expectedSender: profile.fastAddress!,
      expectedRecipient: treasuryAddress,
      expectedAmountWei: maxAmountWei,
    }).catch((error: unknown) => {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (!funding) return;

    const reusedFunding = await prisma.infoFiFastTransfer.findFirst({
      where: {
        txHash: funding.txHash,
        direction: "FUNDING",
      }
    });
    if (reusedFunding) {
      return reply.code(409).send({ error: "FAST funding transaction was already consumed by another request." });
    }

    const requestId = `fastreq_${randomTokenHex(10)}`;
    const transferRef = `fast-request:${requestId}:funding`;
    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.infoFiFastRequest.create({
        data: {
          requestId,
          requester: session.evmAddress,
          requesterFastAddress: profile.fastAddress!,
          paymentToken: FAST_SETTLEMENT_TOKEN_SYMBOL,
          maxAmountWei,
          sourceURI,
          question,
          status: "OPEN",
          fundingTxHash: funding.txHash,
          fundingNonce: funding.nonce,
          fundingCertificateJson: JSON.stringify(fundingCertificate),
        }
      });
      await tx.infoFiFastTransfer.create({
        data: {
          externalRef: transferRef,
          requestId,
          direction: "FUNDING",
          status: "COMPLETED",
          paymentToken: FAST_SETTLEMENT_TOKEN_SYMBOL,
          fromAddress: funding.senderAddress,
          toAddress: funding.recipientAddress,
          amountWei: maxAmountWei,
          txHash: funding.txHash,
          nonce: funding.nonce,
          certificateJson: JSON.stringify(fundingCertificate),
        }
      });
      return request;
    });

    return reply.code(201).send({ request: mapFastRequest(created) });
  });

  app.post("/fast/offers", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const requestId = typeof data.requestId === "string" ? data.requestId.trim().toLowerCase() : "";
    const amountWei = typeof data.amountWei === "string" ? data.amountWei.trim() : "";
    const etaSeconds = parsePositiveInt(data.etaSeconds, -1);
    const proofType = typeof data.proofType === "string" ? data.proofType.trim() || "reputation-only" : "reputation-only";
    if (!requestId || !/^\d+$/.test(amountWei) || BigInt(amountWei) <= 0n || etaSeconds <= 0) {
      return reply.code(400).send({ error: "Valid requestId, amountWei, and etaSeconds are required" });
    }

    const request = await prisma.infoFiFastRequest.findUnique({ where: { requestId } });
    if (!request) return reply.code(404).send({ error: "FAST request not found" });
    if (request.status !== "OPEN") return reply.code(409).send({ error: "FAST request is not open for offers" });

    const profile = await requireFastBoundProfile(session.evmAddress).catch((error: unknown) => {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (!profile) return;

    const offer = await prisma.infoFiFastOffer.create({
        data: {
          offerId: `fastoffer_${randomTokenHex(10)}`,
          requestId: request.requestId,
          consultant: session.evmAddress,
          consultantFastAddress: profile.fastAddress!,
        amountWei,
        etaSeconds,
        proofType,
        status: "OPEN",
      }
    });
    return reply.code(201).send({ offer: mapFastOffer(offer) });
  });

  app.post("/fast/offers/:offerId/hire", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;
    const params = req.params as { offerId?: string };
    const offerId = typeof params.offerId === "string" ? params.offerId.trim().toLowerCase() : "";
    if (!offerId) return reply.code(400).send({ error: "Missing offerId" });

    const offer = await prisma.infoFiFastOffer.findUnique({ where: { offerId } });
    if (!offer) return reply.code(404).send({ error: "FAST offer not found" });
    if (offer.status !== "OPEN") return reply.code(409).send({ error: "FAST offer is not open" });

    const request = await prisma.infoFiFastRequest.findUnique({ where: { requestId: offer.requestId } });
    if (!request) return reply.code(404).send({ error: "FAST request not found" });
    if (request.requester !== session.evmAddress) return reply.code(403).send({ error: "Only the requester can hire this FAST offer" });
    if (request.status !== "OPEN") return reply.code(409).send({ error: "FAST request is not open" });

    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.infoFiFastJob.create({
        data: {
          jobId: `fastjob_${randomTokenHex(10)}`,
          requestId: request.requestId,
          offerId: offer.offerId,
          requester: request.requester,
          requesterFastAddress: request.requesterFastAddress,
          consultant: offer.consultant,
          consultantFastAddress: offer.consultantFastAddress,
          paymentToken: FAST_SETTLEMENT_TOKEN_SYMBOL,
          amountWei: offer.amountWei,
          remainingWei: request.maxAmountWei,
          status: "HIRED",
          hiredAt: new Date(),
        }
      });
      await tx.infoFiFastRequest.update({
        where: { requestId: request.requestId },
        data: {
          status: "HIRED",
          hiredOfferId: offer.offerId,
        }
      });
      await tx.infoFiFastOffer.update({
        where: { offerId: offer.offerId },
        data: { status: "HIRED" }
      });
      await tx.infoFiFastOffer.updateMany({
        where: {
          requestId: request.requestId,
          offerId: { not: offer.offerId },
          status: "OPEN",
        },
        data: { status: "CLOSED" }
      });
      return created;
    });

    return reply.code(200).send({ job: mapFastJob(job) });
  });

  app.post("/fast/jobs/:jobId/deliver", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;

    const params = req.params as { jobId?: string };
    const jobId = typeof params.jobId === "string" ? params.jobId.trim().toLowerCase() : "";
    if (!jobId) return reply.code(400).send({ error: "Missing jobId" });

    const body = parseBody(req.body as any);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "Invalid JSON body" });
    }
    const data = body as Record<string, unknown>;
    const digestHash = typeof data.digestHash === "string" ? data.digestHash.trim().toLowerCase() : "";
    const metadataURI = typeof data.metadataURI === "string" ? data.metadataURI.trim() : "";
    const proofTypeOrURI = typeof data.proofTypeOrURI === "string" ? data.proofTypeOrURI.trim() : "";
    if (!digestHash || !metadataURI) {
      return reply.code(400).send({ error: "digestHash and metadataURI are required" });
    }

    const job = await prisma.infoFiFastJob.findUnique({ where: { jobId } });
    if (!job) return reply.code(404).send({ error: "FAST job not found" });
    if (job.consultant !== session.evmAddress) return reply.code(403).send({ error: "Only the consultant can deliver this FAST job" });
    if (job.status !== "HIRED") return reply.code(409).send({ error: "FAST job is not ready for delivery" });

    const updated = await prisma.infoFiFastJob.update({
      where: { jobId },
      data: {
        digestHash,
        metadataURI,
        proofTypeOrURI: proofTypeOrURI || "reputation-only",
        deliveredAt: new Date(),
        status: "DELIVERED",
      }
    });
    return reply.send({ job: mapFastJob(updated) });
  });

  app.post("/fast/jobs/:jobId/accept", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;
    const params = req.params as { jobId?: string };
    const jobId = typeof params.jobId === "string" ? params.jobId.trim().toLowerCase() : "";
    if (!jobId) return reply.code(400).send({ error: "Missing jobId" });

    const job = await prisma.infoFiFastJob.findUnique({ where: { jobId } });
    if (!job) return reply.code(404).send({ error: "FAST job not found" });
    if (job.requester !== session.evmAddress) return reply.code(403).send({ error: "Only the requester can accept this FAST job" });
    if (job.status === "CLOSED") return reply.send({ job: mapFastJob(job) });
    if (job.status !== "DELIVERED") return reply.code(409).send({ error: "FAST job is not delivered yet" });

    const payoutWei = BigInt(job.amountWei);
    const remainingWei = BigInt(job.remainingWei);
    if (remainingWei < payoutWei) {
      return reply.code(409).send({ error: "FAST job remaining balance is below payout amount" });
    }
    const refundWei = remainingWei - payoutWei;
    const treasuryAddress = await fastTreasuryAddress();

    try {
      await executeFastTransferLedger({
        externalRef: `fast-job:${job.jobId}:payout`,
        requestId: job.requestId,
        jobId: job.jobId,
        direction: "PAYOUT",
        fromAddress: treasuryAddress,
        toAddress: job.consultantFastAddress,
        amountWei: payoutWei.toString(),
      });
      if (refundWei > 0n) {
        await executeFastTransferLedger({
          externalRef: `fast-job:${job.jobId}:refund`,
          requestId: job.requestId,
          jobId: job.jobId,
          direction: "REFUND",
          fromAddress: treasuryAddress,
          toAddress: job.requesterFastAddress,
          amountWei: refundWei.toString(),
        });
      }
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.infoFiFastJob.update({
        where: { jobId: job.jobId },
        data: {
          remainingWei: "0",
          status: "CLOSED",
          closedAt: new Date(),
        }
      });
      await tx.infoFiFastRequest.update({
        where: { requestId: job.requestId },
        data: { status: "CLOSED" }
      });
      await tx.infoFiFastOffer.update({
        where: { offerId: job.offerId },
        data: { status: "CLOSED" }
      });
      return next;
    });
    return reply.send({ job: mapFastJob(updated) });
  });

  app.post("/fast/jobs/:jobId/refund", async (req, reply) => {
    const session = await requireUserSession(req, reply);
    if (!session) return;
    const params = req.params as { jobId?: string };
    const jobId = typeof params.jobId === "string" ? params.jobId.trim().toLowerCase() : "";
    if (!jobId) return reply.code(400).send({ error: "Missing jobId" });

    const job = await prisma.infoFiFastJob.findUnique({ where: { jobId } });
    if (!job) return reply.code(404).send({ error: "FAST job not found" });
    if (job.requester !== session.evmAddress) return reply.code(403).send({ error: "Only the requester can refund this FAST job" });
    if (job.status === "CLOSED") return reply.send({ job: mapFastJob(job) });
    if (job.deliveredAt) return reply.code(409).send({ error: "FAST job cannot be refunded after delivery" });

    const treasuryAddress = await fastTreasuryAddress();
    try {
      await executeFastTransferLedger({
        externalRef: `fast-job:${job.jobId}:refund`,
        requestId: job.requestId,
        jobId: job.jobId,
        direction: "REFUND",
        fromAddress: treasuryAddress,
        toAddress: job.requesterFastAddress,
        amountWei: job.remainingWei,
      });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.infoFiFastJob.update({
        where: { jobId: job.jobId },
        data: {
          remainingWei: "0",
          status: "CLOSED",
          closedAt: new Date(),
        }
      });
      await tx.infoFiFastRequest.update({
        where: { requestId: job.requestId },
        data: { status: "CLOSED" }
      });
      await tx.infoFiFastOffer.update({
        where: { offerId: job.offerId },
        data: { status: "CLOSED" }
      });
      return next;
    });
    return reply.send({ job: mapFastJob(updated) });
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
      if (request) {
        const offers = await prisma.infoFiOffer.findMany({
          where: { ...scopedWhere(), requestId: request.requestId },
          orderBy: { createdAt: "asc" }
        });
        const job = await prisma.infoFiJob.findFirst({
          where: { ...scopedWhere(), requestId: request.requestId }
        });
        return { request: { ...mapBaseRequest(request), offers: offers.map(mapBaseOffer), job: job ? mapBaseJob(job) : null } };
      }

      const fastRequest = await prisma.infoFiFastRequest.findUnique({
        where: { requestId: q.requestId.toLowerCase() }
      });
      if (!fastRequest) return { request: null };
      const offers = await prisma.infoFiFastOffer.findMany({
        where: { requestId: fastRequest.requestId },
        orderBy: { createdAt: "asc" }
      });
      const job = await prisma.infoFiFastJob.findUnique({
        where: { requestId: fastRequest.requestId }
      });
      return { request: { ...mapFastRequest(fastRequest), offers: offers.map(mapFastOffer), job: job ? mapFastJob(job) : null } };
    }

    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const requests = await prisma.infoFiRequest.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take
    });
    const fastWhere: any = {};
    if (q.requester) fastWhere.requester = q.requester.toLowerCase();
    if (q.status) fastWhere.status = q.status.toUpperCase();
    const fastRequests = await prisma.infoFiFastRequest.findMany({
      where: fastWhere,
      orderBy: { updatedAt: "desc" },
      take
    });
    const combined = sortByUpdatedAtDesc([
      ...requests.map(mapBaseRequest),
      ...fastRequests.map(mapFastRequest),
    ]).slice(0, take);
    return { requests: combined };
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
      if (offer) return { offer: mapBaseOffer(offer) };
      const fastOffer = await prisma.infoFiFastOffer.findUnique({
        where: { offerId: q.offerId.toLowerCase() }
      });
      return { offer: fastOffer ? mapFastOffer(fastOffer) : null };
    }

    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const offers = await prisma.infoFiOffer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take
    });
    const fastWhere: any = {};
    if (q.requestId) fastWhere.requestId = q.requestId.toLowerCase();
    if (q.consultant) fastWhere.consultant = q.consultant.toLowerCase();
    if (q.status) fastWhere.status = q.status.toUpperCase();
    const fastOffers = await prisma.infoFiFastOffer.findMany({
      where: fastWhere,
      orderBy: { updatedAt: "desc" },
      take
    });
    const combined = sortByUpdatedAtDesc([
      ...offers.map(mapBaseOffer),
      ...fastOffers.map(mapFastOffer),
    ]).slice(0, take);
    return { offers: combined };
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
      if (job) {
        const payouts = await prisma.infoFiPayout.findMany({ where: { jobId: job.jobId }, orderBy: { createdAt: "asc" } });
        const refunds = await prisma.infoFiRefund.findMany({ where: { jobId: job.jobId }, orderBy: { createdAt: "asc" } });
        const ratings = await prisma.infoFiRating.findMany({ where: { jobId: job.jobId }, orderBy: { createdAt: "asc" } });
        const digest = await prisma.infoFiDigest.findFirst({ where: { jobId: job.jobId }, orderBy: { createdAt: "desc" } });
        return { job: { ...mapBaseJob(job), payouts, refunds, ratings, digest } };
      }

      const fastJob = await prisma.infoFiFastJob.findUnique({
        where: { jobId: q.jobId.toLowerCase() }
      });
      if (!fastJob) return { job: null };
      const [transfers, digest] = await Promise.all([
        prisma.infoFiFastTransfer.findMany({ where: { jobId: fastJob.jobId }, orderBy: { createdAt: "asc" } }),
        prisma.infoFiDigest.findFirst({ where: { jobId: fastJob.jobId }, orderBy: { createdAt: "desc" } }),
      ]);
      return {
        job: {
          ...mapFastJob(fastJob),
          payouts: mapFastTransfersToPayouts(fastJob.jobId, transfers),
          refunds: mapFastTransfersToRefunds(fastJob.jobId, transfers),
          ratings: [],
          digest,
        }
      };
    }

    const take = Math.min(Math.max(Number(q.take || "200"), 1), 500);
    const jobs = await prisma.infoFiJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take
    });
    const fastWhere: any = {};
    if (q.requestId) fastWhere.requestId = q.requestId.toLowerCase();
    if (q.requester) fastWhere.requester = q.requester.toLowerCase();
    if (q.consultant) fastWhere.consultant = q.consultant.toLowerCase();
    if (q.status) fastWhere.status = q.status.toUpperCase();
    const fastJobs = await prisma.infoFiFastJob.findMany({
      where: fastWhere,
      orderBy: { updatedAt: "desc" },
      take
    });
    const statusQuery = q.status ? q.status.toUpperCase() : "";
    const result = sortByUpdatedAtDesc([
      ...jobs.map(mapBaseJob),
      ...fastJobs.map(mapFastJob),
    ])
      .filter((job) => (statusQuery ? job.status === statusQuery : true))
      .slice(0, take);
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
