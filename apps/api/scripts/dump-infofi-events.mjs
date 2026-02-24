import { createPublicClient, http, parseAbiItem } from "viem";
import { writeFile } from "node:fs/promises";

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function must(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function asHexAddress(value) {
  const v = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) throw new Error(`Invalid address: ${value}`);
  return v;
}

function asBigInt(value, label) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!/^\d+$/.test(v)) throw new Error(`Invalid ${label}: ${value}`);
  return BigInt(v);
}

const rpcUrl = must(
  getArg("--rpc-url") || process.env.RPC_URL || process.env.ETH_RPC_URL,
  "Missing --rpc-url (or RPC_URL/ETH_RPC_URL env var)"
);
const contractAddress = asHexAddress(
  getArg("--contract") || process.env.CONTRACT_ADDRESS_OLD || "0x39072416c6844bafdf07c7bfb871fae871104614"
);
const fromBlockArg = asBigInt(getArg("--from-block"), "from-block");
const toBlockArg = asBigInt(getArg("--to-block"), "to-block");
const chunkSizeArg = asBigInt(getArg("--chunk-size"), "chunk-size");
const chunkSizeDefault = 49_000n;
const chunkSize = chunkSizeArg ?? chunkSizeDefault;
const outPath = getArg("--out") || `/tmp/infofi-${contractAddress.slice(2, 10)}-events.json`;

const client = createPublicClient({ transport: http(rpcUrl, { timeout: 60_000 }) });
const toBlock = toBlockArg ?? (await client.getBlockNumber());

const eventFilters = {
  RequestPosted: parseAbiItem(
    "event RequestPosted(bytes32 indexed requestId, address indexed requester, address indexed paymentToken, uint256 maxAmount, string sourceURI, string question)"
  ),
  OfferPosted: parseAbiItem(
    "event OfferPosted(bytes32 indexed offerId, bytes32 indexed requestId, address indexed consultant, uint256 amount, uint64 etaSeconds, string proofType)"
  ),
  OfferHired: parseAbiItem(
    "event OfferHired(bytes32 indexed jobId, bytes32 indexed requestId, bytes32 indexed offerId, address requester, address consultant, address token, uint256 amount)"
  ),
  DigestDelivered: parseAbiItem(
    "event DigestDelivered(bytes32 indexed jobId, address indexed consultant, bytes32 digestHash, string metadataURI, string proofTypeOrURI)"
  ),
  PaidOut: parseAbiItem("event PaidOut(bytes32 indexed jobId, address indexed token, address indexed recipient, uint256 amount)"),
  Refunded: parseAbiItem("event Refunded(bytes32 indexed jobId, address indexed token, address indexed funder, uint256 amount)"),
  Rated: parseAbiItem("event Rated(bytes32 indexed jobId, address indexed rater, address indexed rated, uint8 stars, string uri)"),
  // v0.2+ (optional)
  RequestMaxAmountUpdated: parseAbiItem(
    "event RequestMaxAmountUpdated(bytes32 indexed requestId, uint256 oldMaxAmount, uint256 newMaxAmount)"
  )
};

const fromBlock = fromBlockArg ?? 0n;

async function getLogsPagedForEvent(eventName) {
  const out = [];
  let cs = chunkSize;
  let start = fromBlock;
  const last = toBlock;
  while (start <= last) {
    const end = start + cs - 1n <= last ? start + cs - 1n : last;
    try {
      const logs = await client.getLogs({
        address: contractAddress,
        event: eventFilters[eventName],
        fromBlock: start,
        toBlock: end,
        strict: false
      });
      out.push(...logs);
      start = end + 1n;
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err ? String(err.message) : "";
      const lower = msg.toLowerCase();
      const shouldShrink =
        lower.includes("maximum block range") ||
        lower.includes("exceed maximum block range") ||
        lower.includes("timed out") ||
        lower.includes("timeout");
      if (shouldShrink) {
        if (cs <= 2_000n) throw err;
        cs = cs / 2n;
        continue;
      }
      throw err;
    }
  }
  return out;
}

const requestPostedLogs = await getLogsPagedForEvent("RequestPosted");
const offerPostedLogs = await getLogsPagedForEvent("OfferPosted");
const offerHiredLogs = await getLogsPagedForEvent("OfferHired");
const digestDeliveredLogs = await getLogsPagedForEvent("DigestDelivered");
const paidOutLogs = await getLogsPagedForEvent("PaidOut");
const refundedLogs = await getLogsPagedForEvent("Refunded");
const ratedLogs = await getLogsPagedForEvent("Rated");
const requestMaxUpdatedLogs = await getLogsPagedForEvent("RequestMaxAmountUpdated");

const requests = new Map();
const offers = new Map();
const jobs = new Map();

for (const log of requestPostedLogs) {
  const a = log.args;
  requests.set(a.requestId.toLowerCase(), {
    requestId: a.requestId,
    requester: a.requester,
    paymentToken: a.paymentToken,
    maxAmount: a.maxAmount.toString(),
    sourceURI: a.sourceURI,
    question: a.question,
    blockNumber: log.blockNumber?.toString?.() ?? null,
    txHash: log.transactionHash ?? null
  });
}

for (const log of offerPostedLogs) {
  const a = log.args;
  offers.set(a.offerId.toLowerCase(), {
    offerId: a.offerId,
    requestId: a.requestId,
    consultant: a.consultant,
    amount: a.amount.toString(),
    etaSeconds: a.etaSeconds.toString(),
    proofType: a.proofType,
    blockNumber: log.blockNumber?.toString?.() ?? null,
    txHash: log.transactionHash ?? null
  });
}

for (const log of offerHiredLogs) {
  const a = log.args;
  const jobId = a.jobId.toLowerCase();
  jobs.set(jobId, {
    jobId: a.jobId,
    requestId: a.requestId,
    offerId: a.offerId,
    requester: a.requester,
    consultant: a.consultant,
    token: a.token,
    amount: a.amount.toString(),
    delivered: null,
    payouts: [],
    refunds: [],
    ratings: [],
    blockNumber: log.blockNumber?.toString?.() ?? null,
    txHash: log.transactionHash ?? null
  });
}

for (const log of digestDeliveredLogs) {
  const a = log.args;
  const jobId = a.jobId.toLowerCase();
  const job =
    jobs.get(jobId) ||
    ({
      jobId: a.jobId,
      requestId: null,
      offerId: null,
      requester: null,
      consultant: a.consultant,
      token: null,
      amount: null,
      delivered: null,
      payouts: [],
      refunds: [],
      ratings: [],
      blockNumber: null,
      txHash: null
    });
  job.delivered = {
    consultant: a.consultant,
    digestHash: a.digestHash,
    metadataURI: a.metadataURI,
    proofTypeOrURI: a.proofTypeOrURI,
    blockNumber: log.blockNumber?.toString?.() ?? null,
    txHash: log.transactionHash ?? null
  };
  jobs.set(jobId, job);
}

for (const log of paidOutLogs) {
  const a = log.args;
  const jobId = a.jobId.toLowerCase();
  const job = jobs.get(jobId);
  if (!job) continue;
  job.payouts.push({
    token: a.token,
    recipient: a.recipient,
    amount: a.amount.toString(),
    blockNumber: log.blockNumber?.toString?.() ?? null,
    txHash: log.transactionHash ?? null
  });
}

for (const log of refundedLogs) {
  const a = log.args;
  const jobId = a.jobId.toLowerCase();
  const job = jobs.get(jobId);
  if (!job) continue;
  job.refunds.push({
    token: a.token,
    funder: a.funder,
    amount: a.amount.toString(),
    blockNumber: log.blockNumber?.toString?.() ?? null,
    txHash: log.transactionHash ?? null
  });
}

for (const log of ratedLogs) {
  const a = log.args;
  const jobId = a.jobId.toLowerCase();
  const job = jobs.get(jobId);
  if (!job) continue;
  job.ratings.push({
    rater: a.rater,
    rated: a.rated,
    stars: Number(a.stars),
    uri: a.uri,
    blockNumber: log.blockNumber?.toString?.() ?? null,
    txHash: log.transactionHash ?? null
  });
}

for (const log of requestMaxUpdatedLogs) {
  const a = log.args;
  const rid = a.requestId.toLowerCase();
  const req = requests.get(rid);
  if (!req) continue;
  req.maxAmount = a.newMaxAmount.toString();
}

const offersByRequest = new Map();
for (const offer of offers.values()) {
  const rid = String(offer.requestId).toLowerCase();
  const arr = offersByRequest.get(rid) || [];
  arr.push(offer);
  offersByRequest.set(rid, arr);
}

const jobByRequest = new Map();
for (const job of jobs.values()) {
  const rid = String(job.requestId || "").toLowerCase();
  if (!rid) continue;
  jobByRequest.set(rid, job);
}

const requestList = Array.from(requests.values()).map((req) => {
  const rid = String(req.requestId).toLowerCase();
  return {
    ...req,
    offers: offersByRequest.get(rid) || [],
    job: jobByRequest.get(rid) || null
  };
});

requestList.sort((a, b) => {
  const ab = BigInt(a.blockNumber || "0");
  const bb = BigInt(b.blockNumber || "0");
  return ab < bb ? -1 : ab > bb ? 1 : 0;
});

const exportPayload = {
  chainId: 11155111,
  rpcUrl,
  contractAddress,
  fromBlock: fromBlock.toString(),
  toBlock: toBlock.toString(),
  counts: {
    requests: requestList.length,
    offers: offers.size,
    jobs: jobs.size,
    deliveries: digestDeliveredLogs.length,
    payouts: paidOutLogs.length,
    refunds: refundedLogs.length,
    ratings: ratedLogs.length,
    maxAmountUpdates: requestMaxUpdatedLogs.length
  },
  requests: requestList
};

await writeFile(outPath, JSON.stringify(exportPayload, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      contract: contractAddress,
      blocks: `${fromBlock.toString()}..${toBlock.toString()}`,
      ...exportPayload.counts,
      out: outPath
    },
    null,
    2
  )
);
