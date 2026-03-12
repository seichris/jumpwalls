"use client";

import { bcs } from "@mysten/bcs";
import { keccak256 } from "viem";
import { getFastConfig, type FastConfig } from "./api";
import {
  connectFastSetWallet,
  normalizeFastHex,
  signWithFastSet,
  transferWithFastSet,
  type FastSetAccount,
  type FastSetTransferCertificate,
  type FastSetWalletApi,
} from "./fastset-transport";

const HISTORICAL_FAST_SETTLEMENT_TOKEN = "SETUSDC";

const AmountBcs = bcs.u256().transform({
  input: (val: string) => BigInt(`0x${normalizeFastHex(val)}`).toString(),
});

const ClaimTypeBcs = bcs.enum("ClaimType", {
  TokenTransfer: bcs.struct("TokenTransfer", {
    token_id: bcs.bytes(32),
    amount: AmountBcs,
    user_data: bcs.option(bcs.bytes(32)),
  }),
});

const TransactionBcs = bcs.struct("Transaction", {
  sender: bcs.bytes(32),
  recipient: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claim: ClaimTypeBcs,
  archival: bcs.bool(),
});

export type BrowserFastTokenInfo = {
  symbol: string;
  decimals: number;
  tokenId: string;
};

export type BrowserFastSignResult = {
  signature: string;
  address: string;
  messageBytes: string;
};

export type BrowserFastSendResult = {
  txHash: string;
  explorerUrl: string | null;
  certificate: unknown;
};

type BrowserFastTransaction = {
  sender: number[];
  recipient: number[];
  nonce: number;
  timestamp_nanos: number | bigint;
  claim: Record<string, unknown>;
  archival: boolean;
};

let fastConfigPromise: Promise<FastConfig> | null = null;

function normalizeExplorerBase(url: string | null | undefined) {
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

function hexToBytes(value: string) {
  const normalized = normalizeFastHex(value);
  const even = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
  const bytes = new Uint8Array(even.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(even.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function hashFastTransaction(transaction: BrowserFastTransaction) {
  const serialized = TransactionBcs.serialize(transaction as any).toBytes();
  return keccak256(serialized);
}

function extractTransaction(certificate: FastSetTransferCertificate) {
  const transaction = certificate?.envelope?.transaction as BrowserFastTransaction | undefined;
  if (!transaction) {
    throw new Error("Missing FAST transaction in extension certificate.");
  }
  return transaction;
}

export function resetBrowserFastProviderCache() {
  fastConfigPromise = null;
}

export class BrowserFastProvider {
  async getConfig() {
    if (!fastConfigPromise) {
      fastConfigPromise = getFastConfig();
    }
    return await fastConfigPromise;
  }

  normalizeTokenAlias(token?: string) {
    const trimmed = token?.trim();
    if (!trimmed) return "";
    const upper = trimmed.toUpperCase();
    if (upper === HISTORICAL_FAST_SETTLEMENT_TOKEN) return "fastUSDC";
    return trimmed;
  }

  async getSettlementToken(token?: string): Promise<BrowserFastTokenInfo> {
    const config = await this.getConfig();
    const normalized = this.normalizeTokenAlias(token);
    if (!normalized || normalized.toUpperCase() === config.tokenSymbol.toUpperCase()) {
      return {
        symbol: config.tokenSymbol,
        decimals: config.tokenDecimals,
        tokenId: config.tokenId,
      };
    }
    throw new Error(`Unsupported FAST browser token: ${token}`);
  }

  async getExplorerUrl(txHash?: string) {
    const config = await this.getConfig();
    const base = normalizeExplorerBase(config.explorerUrl);
    if (!base) return null;
    return txHash ? `${base}/txs/${txHash}` : base;
  }
}

export class BrowserFastWallet {
  private provider: BrowserFastProvider | null = null;
  private transport: FastSetWalletApi | null = null;
  private account: FastSetAccount | null = null;

  async connect(provider: BrowserFastProvider) {
    const connection = await connectFastSetWallet();
    this.provider = provider;
    this.transport = connection.wallet;
    this.account = connection.account;
    return this;
  }

  private requireConnection() {
    if (!this.transport || !this.account) {
      throw new Error("FAST browser wallet is not connected.");
    }
    return {
      wallet: this.transport,
      account: this.account,
    };
  }

  private requireProvider() {
    if (!this.provider) {
      throw new Error("FAST browser provider is not configured.");
    }
    return this.provider;
  }

  async exportKeys() {
    return this.requireConnection().account;
  }

  async sign(params: { message: string }) : Promise<BrowserFastSignResult> {
    const { wallet, account } = this.requireConnection();
    const signed = await signWithFastSet({
      wallet,
      account,
      message: params.message,
    });
    return {
      signature: signed.signature,
      address: account.address,
      messageBytes: signed.messageBytes,
    };
  }

  async send(params: { to: string; amount: string; token?: string }): Promise<BrowserFastSendResult> {
    const provider = this.requireProvider();
    const { wallet, account } = this.requireConnection();
    const token = await provider.getSettlementToken(params.token);
    const certificate = await transferWithFastSet({
      wallet,
      account,
      recipient: params.to,
      amount: params.amount,
      decimals: token.decimals,
      tokenId: token.tokenId,
    });
    const txHash = hashFastTransaction(extractTransaction(certificate));
    return {
      txHash,
      explorerUrl: await provider.getExplorerUrl(txHash),
      certificate,
    };
  }
}

export function extractBrowserFastCertificateTokenId(certificate: FastSetTransferCertificate) {
  const transaction = extractTransaction(certificate);
  const tokenId = ((transaction.claim as { TokenTransfer?: { token_id?: number[] } }).TokenTransfer?.token_id ?? []) as number[];
  return `0x${Array.from(tokenId, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function browserFastTokenIdBytes(tokenId: string) {
  return hexToBytes(tokenId);
}
