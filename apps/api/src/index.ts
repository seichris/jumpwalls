import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";
import { startIndexer } from "./indexer/indexer.js";
import { concatBytes, isAddress, keccak256, stringToHex, toBytes, type Address, type Hex } from "viem";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMsFromError(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as any;
  const status = typeof anyErr.status === "number" ? anyErr.status : null;
  if (status !== 429) return null;

  const details = typeof anyErr.details === "string" ? anyErr.details : "";
  const m = details.match(/retry after\s+(\d+)\s*m\s*(\d+)\s*s/i);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  const s = details.match(/retry after\s+(\d+)\s*s/i);
  if (s) return Number(s[1]) * 1000;

  return 300_000;
}

function rpcHosts(urls: string[]) {
  return urls.map((url) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  });
}

async function main() {
  const env = loadEnv();
  process.env.DATABASE_URL ||= env.DATABASE_URL;

  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0 && env.RPC_URLS.length === 0) {
    throw new Error("RPC not configured. Set RPC_URL (comma-separated ok) or RPC_URLS_BASE_MAINNET/RPC_URLS_ETHEREUM_MAINNET/RPC_URLS_ETHEREUM_SEPOLIA.");
  }

  const app = await buildServer();

  app.get("/infofi/id", async (req, reply) => {
    const q = req.query as {
      requester?: string;
      sourceURI?: string;
      question?: string;
      salt?: string;
      consultant?: string;
      amountWei?: string;
      etaSeconds?: string;
      offerId?: string;
    };
    const requester = typeof q.requester === "string" ? q.requester.trim() : "";
    const sourceURI = typeof q.sourceURI === "string" ? q.sourceURI.trim() : "";
    const question = typeof q.question === "string" ? q.question.trim() : "";
    const saltRaw = typeof q.salt === "string" ? q.salt.trim() : "";
    const consultant = typeof q.consultant === "string" ? q.consultant.trim() : "";
    const amountWeiRaw = typeof q.amountWei === "string" ? q.amountWei.trim() : "";
    const etaRaw = typeof q.etaSeconds === "string" ? q.etaSeconds.trim() : "";
    const offerIdRaw = typeof q.offerId === "string" ? q.offerId.trim() : "";

    if (!isAddress(requester as Address)) return reply.code(400).send({ error: "Invalid requester" });
    if (!sourceURI) return reply.code(400).send({ error: "Missing sourceURI" });
    if (!saltRaw) return reply.code(400).send({ error: "Missing salt" });

    const salt = /^0x[a-fA-F0-9]{64}$/.test(saltRaw) ? (saltRaw as Hex) : keccak256(stringToHex(saltRaw));
    const requestId = keccak256(
      concatBytes([
        toBytes(requester as Hex, { size: 20 }),
        toBytes(keccak256(stringToHex(sourceURI))),
        toBytes(keccak256(stringToHex(question))),
        toBytes(salt)
      ])
    );

    let offerId: Hex | null = null;
    if (consultant && amountWeiRaw && etaRaw) {
      if (!isAddress(consultant as Address)) return reply.code(400).send({ error: "Invalid consultant" });
      if (!/^\d+$/.test(amountWeiRaw)) return reply.code(400).send({ error: "Invalid amountWei" });
      if (!/^\d+$/.test(etaRaw)) return reply.code(400).send({ error: "Invalid etaSeconds" });
      offerId = keccak256(
        concatBytes([
          toBytes(requestId),
          toBytes(consultant as Hex, { size: 20 }),
          toBytes(BigInt(amountWeiRaw), { size: 32 }),
          toBytes(BigInt(etaRaw), { size: 8 }),
          toBytes(salt)
        ])
      );
    }

    const jobSource = /^0x[a-fA-F0-9]{64}$/.test(offerIdRaw) ? (offerIdRaw as Hex) : offerId;
    const jobId = jobSource ? keccak256(concatBytes([toBytes(jobSource), toBytes(requester as Hex, { size: 20 })])) : null;

    return reply.send({
      requester: requester.toLowerCase(),
      sourceURI,
      question,
      salt,
      requestId,
      offerId,
      jobId
    });
  });

  app.get("/contract", async (req, reply) => {
    void req;
    if (!env.CONTRACT_ADDRESS) return reply.code(400).send({ error: "CONTRACT_ADDRESS not configured" });
    return reply.send({
      contractKind: "infofi",
      chainId: env.CHAIN_ID,
      rpcUrl: env.RPC_URL,
      contractAddress: env.CONTRACT_ADDRESS,
      settlement: "requester-signed",
      tokenModes: ["ETH", "ERC20"]
    });
  });

  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0) {
    const indexerCfg = {
      rpcUrls: env.RPC_URLS,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS.toLowerCase() as Hex,
      backfillBlockChunk: env.INDEXER_BACKFILL_BLOCK_CHUNK,
      startBlock: env.INDEXER_START_BLOCK
    };

    void (async () => {
      let delayMs = 5_000;
      while (true) {
        try {
          await startIndexer(indexerCfg);
          app.log.info({ contract: env.CONTRACT_ADDRESS, chainId: env.CHAIN_ID, contractKind: "infofi" }, "indexer started");
          return;
        } catch (err: any) {
          const retryAfterMs = retryAfterMsFromError(err);
          if (retryAfterMs) delayMs = Math.max(delayMs, retryAfterMs);
          app.log.error(
            {
              err: err?.shortMessage ?? err?.message ?? String(err),
              errorDetails: err?.details,
              delayMs,
              rpcHosts: rpcHosts(env.RPC_URLS)
            },
            "indexer failed to start; retrying"
          );
          await sleep(delayMs);
          delayMs = Math.min(delayMs * 2, 60_000);
        }
      }
    })();
  } else {
    app.log.warn("CONTRACT_ADDRESS is empty; indexer disabled");
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
