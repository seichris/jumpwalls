import Fastify from "fastify";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import crypto from "node:crypto";
import { keccak256, stringToHex } from "viem";
import { getPrisma } from "./db.js";
import { combineFairUseWithLlm, parseFairUseEnforcementMode, reviewDigestFairUse } from "./fairUse.js";
import { reviewDigestFairUseWithGemini } from "./fairUseGemini.js";
import { buildReimbursementPreview } from "./x402.js";

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
