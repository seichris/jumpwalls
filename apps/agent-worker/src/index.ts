import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { infoFiAbi } from "@infofi/shared";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  Hex,
  http,
  isAddress,
  keccak256,
  parseEventLogs,
  stringToHex
} from "viem";
import {
  type DeliveryDigestRef,
  type DeliveryRetryState,
  extractDomainFromSource,
  normalizeDomain,
  pickBestCandidate,
  scheduleDeliveryRetry
} from "./logic.js";

type WorkerMode = "dry-run" | "auto-offer";

type WorkerConfig = {
  apiUrl: string;
  privateKey: Hex;
  mode: WorkerMode;
  pollMs: number;
  heartbeatIntervalMs: number;
  heartbeatTtlSeconds: number;
  requestTake: number;
  jobsTake: number;
  decisionLogging: boolean;
  autoDeliverEnabled: boolean;
  once: boolean;
  defaultProofType: string;
  deliverProofType: string;
  saltPrefix: string;
  digestTemplate: string;
  digestMaxChars: number;
  capabilitiesFile: string | null;
  signupDisplayName: string | null;
  signupStatus: "ACTIVE" | "PAUSED";
  degradedFailureThreshold: number;
  degradedRecoveryHeartbeats: number;
  deliverMaxRetries: number;
  deliverRetryBaseMs: number;
  deliverRetryMaxMs: number;
  chainId: number | null;
  rpcUrl: string | null;
  contractAddress: Hex | null;
};

type ApiRequest = {
  requestId: string;
  paymentToken: string;
  maxAmountWei: string;
  sourceURI: string;
  question: string;
  status: string;
  requester: string;
};

type ApiOffer = {
  requestId: string;
};

type ApiJob = {
  jobId: string;
  requestId: string;
  offerId: string;
  requester: string;
  consultant: string;
  paymentToken: string;
  amountWei: string;
  remainingWei: string;
  deliveredAt: string | null;
  metadataURI: string | null;
  proofTypeOrURI: string | null;
  status: string;
};

type ApiAgentCapability = {
  domain: string;
  paymentToken: string;
  minAmountWei: string;
  maxAmountWei: string;
  etaSeconds: number;
  minConfidence: number;
  proofTypeDefault: string | null;
  isEnabled: boolean;
};

type ApiAgentPayload = {
  agent: {
    capabilities?: ApiAgentCapability[];
  } | null;
};

type ApiRequestDetailPayload = {
  request: {
    requestId: string;
    sourceURI: string;
    question: string;
  } | null;
};

type ApiDigest = {
  consultantAddress: string;
  digestHash: string;
  metadataURI: string;
  createdAt: string;
};

type ApiDigestListPayload = {
  digests?: ApiDigest[];
};

type Candidate = {
  capability: ApiAgentCapability;
  offerAmountWei: bigint;
  confidence: number;
  domain: string;
};

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_HEARTBEAT_TTL_SECONDS = 120;
const DEFAULT_REQUEST_TAKE = 200;
const DEFAULT_JOBS_TAKE = 200;
const DEFAULT_PROOF_TYPE = "agent-auto";
const DEFAULT_DELIVER_PROOF_TYPE = "reputation-only";
const DEFAULT_SALT_PREFIX = "infofi-agent-worker";
const DEFAULT_DIGEST_TEMPLATE =
  "Auto-generated consultant digest for {sourceURI}\nQuestion: {question}\n\nSummary:\n- This draft confirms the agent is available and has begun analysis.\n- A full source-grounded response will be expanded in follow-up iterations.\n\nJob: {jobId}\nGeneratedAt: {generatedAt}";
const DEFAULT_DIGEST_MAX_CHARS = 6000;
const DEFAULT_DEGRADED_FAILURE_THRESHOLD = 3;
const DEFAULT_DEGRADED_RECOVERY_HEARTBEATS = 2;
const DEFAULT_DELIVER_MAX_RETRIES = 6;
const DEFAULT_DELIVER_RETRY_BASE_MS = 15_000;
const DEFAULT_DELIVER_RETRY_MAX_MS = 15 * 60 * 1000;

function envString(name: string) {
  return String(process.env[name] || "").trim();
}

function parsePositiveInt(value: string, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  if (v < min || v > max) return fallback;
  return v;
}

function parseBool(value: string, fallback: boolean) {
  if (!value) return fallback;
  const lowered = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(lowered)) return true;
  if (["0", "false", "no", "n", "off"].includes(lowered)) return false;
  return fallback;
}

function normalizeApiUrl(input: string) {
  return input.replace(/\/+$/, "");
}

async function main() {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });
  const cfg = loadConfig();
  const account = privateKeyToAccount(cfg.privateKey);
  const worker = new AgentWorker(cfg, account.address.toLowerCase() as Hex, account);
  await worker.start();
}

function loadConfig(): WorkerConfig {
  const apiUrl = normalizeApiUrl(envString("API_URL"));
  if (!apiUrl) throw new Error("Missing API_URL");

  const privateKeyRaw = envString("PRIVATE_KEY");
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKeyRaw)) {
    throw new Error("PRIVATE_KEY must be a 32-byte hex value");
  }

  const modeRaw = envString("AGENT_MODE").toLowerCase();
  const mode: WorkerMode = modeRaw === "auto-offer" ? "auto-offer" : "dry-run";

  const chainIdRaw = envString("CHAIN_ID");
  const chainId = chainIdRaw ? Number(chainIdRaw) : null;
  const rpcUrl = envString("RPC_URL") || null;
  const contractAddressRaw = envString("CONTRACT_ADDRESS");
  const contractAddress = isAddress(contractAddressRaw) ? (contractAddressRaw.toLowerCase() as Hex) : null;

  if (mode === "auto-offer") {
    if (!Number.isFinite(chainId) || !chainId || chainId <= 0) throw new Error("CHAIN_ID must be set for auto-offer mode");
    if (!rpcUrl) throw new Error("RPC_URL must be set for auto-offer mode");
    if (!contractAddress) throw new Error("CONTRACT_ADDRESS must be set for auto-offer mode");
  }

  const capabilitiesFile = envString("AGENT_SIGNUP_CAPABILITIES_FILE") || null;
  const signupDisplayName = envString("AGENT_SIGNUP_DISPLAY_NAME") || null;
  const signupStatusRaw = envString("AGENT_SIGNUP_STATUS").toUpperCase();
  const signupStatus: "ACTIVE" | "PAUSED" = signupStatusRaw === "PAUSED" ? "PAUSED" : "ACTIVE";

  return {
    apiUrl,
    privateKey: privateKeyRaw as Hex,
    mode,
    pollMs: parsePositiveInt(envString("AGENT_POLL_MS"), DEFAULT_POLL_MS, 3_000, 300_000),
    heartbeatIntervalMs: parsePositiveInt(
      envString("AGENT_HEARTBEAT_INTERVAL_MS"),
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      10_000,
      3_600_000
    ),
    heartbeatTtlSeconds: parsePositiveInt(
      envString("AGENT_HEARTBEAT_TTL_SECONDS"),
      DEFAULT_HEARTBEAT_TTL_SECONDS,
      30,
      900
    ),
    requestTake: parsePositiveInt(envString("AGENT_REQUEST_TAKE"), DEFAULT_REQUEST_TAKE, 1, 500),
    jobsTake: parsePositiveInt(envString("AGENT_JOBS_TAKE"), DEFAULT_JOBS_TAKE, 1, 500),
    decisionLogging: parseBool(envString("AGENT_DECISION_LOGGING"), true),
    autoDeliverEnabled: parseBool(envString("AGENT_AUTO_DELIVER_ENABLED"), true),
    once: parseBool(envString("AGENT_ONCE"), false),
    defaultProofType: envString("AGENT_PROOF_TYPE_DEFAULT") || DEFAULT_PROOF_TYPE,
    deliverProofType: envString("AGENT_DELIVER_PROOF_TYPE") || DEFAULT_DELIVER_PROOF_TYPE,
    saltPrefix: envString("AGENT_SALT_PREFIX") || DEFAULT_SALT_PREFIX,
    digestTemplate: envString("AGENT_DIGEST_TEMPLATE") || DEFAULT_DIGEST_TEMPLATE,
    digestMaxChars: parsePositiveInt(envString("AGENT_DIGEST_MAX_CHARS"), DEFAULT_DIGEST_MAX_CHARS, 256, 20_000),
    capabilitiesFile,
    signupDisplayName,
    signupStatus,
    degradedFailureThreshold: parsePositiveInt(
      envString("AGENT_DEGRADED_FAILURE_THRESHOLD"),
      DEFAULT_DEGRADED_FAILURE_THRESHOLD,
      1,
      20
    ),
    degradedRecoveryHeartbeats: parsePositiveInt(
      envString("AGENT_DEGRADED_RECOVERY_HEARTBEATS"),
      DEFAULT_DEGRADED_RECOVERY_HEARTBEATS,
      1,
      10
    ),
    deliverMaxRetries: parsePositiveInt(envString("AGENT_DELIVER_MAX_RETRIES"), DEFAULT_DELIVER_MAX_RETRIES, 1, 50),
    deliverRetryBaseMs: parsePositiveInt(
      envString("AGENT_DELIVER_RETRY_BASE_MS"),
      DEFAULT_DELIVER_RETRY_BASE_MS,
      1_000,
      10 * 60 * 1000
    ),
    deliverRetryMaxMs: parsePositiveInt(
      envString("AGENT_DELIVER_RETRY_MAX_MS"),
      DEFAULT_DELIVER_RETRY_MAX_MS,
      5_000,
      24 * 60 * 60 * 1000
    ),
    chainId: Number.isFinite(chainId) && chainId && chainId > 0 ? chainId : null,
    rpcUrl,
    contractAddress
  };
}

class AgentWorker {
  private readonly publicClient;
  private readonly walletClient;
  private capabilities: ApiAgentCapability[] = [];
  private heartbeatInFlight = false;
  private stopRequested = false;
  private readonly processingJobs = new Set<string>();
  private degradedMode = false;
  private consecutiveApiFailures = 0;
  private consecutiveHeartbeatFailures = 0;
  private heartbeatRecoveries = 0;
  private readonly deliveryRetryByJobId = new Map<string, DeliveryRetryState>();

  constructor(
    private readonly cfg: WorkerConfig,
    private readonly agentAddress: Hex,
    private readonly account: ReturnType<typeof privateKeyToAccount>
  ) {
    if (cfg.mode === "auto-offer") {
      const chain = defineChain({
        id: cfg.chainId || 0,
        name: `infofi-${cfg.chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl || ""] } }
      });
      this.publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl || "") });
      this.walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl || "") });
    } else {
      this.publicClient = null;
      this.walletClient = null;
    }
  }

  async start() {
    this.installSignalHandlers();
    await this.assertApiReady();
    if (this.cfg.capabilitiesFile) await this.signupFromFile(this.cfg.capabilitiesFile);
    await this.refreshCapabilities();
    await this.sendHeartbeat("startup");

    if (this.cfg.once) {
      await this.runIteration();
      return;
    }

    const heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat("interval");
    }, this.cfg.heartbeatIntervalMs);

    try {
      while (!this.stopRequested) {
        await this.runIteration();
        await sleep(this.cfg.pollMs);
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private installSignalHandlers() {
    const stop = () => {
      this.stopRequested = true;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }

  private async assertApiReady() {
    const health = await this.apiGet<{ ok?: boolean }>("/health");
    if (!health?.ok) throw new Error("API /health check failed");

    try {
      const contract = await this.apiGet<{ chainId?: number; contractAddress?: string }>("/contract");
      if (this.cfg.chainId != null && typeof contract.chainId === "number" && this.cfg.chainId !== contract.chainId) {
        throw new Error(`CHAIN_ID mismatch: worker=${this.cfg.chainId} api=${contract.chainId}`);
      }
      if (
        this.cfg.contractAddress &&
        typeof contract.contractAddress === "string" &&
        contract.contractAddress.toLowerCase() !== this.cfg.contractAddress.toLowerCase()
      ) {
        throw new Error(
          `CONTRACT_ADDRESS mismatch: worker=${this.cfg.contractAddress} api=${contract.contractAddress.toLowerCase()}`
        );
      }
    } catch (err) {
      if (this.cfg.mode === "auto-offer") throw err;
      console.warn(`[agent-worker] /contract check skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async signupFromFile(path: string) {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("AGENT_SIGNUP_CAPABILITIES_FILE must contain a JSON array");

    const challenge = await this.apiPost<{
      challenge?: { nonce?: string; messageToSign?: string };
    }>("/agents/challenge", {
      agentAddress: this.agentAddress,
      purpose: "signup"
    });
    const nonce = typeof challenge.challenge?.nonce === "string" ? challenge.challenge.nonce : "";
    const messageToSign = typeof challenge.challenge?.messageToSign === "string" ? challenge.challenge.messageToSign : "";
    if (!nonce || !messageToSign) throw new Error("Failed to create signup challenge");
    const signature = await this.account.signMessage({ message: messageToSign });

    await this.apiPost("/agents/signup", {
      agentAddress: this.agentAddress,
      nonce,
      signature,
      displayName: this.cfg.signupDisplayName,
      status: this.cfg.signupStatus,
      capabilities: parsed
    });
    console.log(`[agent-worker] signed up agent ${this.agentAddress} with capabilities from ${path}`);
  }

  private async refreshCapabilities() {
    const payload = await this.apiGet<ApiAgentPayload>(`/agents/${this.agentAddress}`);
    const capabilities = Array.isArray(payload?.agent?.capabilities) ? payload.agent.capabilities : [];
    this.capabilities = capabilities.filter((capability) => Boolean(capability?.isEnabled));
    console.log(`[agent-worker] loaded ${this.capabilities.length} enabled capabilities`);
  }

  private enterDegradedMode(reason: string) {
    if (this.degradedMode) return;
    this.degradedMode = true;
    this.heartbeatRecoveries = 0;
    console.warn(`[agent-worker] degraded mode enabled: ${reason}`);
  }

  private maybeRecoverFromDegradedMode() {
    if (!this.degradedMode) return;
    if (this.consecutiveApiFailures > 0) return;
    if (this.heartbeatRecoveries < this.cfg.degradedRecoveryHeartbeats) return;
    this.degradedMode = false;
    this.consecutiveHeartbeatFailures = 0;
    console.log("[agent-worker] degraded mode cleared after healthy heartbeats");
  }

  private recordApiFailure(context: string, err: unknown) {
    this.consecutiveApiFailures += 1;
    this.heartbeatRecoveries = 0;
    const message = err instanceof Error ? err.message : String(err);
    if (this.consecutiveApiFailures >= this.cfg.degradedFailureThreshold) {
      this.enterDegradedMode(`api failures reached threshold at ${context}: ${message}`);
    }
  }

  private recordApiSuccess() {
    this.consecutiveApiFailures = 0;
    this.maybeRecoverFromDegradedMode();
  }

  private recordHeartbeatFailure(context: string, err: unknown) {
    this.consecutiveHeartbeatFailures += 1;
    this.heartbeatRecoveries = 0;
    const message = err instanceof Error ? err.message : String(err);
    if (this.consecutiveHeartbeatFailures >= this.cfg.degradedFailureThreshold) {
      this.enterDegradedMode(`heartbeat failures reached threshold at ${context}: ${message}`);
    }
  }

  private recordHeartbeatSuccess() {
    this.consecutiveHeartbeatFailures = 0;
    this.heartbeatRecoveries += 1;
    this.maybeRecoverFromDegradedMode();
  }

  private async sendHeartbeat(source: "startup" | "interval") {
    if (this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      if (this.capabilities.length === 0) return;

      const domains = Array.from(new Set(this.capabilities.map((capability) => normalizeDomain(capability.domain)).filter(Boolean)));
      if (domains.length === 0) return;

      const expectedEtaByDomain: Record<string, number> = {};
      for (const capability of this.capabilities) {
        const domain = normalizeDomain(capability.domain);
        if (!domain) continue;
        const existing = expectedEtaByDomain[domain];
        if (existing == null || capability.etaSeconds < existing) {
          expectedEtaByDomain[domain] = capability.etaSeconds;
        }
      }

      const challenge = await this.apiPost<{
        challenge?: { nonce?: string; messageToSign?: string };
      }>("/agents/challenge", {
        agentAddress: this.agentAddress,
        purpose: "heartbeat"
      }, { trackFailure: false });
      const nonce = typeof challenge.challenge?.nonce === "string" ? challenge.challenge.nonce : "";
      const messageToSign = typeof challenge.challenge?.messageToSign === "string" ? challenge.challenge.messageToSign : "";
      if (!nonce || !messageToSign) throw new Error("Failed to create heartbeat challenge");
      const signature = await this.account.signMessage({ message: messageToSign });

      await this.apiPost("/agents/heartbeat", {
        agentAddress: this.agentAddress,
        nonce,
        signature,
        domainsLoggedIn: domains,
        expectedEtaByDomain,
        ttlSeconds: this.cfg.heartbeatTtlSeconds,
        clientVersion: "agent-worker-v1"
      }, { trackFailure: false });

      console.log(`[agent-worker] heartbeat sent (${source}) domains=${domains.length}`);
      this.recordHeartbeatSuccess();
    } catch (err) {
      console.warn(`[agent-worker] heartbeat failed (${source}): ${err instanceof Error ? err.message : String(err)}`);
      this.recordApiFailure(`heartbeat:${source}`, err);
      this.recordHeartbeatFailure(`heartbeat:${source}`, err);
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private async runIteration() {
    await this.refreshCapabilities();
    if (this.degradedMode) {
      console.warn("[agent-worker] degraded mode active; skipping auto-offer evaluation");
    } else if (this.capabilities.length === 0) {
      console.warn("[agent-worker] no capabilities configured; skipping offer evaluation");
    } else {
      const [requestsPayload, offersPayload] = await Promise.all([
        this.apiGet<{ requests?: ApiRequest[] }>(`/requests?status=OPEN&take=${this.cfg.requestTake}`),
        this.apiGet<{ offers?: ApiOffer[] }>(`/offers?consultant=${this.agentAddress}&status=OPEN&take=500`)
      ]);
      const requests = Array.isArray(requestsPayload.requests) ? requestsPayload.requests : [];
      const existingOffers = Array.isArray(offersPayload.offers) ? offersPayload.offers : [];
      const offeredRequestIds = new Set(existingOffers.map((offer) => offer.requestId.toLowerCase()));

      console.log(
        `[agent-worker] evaluating ${requests.length} open requests (existing open offers by this agent: ${offeredRequestIds.size})`
      );

      for (const request of requests) {
        const requestId = request.requestId.toLowerCase();
        if (offeredRequestIds.has(requestId)) continue;

        const domain = extractDomainFromSource(request.sourceURI);
        if (!domain) continue;

        const candidate = this.pickCandidate(request, domain);
        if (!candidate) continue;

        if (this.cfg.mode === "dry-run") {
          console.log(
            `[agent-worker] dry-run would offer requestId=${requestId} domain=${domain} amountWei=${candidate.offerAmountWei.toString()} etaSeconds=${candidate.capability.etaSeconds} confidence=${candidate.confidence.toFixed(3)}`
          );
          await this.logDecision({
            requestId,
            domain,
            decision: "SKIP",
            confidence: candidate.confidence,
            reasonCode: "DRY_RUN_WOULD_OFFER",
            reasonDetail: "Dry-run mode enabled",
            offerAmountWei: candidate.offerAmountWei.toString(),
            etaSeconds: candidate.capability.etaSeconds
          });
          continue;
        }

        try {
          const posted = await this.postOffer(request, candidate);
          offeredRequestIds.add(requestId);
          await this.logDecision({
            requestId,
            domain,
            decision: "OFFERED",
            confidence: candidate.confidence,
            reasonCode: "AUTO_OFFER_POSTED",
            reasonDetail: null,
            offerAmountWei: candidate.offerAmountWei.toString(),
            etaSeconds: candidate.capability.etaSeconds,
            offerId: posted.offerId,
            txHash: posted.txHash
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[agent-worker] offer failed requestId=${requestId}: ${message}`);
          await this.logDecision({
            requestId,
            domain,
            decision: "FAILED",
            confidence: candidate.confidence,
            reasonCode: "AUTO_OFFER_FAILED",
            reasonDetail: message,
            offerAmountWei: candidate.offerAmountWei.toString(),
            etaSeconds: candidate.capability.etaSeconds
          });
        }
      }
    }

    await this.processHiredJobs();
  }

  private async processHiredJobs() {
    const payload = await this.apiGet<{ jobs?: ApiJob[] }>(
      `/jobs?consultant=${this.agentAddress}&status=HIRED&take=${this.cfg.jobsTake}`
    );
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    if (jobs.length === 0) return;

    console.log(`[agent-worker] evaluating ${jobs.length} hired jobs for delivery`);
    for (const job of jobs) {
      const jobId = String(job.jobId || "").toLowerCase();
      if (!/^0x[a-fA-F0-9]{64}$/.test(jobId)) continue;
      if (this.processingJobs.has(jobId)) continue;
      if (job.deliveredAt) {
        this.deliveryRetryByJobId.delete(jobId);
        continue;
      }
      const retryState = this.deliveryRetryByJobId.get(jobId);
      if (retryState?.disabled) continue;
      if (retryState && Date.now() < retryState.nextAttemptAt) continue;

      this.processingJobs.add(jobId);
      try {
        await this.handleHiredJob({ ...job, jobId });
      } catch (err) {
        console.warn(
          `[agent-worker] hired job processing failed jobId=${jobId}: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        this.processingJobs.delete(jobId);
      }
    }
  }

  private async handleHiredJob(job: ApiJob & { jobId: string }) {
    const requestDetails = await this.apiGet<ApiRequestDetailPayload>(`/requests?requestId=${encodeURIComponent(job.requestId)}`);
    const request = requestDetails.request;
    if (!request) {
      console.warn(`[agent-worker] hired job ${job.jobId} has missing request ${job.requestId}`);
      return;
    }

    const domain = extractDomainFromSource(request.sourceURI);
    if (!domain) {
      console.warn(`[agent-worker] hired job ${job.jobId} request has invalid sourceURI`);
      return;
    }

    const digestText = this.buildDigestText({
      jobId: job.jobId,
      requestId: request.requestId,
      sourceURI: request.sourceURI,
      question: request.question
    });

    if (this.cfg.mode === "dry-run" || !this.cfg.autoDeliverEnabled) {
      const reason =
        this.cfg.mode === "dry-run"
          ? "Dry-run mode enabled"
          : "AGENT_AUTO_DELIVER_ENABLED=false";
      console.log(`[agent-worker] dry-run would deliver jobId=${job.jobId} domain=${domain} digestChars=${digestText.length}`);
      await this.logDecision({
        requestId: request.requestId,
        domain,
        decision: "SKIP",
        confidence: 1,
        reasonCode: "DRY_RUN_WOULD_DELIVER",
        reasonDetail: reason
      });
      return;
    }

    const existingRetryState = this.deliveryRetryByJobId.get(job.jobId);
    let digestRef: DeliveryDigestRef | null = existingRetryState?.storedDigest ?? null;

    try {
      if (!digestRef) {
        digestRef = await this.fetchReusableDigest(job.jobId);
      }
      if (!digestRef) {
        digestRef = await this.storeDigest({
          jobId: job.jobId,
          sourceURI: request.sourceURI,
          question: request.question,
          digest: digestText
        });
      }
      this.deliveryRetryByJobId.set(job.jobId, {
        attempts: existingRetryState?.attempts ?? 0,
        nextAttemptAt: 0,
        lastError: null,
        disabled: false,
        storedDigest: digestRef
      });

      const delivered = await this.deliverDigestOnchain({
        job,
        digestHash: digestRef.digestHash,
        metadataURI: digestRef.metadataURI
      });
      this.deliveryRetryByJobId.delete(job.jobId);

      await this.logDecision({
        requestId: request.requestId,
        domain,
        decision: "OFFERED",
        confidence: 1,
        reasonCode: "AUTO_DELIVER_POSTED",
        reasonDetail: null,
        offerId: job.offerId,
        txHash: delivered.txHash
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (await this.isJobAlreadyDelivered(job.jobId)) {
        this.deliveryRetryByJobId.delete(job.jobId);
        await this.logDecision({
          requestId: request.requestId,
          domain,
          decision: "SKIP",
          confidence: 1,
          reasonCode: "AUTO_DELIVER_ALREADY_DELIVERED",
          reasonDetail: message,
          offerId: job.offerId
        });
        return;
      }

      const nextState = scheduleDeliveryRetry({
        previous: this.deliveryRetryByJobId.get(job.jobId),
        nowMs: Date.now(),
        error: message,
        maxRetries: this.cfg.deliverMaxRetries,
        baseBackoffMs: this.cfg.deliverRetryBaseMs,
        maxBackoffMs: this.cfg.deliverRetryMaxMs
      });
      this.deliveryRetryByJobId.set(job.jobId, nextState);
      const reasonCode = nextState.disabled ? "AUTO_DELIVER_GAVE_UP" : "AUTO_DELIVER_RETRY_SCHEDULED";
      const reasonDetail = nextState.disabled
        ? `${message}; retries_exhausted=${nextState.attempts}`
        : `${message}; attempt=${nextState.attempts}; retryAt=${new Date(nextState.nextAttemptAt).toISOString()}`;
      await this.logDecision({
        requestId: request.requestId,
        domain,
        decision: "FAILED",
        confidence: 1,
        reasonCode,
        reasonDetail,
        offerId: job.offerId
      });
      if (nextState.disabled) {
        console.warn(`[agent-worker] delivery disabled for job ${job.jobId} after ${nextState.attempts} attempts`);
      }
    }
  }

  private async fetchReusableDigest(jobId: string): Promise<DeliveryDigestRef | null> {
    const payload = await this.apiGet<ApiDigestListPayload>(`/digests?jobId=${encodeURIComponent(jobId)}&take=20`);
    const digests = Array.isArray(payload.digests) ? payload.digests : [];
    const candidates = digests.filter((digest) => {
      if (!digest || typeof digest !== "object") return false;
      const digestHash = typeof digest.digestHash === "string" ? digest.digestHash.toLowerCase() : "";
      const metadataURI = typeof digest.metadataURI === "string" ? digest.metadataURI.trim() : "";
      const consultant = typeof digest.consultantAddress === "string" ? digest.consultantAddress.toLowerCase() : "";
      return /^0x[a-fA-F0-9]{64}$/.test(digestHash) && metadataURI.length > 0 && consultant === this.agentAddress.toLowerCase();
    });
    if (candidates.length === 0) return null;
    candidates.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
    const latest = candidates[0]!;
    return {
      digestHash: latest.digestHash.toLowerCase(),
      metadataURI: latest.metadataURI.trim()
    };
  }

  private async isJobAlreadyDelivered(jobId: string): Promise<boolean> {
    try {
      const payload = await this.apiGet<{ job?: ApiJob | null }>(`/jobs?jobId=${encodeURIComponent(jobId)}`);
      return Boolean(payload?.job?.deliveredAt);
    } catch {
      return false;
    }
  }

  private buildDigestText(input: { jobId: string; requestId: string; sourceURI: string; question: string }) {
    const now = new Date().toISOString();
    let digest = this.cfg.digestTemplate
      .replaceAll("{jobId}", input.jobId)
      .replaceAll("{requestId}", input.requestId)
      .replaceAll("{sourceURI}", input.sourceURI)
      .replaceAll("{question}", input.question)
      .replaceAll("{generatedAt}", now);

    // Keep generated payload bounded for API storage and on-chain hash consistency.
    if (digest.length > this.cfg.digestMaxChars) {
      digest = `${digest.slice(0, this.cfg.digestMaxChars)}\n\n[truncated]`;
    }
    return digest.trim();
  }

  private async storeDigest(input: {
    jobId: string;
    sourceURI: string;
    question: string;
    digest: string;
  }): Promise<{ digestHash: string; metadataURI: string }> {
    const payload = await this.apiPost<{
      digest?: {
        digestHash?: string;
        metadataURI?: string;
      };
    }>("/digests", {
      jobId: input.jobId,
      consultantAddress: this.agentAddress,
      sourceURI: input.sourceURI,
      question: input.question,
      digest: input.digest,
      proof: "auto-generated-by-agent-worker"
    });

    const digestHash = typeof payload.digest?.digestHash === "string" ? payload.digest.digestHash.toLowerCase() : "";
    const metadataURI = typeof payload.digest?.metadataURI === "string" ? payload.digest.metadataURI.trim() : "";
    if (!/^0x[a-fA-F0-9]{64}$/.test(digestHash) || !metadataURI) {
      throw new Error("API /digests did not return digestHash/metadataURI");
    }
    return { digestHash, metadataURI };
  }

  private async deliverDigestOnchain(input: {
    job: ApiJob;
    digestHash: string;
    metadataURI: string;
  }): Promise<{ txHash: string }> {
    if (!this.walletClient || !this.publicClient || !this.cfg.contractAddress || !this.cfg.chainId || !this.cfg.rpcUrl) {
      throw new Error("wallet clients not configured for auto-offer mode");
    }

    console.log(
      `[agent-worker] delivering digest chainId=${this.cfg.chainId} rpc=${this.cfg.rpcUrl} contract=${this.cfg.contractAddress} jobId=${input.job.jobId} requestId=${input.job.requestId} token=${input.job.paymentToken} amountWei=${input.job.amountWei}`
    );

    const txHash = await this.walletClient.writeContract({
      address: this.cfg.contractAddress,
      abi: infoFiAbi,
      functionName: "deliverDigest",
      args: [input.job.jobId as Hex, input.digestHash as Hex, input.metadataURI, this.cfg.deliverProofType]
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`Deliver transaction failed: ${txHash}`);
    }

    const decoded = parseEventLogs({
      abi: infoFiAbi,
      eventName: "DigestDelivered",
      logs: receipt.logs,
      strict: false
    });
    const delivered = decoded.some(
      (event) =>
        String(event.args.jobId || "").toLowerCase() === input.job.jobId.toLowerCase() &&
        String(event.args.consultant || "").toLowerCase() === this.agentAddress.toLowerCase()
    );
    if (!delivered) {
      throw new Error(`Deliver tx ${txHash} missing DigestDelivered event for job ${input.job.jobId}`);
    }

    console.log(`[agent-worker] digest delivered txHash=${txHash} jobId=${input.job.jobId}`);
    return { txHash };
  }

  private pickCandidate(request: ApiRequest, domain: string): Candidate | null {
    return pickBestCandidate(
      {
        requestId: request.requestId,
        paymentToken: request.paymentToken,
        maxAmountWei: request.maxAmountWei
      },
      domain,
      this.capabilities
    );
  }

  private async postOffer(request: ApiRequest, candidate: Candidate): Promise<{ txHash: string; offerId: string | null }> {
    if (!this.walletClient || !this.publicClient || !this.cfg.contractAddress || !this.cfg.chainId || !this.cfg.rpcUrl) {
      throw new Error("wallet clients not configured for auto-offer mode");
    }

    const salt = keccak256(
      stringToHex(
        `${this.cfg.saltPrefix}:${request.requestId}:${Date.now()}:${Math.random().toString(16).slice(2)}`
      )
    );
    const proofType = candidate.capability.proofTypeDefault || this.cfg.defaultProofType;

    console.log(
      `[agent-worker] posting offer chainId=${this.cfg.chainId} rpc=${this.cfg.rpcUrl} contract=${this.cfg.contractAddress} requestId=${request.requestId} token=${request.paymentToken} amountWei=${candidate.offerAmountWei.toString()} etaSeconds=${candidate.capability.etaSeconds}`
    );

    const txHash = await this.walletClient.writeContract({
      address: this.cfg.contractAddress,
      abi: infoFiAbi,
      functionName: "postOffer",
      args: [request.requestId as Hex, candidate.offerAmountWei, BigInt(candidate.capability.etaSeconds), proofType, salt]
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction failed: ${txHash}`);
    }

    const decoded = parseEventLogs({
      abi: infoFiAbi,
      eventName: "OfferPosted",
      logs: receipt.logs,
      strict: false
    });
    const event = decoded.find(
      (log) =>
        String(log.args.requestId || "").toLowerCase() === request.requestId.toLowerCase() &&
        String(log.args.consultant || "").toLowerCase() === this.agentAddress.toLowerCase()
    );
    const offerId = event?.args.offerId ? String(event.args.offerId).toLowerCase() : null;
    console.log(`[agent-worker] offer posted txHash=${txHash} offerId=${offerId || "unknown"}`);
    return { txHash, offerId };
  }

  private async logDecision(input: {
    requestId: string;
    domain: string;
    decision: "SKIP" | "OFFERED" | "FAILED";
    confidence: number;
    reasonCode: string;
    reasonDetail: string | null;
    offerAmountWei?: string;
    etaSeconds?: number;
    offerId?: string | null;
    txHash?: string | null;
  }) {
    if (!this.cfg.decisionLogging) return;
    try {
      await this.apiPost("/agents/decisions", {
        agentAddress: this.agentAddress,
        requestId: input.requestId,
        domain: input.domain,
        decision: input.decision,
        confidence: Number(input.confidence.toFixed(6)),
        reasonCode: input.reasonCode,
        reasonDetail: input.reasonDetail,
        offerAmountWei: input.offerAmountWei ?? null,
        etaSeconds: input.etaSeconds ?? null,
        offerId: input.offerId ?? null,
        txHash: input.txHash ?? null
      });
    } catch (err) {
      console.warn(`[agent-worker] decision log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async apiGet<T>(
    path: string,
    options?: {
      trackFailure?: boolean;
    }
  ): Promise<T> {
    try {
      const response = await fetch(`${this.cfg.apiUrl}${path}`, { method: "GET", cache: "no-store" });
      const payload = await parseResponse(response);
      this.recordApiSuccess();
      return payload as T;
    } catch (err) {
      if (options?.trackFailure !== false) this.recordApiFailure(`GET ${path}`, err);
      throw err;
    }
  }

  private async apiPost<T = unknown>(
    path: string,
    body: unknown,
    options?: {
      trackFailure?: boolean;
    }
  ): Promise<T> {
    try {
      const response = await fetch(`${this.cfg.apiUrl}${path}`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await parseResponse(response);
      this.recordApiSuccess();
      return payload as T;
    } catch (err) {
      if (options?.trackFailure !== false) this.recordApiFailure(`POST ${path}`, err);
      throw err;
    }
  }
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const msg =
      payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return payload;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
