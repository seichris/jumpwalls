import { infoFiJobId, infoFiOfferId, infoFiRequestId, usdcAddressForChainId } from "@gh-bounties/shared";
import { formatUnits, isAddress, keccak256, parseEther, parseUnits, stringToHex, type Address, type Hex } from "viem";
import { erc20Abi, infoFiAbi } from "./abi";
import { ensureWalletChain, getConfig, getPublicClient, getWalletClient } from "./wallet";

export const ETH_TOKEN = "0x0000000000000000000000000000000000000000";

export function chainIdFromEnv() {
  return Number(process.env.NEXT_PUBLIC_CHAIN_ID || "8453");
}

export function usdcForChain() {
  return usdcAddressForChainId(chainIdFromEnv());
}

export function isEthToken(token: string) {
  return token.toLowerCase() === ETH_TOKEN;
}

export function tokenDecimals(token: string) {
  const usdc = usdcForChain();
  if (isEthToken(token)) return 18;
  if (usdc && token.toLowerCase() === usdc.toLowerCase()) return 6;
  return 18;
}

export function tokenSymbol(token: string) {
  const usdc = usdcForChain();
  if (isEthToken(token)) return "ETH";
  if (usdc && token.toLowerCase() === usdc.toLowerCase()) return "USDC";
  return "TOKEN";
}

export function formatAmount(token: string, amountWei: string | bigint) {
  const value = typeof amountWei === "string" ? BigInt(amountWei || "0") : amountWei;
  return formatUnits(value, tokenDecimals(token));
}

export function parseAmount(token: string, amount: string) {
  if (!amount || Number(amount) <= 0) throw new Error("Invalid amount");
  if (isEthToken(token)) return parseEther(amount);
  return parseUnits(amount, tokenDecimals(token));
}

export function randomSalt() {
  return `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function saltToBytes32(salt: string): Hex {
  if (/^0x[a-fA-F0-9]{64}$/.test(salt)) return salt as Hex;
  return keccak256(stringToHex(salt));
}

export function deriveRequestId(input: {
  requester: Address;
  sourceURI: string;
  question: string;
  salt: string;
}): Hex {
  return infoFiRequestId(input.requester, input.sourceURI, input.question, input.salt);
}

export function deriveOfferId(input: {
  requestId: Hex;
  consultant: Address;
  amountWei: bigint;
  etaSeconds: number;
  salt: string;
}): Hex {
  return infoFiOfferId(input.requestId, input.consultant, input.amountWei, input.etaSeconds, input.salt);
}

export function deriveJobId(offerId: Hex, requester: Address): Hex {
  return infoFiJobId(offerId, requester);
}

function toNumber(value: bigint | number) {
  return typeof value === "bigint" ? Number(value) : value;
}

export type OnchainRequest = {
  requester: Address;
  paymentToken: Address;
  maxAmount: bigint;
  createdAt: bigint;
  status: number;
  hiredOfferId: Hex;
  sourceURI: string;
  question: string;
};

export type OnchainOffer = {
  requestId: Hex;
  consultant: Address;
  amount: bigint;
  etaSeconds: bigint;
  createdAt: bigint;
  status: number;
  proofType: string;
};

export type OnchainJob = {
  requestId: Hex;
  offerId: Hex;
  requester: Address;
  consultant: Address;
  paymentToken: Address;
  amount: bigint;
  remainingAmount: bigint;
  hiredAt: bigint;
  deliveredAt: bigint;
  digestHash: Hex;
  metadataURI: string;
  proofTypeOrURI: string;
};

export async function readRequestOnchain(requestId: Hex): Promise<OnchainRequest | null> {
  const { contractAddress } = getConfig();
  const publicClient = getPublicClient();
  const result = await publicClient.readContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "requests",
    args: [requestId],
  });
  const tuple = result as readonly [Address, Address, bigint, bigint, bigint | number, Hex, string, string];
  const createdAt = tuple[3];
  if (createdAt === 0n) return null;
  return {
    requester: tuple[0],
    paymentToken: tuple[1],
    maxAmount: tuple[2],
    createdAt,
    status: toNumber(tuple[4]),
    hiredOfferId: tuple[5],
    sourceURI: tuple[6],
    question: tuple[7],
  };
}

export async function readOfferOnchain(offerId: Hex): Promise<OnchainOffer | null> {
  const { contractAddress } = getConfig();
  const publicClient = getPublicClient();
  const result = await publicClient.readContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "offers",
    args: [offerId],
  });
  const tuple = result as readonly [Hex, Address, bigint, bigint, bigint, bigint | number, string];
  const createdAt = tuple[4];
  if (createdAt === 0n) return null;
  return {
    requestId: tuple[0],
    consultant: tuple[1],
    amount: tuple[2],
    etaSeconds: tuple[3],
    createdAt,
    status: toNumber(tuple[5]),
    proofType: tuple[6],
  };
}

export async function readJobOnchain(jobId: Hex): Promise<OnchainJob | null> {
  const { contractAddress } = getConfig();
  const publicClient = getPublicClient();
  const result = await publicClient.readContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "jobs",
    args: [jobId],
  });
  const tuple = result as readonly [Hex, Hex, Address, Address, Address, bigint, bigint, bigint, bigint, Hex, string, string];
  const hiredAt = tuple[7];
  if (hiredAt === 0n) return null;
  return {
    requestId: tuple[0],
    offerId: tuple[1],
    requester: tuple[2],
    consultant: tuple[3],
    paymentToken: tuple[4],
    amount: tuple[5],
    remainingAmount: tuple[6],
    hiredAt,
    deliveredAt: tuple[8],
    digestHash: tuple[9],
    metadataURI: tuple[10],
    proofTypeOrURI: tuple[11],
  };
}

export async function readPayoutNonceOnchain(jobId: Hex): Promise<bigint> {
  const { contractAddress } = getConfig();
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "payoutNonces",
    args: [jobId],
  });
}

export async function readRefundNonceOnchain(jobId: Hex): Promise<bigint> {
  const { contractAddress } = getConfig();
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "refundNonces",
    args: [jobId],
  });
}

async function activeAccount() {
  const wallet = getWalletClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect wallet first");
  return { wallet, account };
}

export async function postRequestTx(input: {
  sourceURI: string;
  question: string;
  paymentToken: Address;
  maxAmountWei: bigint;
  salt: string;
}) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "postRequest",
    args: [input.sourceURI, input.question, input.paymentToken, input.maxAmountWei, saltToBytes32(input.salt)],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export async function postOfferTx(input: {
  requestId: Hex;
  amountWei: bigint;
  etaSeconds: number;
  proofType: string;
  salt: string;
}) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "postOffer",
    args: [input.requestId, input.amountWei, BigInt(input.etaSeconds), input.proofType, saltToBytes32(input.salt)],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export async function updateRequestMaxAmountTx(input: { requestId: Hex; newMaxAmountWei: bigint }) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "updateRequestMaxAmount",
    args: [input.requestId, input.newMaxAmountWei],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export async function hireOfferEthTx(offerId: Hex, amountWei: bigint) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "hireOffer",
    args: [offerId],
    value: amountWei,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export async function hireOfferTokenTx(input: { offerId: Hex; token: Address; amountWei: bigint }) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();

  const approveHash = await wallet.writeContract({
    address: input.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [contractAddress, input.amountWei],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const hireHash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "hireOffer",
    args: [input.offerId],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: hireHash });

  return { approveHash, hireHash, account };
}

export async function deliverDigestTx(input: {
  jobId: Hex;
  digestHash: Hex;
  metadataURI: string;
  proofTypeOrURI: string;
}) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "deliverDigest",
    args: [input.jobId, input.digestHash, input.metadataURI, input.proofTypeOrURI],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export async function payoutByRequesterTx(input: { jobId: Hex; recipient: Address; amountWei: bigint }) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "payoutByRequester",
    args: [input.jobId, input.recipient, input.amountWei],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export async function refundByRequesterTx(input: { jobId: Hex; funder: Address; amountWei: bigint }) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "refundByRequester",
    args: [input.jobId, input.funder, input.amountWei],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export async function rateJobTx(input: { jobId: Hex; stars: number; uri: string }) {
  const { contractAddress, chain } = getConfig();
  await ensureWalletChain(chain.id);
  const publicClient = getPublicClient();
  const { wallet, account } = await activeAccount();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: infoFiAbi,
    functionName: "rateJob",
    args: [input.jobId, input.stars, input.uri],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, account };
}

export function assertSupportedToken(token: string) {
  const lower = token.toLowerCase();
  const usdc = usdcForChain();
  if (lower === ETH_TOKEN) return;
  if (usdc && lower === usdc.toLowerCase()) return;
  throw new Error("Unsupported token for v0 UI (ETH/USDC only)");
}

export function normalizeAddress(value: string) {
  if (!isAddress(value)) throw new Error("Invalid address");
  return value.toLowerCase() as Address;
}
