import { getPrisma } from "../db.js";
import { infoFiAbi } from "./abi.js";
import { createPublicClient, fallback, http, isAddress, type Hex } from "viem";

type IndexerConfig = {
  rpcUrls: string[];
  chainId: number;
  contractAddress: Hex;
  backfillBlockChunk?: number;
  startBlock?: number;
};

export async function startIndexer(cfg: IndexerConfig) {
  const prisma = getPrisma();
  if (!isAddress(cfg.contractAddress)) throw new Error("Invalid CONTRACT_ADDRESS");
  if (!cfg.rpcUrls || cfg.rpcUrls.length === 0) throw new Error("RPC URL(s) not configured");

  const contractAddress = cfg.contractAddress.toLowerCase() as Hex;
  const transport = cfg.rpcUrls.length > 1 ? fallback(cfg.rpcUrls.map((url) => http(url))) : http(cfg.rpcUrls[0]!);
  const client = createPublicClient({ transport });

  const actualChainId = await client.getChainId();
  if (actualChainId !== cfg.chainId) {
    throw new Error(`Indexer chainId mismatch: env CHAIN_ID=${cfg.chainId} but RPC reports chainId=${actualChainId}`);
  }
  const code = await client.getBytecode({ address: contractAddress });
  if (!code || code === "0x") {
    throw new Error(`Indexer contract not found: no code at ${contractAddress} on chainId=${cfg.chainId}`);
  }

  const head = await client.getBlockNumber();
  const state = await prisma.indexerState.findUnique({
    where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress } }
  });
  const defaultFrom = BigInt(Math.max(0, Number(head) - 2000));
  const startFrom = typeof cfg.startBlock === "number" && Number.isFinite(cfg.startBlock) ? BigInt(cfg.startBlock) : null;
  let fromBlock = BigInt(state?.lastBlock ?? (startFrom ?? defaultFrom));
  if (fromBlock > head) fromBlock = head;

  await backfill(client, { ...cfg, contractAddress }, fromBlock, head);

  client.watchContractEvent({
    abi: infoFiAbi,
    address: contractAddress,
    onLogs: async (logs) => {
      for (const log of logs) await handleLog(cfg, log);
    }
  });

  let pollInFlight = false;
  setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const headNow = await client.getBlockNumber();
      const st = await prisma.indexerState.findUnique({
        where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress } }
      });
      const last = BigInt(st?.lastBlock ?? 0);
      const from = last > 0n ? last + 1n : headNow;
      if (from <= headNow) {
        await backfill(client, { ...cfg, contractAddress }, from, headNow);
      }
    } catch {
      // Best-effort poll safety net.
    } finally {
      pollInFlight = false;
    }
  }, 30_000);
}

async function backfill(
  client: ReturnType<typeof createPublicClient>,
  cfg: IndexerConfig,
  fromBlock: bigint,
  toBlock: bigint
) {
  const prisma = getPrisma();
  if (fromBlock > toBlock) return;
  const chunkSize = BigInt(Math.max(1, cfg.backfillBlockChunk ?? 10));

  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const chunkEnd = cursor + chunkSize - 1n > toBlock ? toBlock : cursor + chunkSize - 1n;
    const logs = await client.getContractEvents({
      abi: infoFiAbi,
      address: cfg.contractAddress,
      fromBlock: cursor,
      toBlock: chunkEnd
    });

    for (const log of logs) await handleLog(cfg, log);

    await prisma.indexerState.upsert({
      where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress: cfg.contractAddress } },
      create: { chainId: cfg.chainId, contractAddress: cfg.contractAddress, lastBlock: Number(chunkEnd) },
      update: { lastBlock: Number(chunkEnd) }
    });

    cursor = chunkEnd + 1n;
  }
}

function subClamped(base: string, delta: string) {
  const b = BigInt(base);
  const d = BigInt(delta);
  if (d >= b) return "0";
  return (b - d).toString();
}

async function handleLog(cfg: IndexerConfig, log: any) {
  const prisma = getPrisma();
  const blockNumber = Number(log.blockNumber ?? 0n);
  const txHash = (log.transactionHash as string).toLowerCase();
  const logIndex = Number(log.logIndex ?? 0n);

  switch (log.eventName as string) {
    case "RequestPosted": {
      const requestId = (log.args.requestId as string).toLowerCase();
      const requester = (log.args.requester as string).toLowerCase();
      const paymentToken = (log.args.paymentToken as string).toLowerCase();
      const maxAmountWei = (log.args.maxAmount as bigint).toString();
      const sourceURI = (log.args.sourceURI as string) || "";
      const question = (log.args.question as string) || "";
      await prisma.infoFiRequest.upsert({
        where: { requestId },
        create: {
          requestId,
          requester,
          paymentToken,
          maxAmountWei,
          sourceURI,
          question,
          status: "OPEN",
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        },
        update: {
          requester,
          paymentToken,
          maxAmountWei,
          sourceURI,
          question,
          status: "OPEN",
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        }
      });
      break;
    }
    case "OfferPosted": {
      const offerId = (log.args.offerId as string).toLowerCase();
      const requestId = (log.args.requestId as string).toLowerCase();
      const consultant = (log.args.consultant as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();
      const etaSeconds = Number(log.args.etaSeconds as bigint);
      const proofType = (log.args.proofType as string) || "";
      await prisma.infoFiOffer.upsert({
        where: { offerId },
        create: {
          offerId,
          requestId,
          consultant,
          amountWei,
          etaSeconds,
          proofType,
          status: "OPEN",
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        },
        update: {
          requestId,
          consultant,
          amountWei,
          etaSeconds,
          proofType,
          status: "OPEN",
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        }
      });
      break;
    }
    case "OfferHired": {
      const jobId = (log.args.jobId as string).toLowerCase();
      const requestId = (log.args.requestId as string).toLowerCase();
      const offerId = (log.args.offerId as string).toLowerCase();
      const requester = (log.args.requester as string).toLowerCase();
      const consultant = (log.args.consultant as string).toLowerCase();
      const paymentToken = (log.args.token as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();
      await prisma.infoFiJob.upsert({
        where: { jobId },
        create: {
          jobId,
          requestId,
          offerId,
          requester,
          consultant,
          paymentToken,
          amountWei,
          remainingWei: amountWei,
          hiredAt: new Date(),
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        },
        update: {
          requestId,
          offerId,
          requester,
          consultant,
          paymentToken,
          amountWei,
          chainId: cfg.chainId,
          contractAddress: cfg.contractAddress
        }
      });

      await prisma.infoFiRequest.updateMany({
        where: { requestId },
        data: { status: "HIRED", hiredOfferId: offerId }
      });
      await prisma.infoFiOffer.updateMany({
        where: { offerId },
        data: { status: "HIRED" }
      });
      break;
    }
    case "RequestMaxAmountUpdated": {
      const requestId = (log.args.requestId as string).toLowerCase();
      const newMaxAmountWei = (log.args.newMaxAmount as bigint).toString();
      await prisma.infoFiRequest.updateMany({
        where: { requestId },
        data: { maxAmountWei: newMaxAmountWei }
      });
      break;
    }
    case "DigestDelivered": {
      const jobId = (log.args.jobId as string).toLowerCase();
      const digestHash = (log.args.digestHash as string).toLowerCase();
      const metadataURI = (log.args.metadataURI as string) || "";
      const proofTypeOrURI = (log.args.proofTypeOrURI as string) || "";
      await prisma.infoFiJob.updateMany({
        where: { jobId },
        data: {
          deliveredAt: new Date(),
          digestHash,
          metadataURI,
          proofTypeOrURI
        }
      });
      break;
    }
    case "PaidOut": {
      const jobId = (log.args.jobId as string).toLowerCase();
      const token = (log.args.token as string).toLowerCase();
      const recipient = (log.args.recipient as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();
      const existing = await prisma.infoFiPayout.findUnique({
        where: { txHash_logIndex: { txHash, logIndex } }
      });
      await prisma.infoFiPayout.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: { jobId, token, recipient, amountWei, txHash, logIndex, blockNumber },
        update: { jobId, token, recipient, amountWei, blockNumber }
      });
      if (!existing) {
        const job = await prisma.infoFiJob.findUnique({ where: { jobId } });
        if (job) {
          const remainingWei = subClamped(job.remainingWei, amountWei);
          await prisma.infoFiJob.update({ where: { jobId }, data: { remainingWei } });
          if (remainingWei === "0") {
            await prisma.infoFiRequest.updateMany({ where: { requestId: job.requestId }, data: { status: "CLOSED" } });
          }
        }
      }
      break;
    }
    case "Refunded": {
      const jobId = (log.args.jobId as string).toLowerCase();
      const token = (log.args.token as string).toLowerCase();
      const funder = (log.args.funder as string).toLowerCase();
      const amountWei = (log.args.amount as bigint).toString();
      const existing = await prisma.infoFiRefund.findUnique({
        where: { txHash_logIndex: { txHash, logIndex } }
      });
      await prisma.infoFiRefund.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: { jobId, token, funder, amountWei, txHash, logIndex, blockNumber },
        update: { jobId, token, funder, amountWei, blockNumber }
      });
      if (!existing) {
        const job = await prisma.infoFiJob.findUnique({ where: { jobId } });
        if (job) {
          const remainingWei = subClamped(job.remainingWei, amountWei);
          await prisma.infoFiJob.update({ where: { jobId }, data: { remainingWei } });
          if (remainingWei === "0") {
            await prisma.infoFiRequest.updateMany({ where: { requestId: job.requestId }, data: { status: "CLOSED" } });
          }
        }
      }
      break;
    }
    case "Rated": {
      const jobId = (log.args.jobId as string).toLowerCase();
      const rater = (log.args.rater as string).toLowerCase();
      const rated = (log.args.rated as string).toLowerCase();
      const stars = Number(log.args.stars as bigint);
      const uri = (log.args.uri as string) || "";
      await prisma.infoFiRating.upsert({
        where: { txHash_logIndex: { txHash, logIndex } },
        create: { jobId, rater, rated, stars, uri, txHash, logIndex, blockNumber },
        update: { jobId, rater, rated, stars, uri, blockNumber }
      });
      break;
    }
    default:
      break;
  }

  await prisma.indexerState.upsert({
    where: { chainId_contractAddress: { chainId: cfg.chainId, contractAddress: cfg.contractAddress } },
    create: { chainId: cfg.chainId, contractAddress: cfg.contractAddress, lastBlock: blockNumber },
    update: { lastBlock: blockNumber }
  });
}
