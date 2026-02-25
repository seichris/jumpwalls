import { NATIVE_TOKEN, usdcAddressForChainId } from "@infofi/shared";
import { createPublicClient, fallback, http, isAddress, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";

const NATIVE_TOKEN_LOWER = NATIVE_TOKEN.toLowerCase();
const ERC20_TRANSFER_ABI = [parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)")] as const;

function sanitizeRpcUrl(input: string) {
  let url = input.trim();
  if (!url) return "";
  url = url.replace(/^['"`]+/, "").replace(/['"`]+$/, "").trim();
  url = url.replace(/^(https?):\/(?!\/)/i, "$1://");
  return url;
}

function parseRpcUrls(value: string | undefined) {
  const raw = (value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => sanitizeRpcUrl(String(entry))).filter(Boolean);
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }
  return raw
    .split(",")
    .map((entry) => sanitizeRpcUrl(entry))
    .filter(Boolean);
}

function dedupeRpcUrls(urls: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of urls) {
    const normalized = sanitizeRpcUrl(candidate);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function rpcUrlsForChain(chainId: number) {
  const explicit = parseRpcUrls(process.env.RPC_URL);
  let chainSpecific: string[] = [];
  if (chainId === 1) {
    chainSpecific = parseRpcUrls(process.env.RPC_URLS_ETHEREUM_MAINNET);
    if (chainSpecific.length === 0) chainSpecific = parseRpcUrls(process.env.RPC_URL_ETHEREUM_MAINNET);
  } else if (chainId === 8453) {
    chainSpecific = parseRpcUrls(process.env.RPC_URLS_BASE_MAINNET);
    if (chainSpecific.length === 0) chainSpecific = parseRpcUrls(process.env.RPC_URL_BASE_MAINNET);
  } else if (chainId === 11155111) {
    chainSpecific = parseRpcUrls(process.env.RPC_URLS_ETHEREUM_SEPOLIA);
    if (chainSpecific.length === 0) chainSpecific = parseRpcUrls(process.env.RPC_URL_ETHEREUM_SEPOLIA);
  }
  return dedupeRpcUrls([...explicit, ...chainSpecific]);
}

const publicClientCache = new Map<string, ReturnType<typeof createPublicClient>>();

function publicClientForChain(chainId: number) {
  const urls = rpcUrlsForChain(chainId);
  if (urls.length === 0) return null;
  const key = `${chainId}:${urls.join(",")}`;
  if (publicClientCache.has(key)) return publicClientCache.get(key)!;
  const transport = urls.length > 1 ? fallback(urls.map((url) => http(url))) : http(urls[0]!);
  const client = createPublicClient({ transport });
  publicClientCache.set(key, client);
  return client;
}

type ParsedX402Citation = {
  index: number;
  url: string;
  chainId: number;
  token: string;
  normalizedToken: string | null;
  amountWei: string;
  payTo: string;
  txHash: string | null;
  purchasedAt: string | null;
};

type ReimbursementUnverified = {
  index: number;
  reason: string;
  citation: {
    type: "x402";
    url: string | null;
    chainId: number | null;
    token: string | null;
    amountWei: string | null;
    payTo: string | null;
    txHash: string | null;
  };
};

export type ReimbursementPreview = {
  jobId: string;
  chainId: number;
  paymentToken: string;
  remainingWei: string;
  reimbursementTotalWei: string;
  canAutoSettle: boolean;
  suggestedPayouts: Array<{
    recipient: string;
    amountWei: string;
    reason: "x402_reimbursement" | "consultant_labor";
  }>;
  verifiedCitations: Array<{
    index: number;
    url: string;
    chainId: number;
    token: string;
    normalizedToken: string | null;
    amountWei: string;
    payTo: string;
    txHash: string;
    purchasedAt: string | null;
    payer: string;
    payerSource: "transfer_log" | "native_transfer" | "consultant_fallback";
    verificationNote: string | null;
  }>;
  unverifiedCitations: ReimbursementUnverified[];
  totalsByPayer: Array<{ payer: string; amountWei: string }>;
  totalsByPayTo: Array<{ payTo: string; amountWei: string }>;
  notes: string[];
};

type ParsedCitationInput = {
  rawUrl: string | null;
  rawChainId: number | null;
  rawToken: string | null;
  rawAmountWei: string | null;
  rawPayTo: string | null;
  rawTxHash: string | null;
  parsed: ParsedX402Citation | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeToken(token: string, chainId: number): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (isAddress(trimmed as Address)) return trimmed.toLowerCase();
  const upper = trimmed.toUpperCase();
  if (upper === "ETH" || upper === "NATIVE") return NATIVE_TOKEN_LOWER;
  if (upper === "USDC") {
    const usdc = usdcAddressForChainId(chainId);
    return usdc ? usdc.toLowerCase() : null;
  }
  return null;
}

function parseX402Citation(index: number, raw: unknown): ParsedCitationInput {
  const obj = asObject(raw);
  if (!obj) {
    return {
      rawUrl: null,
      rawChainId: null,
      rawToken: null,
      rawAmountWei: null,
      rawPayTo: null,
      rawTxHash: null,
      parsed: null
    };
  }

  const rawUrl = typeof obj.url === "string" ? obj.url.trim() : "";
  const rawChainIdValue = obj.chainId;
  const rawToken = typeof obj.token === "string" ? obj.token.trim() : "";
  const rawAmountValue = obj.amount;
  const rawPayTo = typeof obj.payTo === "string" ? obj.payTo.trim() : "";
  const rawTxHash = typeof obj.txHash === "string" ? obj.txHash.trim() : "";
  const purchasedAtRaw = typeof obj.purchasedAt === "string" ? obj.purchasedAt.trim() : "";

  const chainId =
    typeof rawChainIdValue === "number" && Number.isInteger(rawChainIdValue) && rawChainIdValue > 0
      ? rawChainIdValue
      : typeof rawChainIdValue === "string" && /^\d+$/.test(rawChainIdValue)
        ? Number(rawChainIdValue)
        : null;

  let amountWei: string | null = null;
  if (typeof rawAmountValue === "string" && /^\d+$/.test(rawAmountValue)) {
    amountWei = rawAmountValue;
  } else if (typeof rawAmountValue === "number" && Number.isInteger(rawAmountValue) && rawAmountValue >= 0) {
    amountWei = String(rawAmountValue);
  }

  const txHash = /^0x[a-fA-F0-9]{64}$/.test(rawTxHash) ? rawTxHash.toLowerCase() : null;
  const normalizedPayTo = isAddress(rawPayTo as Address) ? rawPayTo.toLowerCase() : null;
  const normalizedToken = chainId && rawToken ? normalizeToken(rawToken, chainId) : null;

  if (!rawUrl || chainId === null || !rawToken || amountWei === null || !normalizedPayTo) {
    return {
      rawUrl: rawUrl || null,
      rawChainId: chainId,
      rawToken: rawToken || null,
      rawAmountWei: amountWei,
      rawPayTo: rawPayTo || null,
      rawTxHash: txHash,
      parsed: null
    };
  }

  const parsed: ParsedX402Citation = {
    index,
    url: rawUrl,
    chainId,
    token: rawToken,
    normalizedToken,
    amountWei,
    payTo: normalizedPayTo,
    txHash,
    purchasedAt: purchasedAtRaw || null
  };

  return {
    rawUrl: rawUrl || null,
    rawChainId: chainId,
    rawToken: rawToken || null,
    rawAmountWei: amountWei,
    rawPayTo: rawPayTo || null,
    rawTxHash: txHash,
    parsed
  };
}

function parseX402Citations(citationsJson: string | null) {
  const parsed: ParsedX402Citation[] = [];
  const unverified: ReimbursementUnverified[] = [];

  if (!citationsJson) return { parsed, unverified };

  let decoded: unknown = null;
  try {
    decoded = JSON.parse(citationsJson);
  } catch {
    unverified.push({
      index: -1,
      reason: "citationsJson is not valid JSON.",
      citation: { type: "x402", url: null, chainId: null, token: null, amountWei: null, payTo: null, txHash: null }
    });
    return { parsed, unverified };
  }

  if (decoded === null) return { parsed, unverified };

  if (!Array.isArray(decoded)) {
    unverified.push({
      index: -1,
      reason: "citationsJson must be an array to compute x402 reimbursements.",
      citation: { type: "x402", url: null, chainId: null, token: null, amountWei: null, payTo: null, txHash: null }
    });
    return { parsed, unverified };
  }

  decoded.forEach((entry, index) => {
    const obj = asObject(entry);
    if (!obj) return;
    if (String(obj.type || "").toLowerCase() !== "x402") return;

    const parsedInput = parseX402Citation(index, obj);
    if (!parsedInput.parsed) {
      unverified.push({
        index,
        reason: "Invalid x402 citation shape. Required: url, chainId, token, amount, payTo.",
        citation: {
          type: "x402",
          url: parsedInput.rawUrl,
          chainId: parsedInput.rawChainId,
          token: parsedInput.rawToken,
          amountWei: parsedInput.rawAmountWei,
          payTo: parsedInput.rawPayTo,
          txHash: parsedInput.rawTxHash
        }
      });
      return;
    }

    parsed.push(parsedInput.parsed);
  });

  return { parsed, unverified };
}

type VerificationSuccess = {
  ok: true;
  payer: string | null;
  payerSource: "transfer_log" | "native_transfer";
  note: string | null;
};

type VerificationFailure = {
  ok: false;
  reason: string;
};

async function verifyNativeTransfer(input: {
  client: ReturnType<typeof createPublicClient>;
  txHash: Hex;
  payTo: string;
  amountWei: bigint;
}): Promise<VerificationSuccess | VerificationFailure> {
  const [receipt, tx] = await Promise.all([
    input.client.getTransactionReceipt({ hash: input.txHash }),
    input.client.getTransaction({ hash: input.txHash })
  ]);
  if (receipt.status !== "success") {
    return { ok: false, reason: "Native payment tx reverted." };
  }
  if (!tx.to || tx.to.toLowerCase() !== input.payTo.toLowerCase()) {
    return { ok: false, reason: "Native payment tx recipient does not match payTo." };
  }
  if (tx.value < input.amountWei) {
    return {
      ok: false,
      reason: `Native payment value is below citation amount (${tx.value.toString()} < ${input.amountWei.toString()}).`
    };
  }
  return { ok: true, payer: tx.from.toLowerCase(), payerSource: "native_transfer", note: null };
}

async function verifyErc20Transfer(input: {
  client: ReturnType<typeof createPublicClient>;
  txHash: Hex;
  token: string;
  payTo: string;
  amountWei: bigint;
}): Promise<VerificationSuccess | VerificationFailure> {
  const receipt = await input.client.getTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== "success") {
    return { ok: false, reason: "Token payment tx reverted." };
  }

  const tokenLower = input.token.toLowerCase();
  const payToLower = input.payTo.toLowerCase();
  const tokenLogs = receipt.logs.filter((log) => log.address.toLowerCase() === tokenLower);
  if (tokenLogs.length === 0) {
    return { ok: false, reason: "No token logs found at citation token address in tx receipt." };
  }

  const transferLogs = parseEventLogs({
    abi: ERC20_TRANSFER_ABI,
    eventName: "Transfer",
    logs: tokenLogs,
    strict: false
  });

  let matchedToPayTo = 0n;
  const payerTotals = new Map<string, bigint>();
  for (const log of transferLogs) {
    const to = typeof log.args.to === "string" ? log.args.to.toLowerCase() : "";
    const from = typeof log.args.from === "string" ? log.args.from.toLowerCase() : "";
    const value = typeof log.args.value === "bigint" ? log.args.value : 0n;
    if (!to || !from || value <= 0n) continue;
    if (to !== payToLower) continue;
    matchedToPayTo += value;
    payerTotals.set(from, (payerTotals.get(from) ?? 0n) + value);
  }

  if (matchedToPayTo < input.amountWei) {
    return {
      ok: false,
      reason: `Transfer logs to payTo are below citation amount (${matchedToPayTo.toString()} < ${input.amountWei.toString()}).`
    };
  }

  if (payerTotals.size === 0) {
    return { ok: true, payer: null, payerSource: "transfer_log", note: "Verified transfer to payTo, but payer could not be derived." };
  }

  if (payerTotals.size === 1) {
    const payer = payerTotals.keys().next().value ?? null;
    return { ok: true, payer, payerSource: "transfer_log", note: null };
  }

  let bestPayer: string | null = null;
  let bestAmount = 0n;
  for (const [payer, amount] of payerTotals.entries()) {
    if (amount > bestAmount) {
      bestAmount = amount;
      bestPayer = payer;
    }
  }
  return {
    ok: true,
    payer: bestPayer,
    payerSource: "transfer_log",
    note: "Multiple payer transfers to payTo were found; reimbursement payer uses the largest contributor."
  };
}

function mapToSortedArray(map: Map<string, bigint>, keyName: "payer"): Array<{ payer: string; amountWei: string }>;
function mapToSortedArray(map: Map<string, bigint>, keyName: "payTo"): Array<{ payTo: string; amountWei: string }>;
function mapToSortedArray(map: Map<string, bigint>, keyName: "payer" | "payTo") {
  const rows = Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (keyName === "payer") {
    return rows.map(([payer, amountWei]) => ({ payer, amountWei: amountWei.toString() }));
  }
  return rows.map(([payTo, amountWei]) => ({ payTo, amountWei: amountWei.toString() }));
}

function toSafeBigInt(value: string, fallback: bigint = 0n) {
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function addAmountByAddress(map: Map<string, bigint>, address: string, amountWei: bigint) {
  map.set(address, (map.get(address) ?? 0n) + amountWei);
}

function mergePayoutLine(
  payouts: Array<{ recipient: string; amountWei: string; reason: "x402_reimbursement" | "consultant_labor" }>,
  recipient: string,
  amountWei: bigint,
  reason: "x402_reimbursement" | "consultant_labor"
) {
  if (amountWei <= 0n) return;
  const existing = payouts.find((entry) => entry.recipient === recipient && entry.reason === reason);
  if (!existing) {
    payouts.push({ recipient, amountWei: amountWei.toString(), reason });
    return;
  }
  existing.amountWei = (toSafeBigInt(existing.amountWei, 0n) + amountWei).toString();
}

export async function buildReimbursementPreview(input: {
  jobId: string;
  chainId: number;
  paymentToken: string;
  consultant: string;
  remainingWei: string;
  citationsJson: string | null;
}): Promise<ReimbursementPreview> {
  const paymentToken = input.paymentToken.toLowerCase();
  const consultant = input.consultant.toLowerCase();
  const remainingWei = toSafeBigInt(input.remainingWei, 0n);

  const { parsed, unverified } = parseX402Citations(input.citationsJson);
  const verified: ReimbursementPreview["verifiedCitations"] = [];
  const unverifiedCitations: ReimbursementPreview["unverifiedCitations"] = [...unverified];

  const client = publicClientForChain(input.chainId);
  const reimbursementsByPayer = new Map<string, bigint>();
  const totalsByPayTo = new Map<string, bigint>();
  let reimbursementTotal = 0n;

  for (const citation of parsed) {
    const citationSummary = {
      type: "x402" as const,
      url: citation.url,
      chainId: citation.chainId,
      token: citation.token,
      amountWei: citation.amountWei,
      payTo: citation.payTo,
      txHash: citation.txHash
    };

    if (!citation.txHash) {
      unverifiedCitations.push({
        index: citation.index,
        reason: "Missing txHash; x402 citation is not eligible for automatic reimbursement.",
        citation: citationSummary
      });
      continue;
    }

    if (citation.chainId !== input.chainId) {
      unverifiedCitations.push({
        index: citation.index,
        reason: `Citation chainId ${citation.chainId} does not match job chainId ${input.chainId}.`,
        citation: citationSummary
      });
      continue;
    }

    if (!citation.normalizedToken) {
      unverifiedCitations.push({
        index: citation.index,
        reason: "Citation token is not a supported on-chain address/symbol for verification.",
        citation: citationSummary
      });
      continue;
    }

    if (citation.normalizedToken !== paymentToken) {
      unverifiedCitations.push({
        index: citation.index,
        reason: `Citation token ${citation.normalizedToken} does not match job payment token ${paymentToken}.`,
        citation: citationSummary
      });
      continue;
    }

    const amountWei = toSafeBigInt(citation.amountWei, -1n);
    if (amountWei <= 0n) {
      unverifiedCitations.push({
        index: citation.index,
        reason: "Citation amount must be a positive integer amount in atomic units.",
        citation: citationSummary
      });
      continue;
    }

    if (!client) {
      unverifiedCitations.push({
        index: citation.index,
        reason: `RPC URL is not configured for chain ${input.chainId}.`,
        citation: citationSummary
      });
      continue;
    }

    let verification: VerificationSuccess | VerificationFailure;
    try {
      if (citation.normalizedToken === NATIVE_TOKEN_LOWER) {
        verification = await verifyNativeTransfer({
          client,
          txHash: citation.txHash as Hex,
          payTo: citation.payTo,
          amountWei
        });
      } else {
        verification = await verifyErc20Transfer({
          client,
          txHash: citation.txHash as Hex,
          token: citation.normalizedToken,
          payTo: citation.payTo,
          amountWei
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      unverifiedCitations.push({
        index: citation.index,
        reason: `RPC verification failed: ${message}`,
        citation: citationSummary
      });
      continue;
    }

    if (!verification.ok) {
      unverifiedCitations.push({
        index: citation.index,
        reason: verification.reason,
        citation: citationSummary
      });
      continue;
    }

    const payer = verification.payer ?? consultant;
    const payerSource: "transfer_log" | "native_transfer" | "consultant_fallback" = verification.payer
      ? verification.payerSource
      : "consultant_fallback";

    verified.push({
      index: citation.index,
      url: citation.url,
      chainId: citation.chainId,
      token: citation.token,
      normalizedToken: citation.normalizedToken,
      amountWei: citation.amountWei,
      payTo: citation.payTo,
      txHash: citation.txHash,
      purchasedAt: citation.purchasedAt,
      payer,
      payerSource,
      verificationNote: verification.note
    });

    addAmountByAddress(reimbursementsByPayer, payer, amountWei);
    addAmountByAddress(totalsByPayTo, citation.payTo, amountWei);
    reimbursementTotal += amountWei;
  }

  const canAutoSettle = reimbursementTotal <= remainingWei;
  const notes: string[] = [];
  const suggestedPayouts: ReimbursementPreview["suggestedPayouts"] = [];

  if (!canAutoSettle) {
    notes.push(
      `Verified reimbursement total ${reimbursementTotal.toString()} exceeds remaining escrow ${remainingWei.toString()}.`
    );
  } else {
    for (const [payer, amountWei] of reimbursementsByPayer.entries()) {
      mergePayoutLine(suggestedPayouts, payer, amountWei, "x402_reimbursement");
    }
    const consultantLabor = remainingWei - reimbursementTotal;
    if (consultantLabor > 0n) {
      mergePayoutLine(suggestedPayouts, consultant, consultantLabor, "consultant_labor");
    }
  }

  return {
    jobId: input.jobId,
    chainId: input.chainId,
    paymentToken,
    remainingWei: remainingWei.toString(),
    reimbursementTotalWei: reimbursementTotal.toString(),
    canAutoSettle,
    suggestedPayouts,
    verifiedCitations: verified.sort((a, b) => a.index - b.index),
    unverifiedCitations: unverifiedCitations.sort((a, b) => a.index - b.index),
    totalsByPayer: mapToSortedArray(reimbursementsByPayer, "payer"),
    totalsByPayTo: mapToSortedArray(totalsByPayTo, "payTo"),
    notes
  };
}
