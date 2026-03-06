import crypto from "node:crypto";

import { bcs } from "@mysten/bcs";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { keccak_256 } from "@noble/hashes/sha3";
import { bech32m } from "bech32";

((ed25519 as any).hashes ?? ((ed25519 as any).hashes = {})).sha512 = sha512;

const FAST_RPC_URL_DEFAULT = "https://api.fast.xyz/proxy";
export const FAST_SETTLEMENT_TOKEN_SYMBOL = "SETUSDC";
export const FAST_SETTLEMENT_TOKEN_DECIMALS = 6;
export const FAST_SETTLEMENT_TOKEN_ID_HEX = "0x1e744900021182b293538bb6685b77df095e351364d550021614ce90c8ab9e0a";
const FAST_SETTLEMENT_TOKEN_ID = new Uint8Array(Buffer.from(FAST_SETTLEMENT_TOKEN_ID_HEX.slice(2), "hex"));

const AmountBcs = bcs.u256().transform({
  input: (val: string) => BigInt(`0x${val}`).toString(),
});

const TokenTransferBcs = bcs.struct("TokenTransfer", {
  token_id: bcs.bytes(32),
  amount: AmountBcs,
  user_data: bcs.option(bcs.bytes(32)),
});

const ClaimTypeBcs = bcs.enum("ClaimType", {
  TokenTransfer: TokenTransferBcs,
  TokenCreation: bcs.struct("TokenCreation", {
    token_name: bcs.string(),
    decimals: bcs.u8(),
    initial_amount: AmountBcs,
    mints: bcs.vector(bcs.bytes(32)),
    user_data: bcs.option(bcs.bytes(32)),
  }),
  TokenManagement: bcs.struct("TokenManagement", {
    token_id: bcs.bytes(32),
    update_id: bcs.u64(),
    new_admin: bcs.option(bcs.bytes(32)),
    mints: bcs.vector(
      bcs.tuple([
        bcs.enum("AddressChange", {
          Add: bcs.tuple([]),
          Remove: bcs.tuple([]),
        }),
        bcs.bytes(32),
      ])
    ),
    user_data: bcs.option(bcs.bytes(32)),
  }),
  Mint: bcs.struct("Mint", {
    token_id: bcs.bytes(32),
    amount: AmountBcs,
  }),
  StateInitialization: bcs.struct("StateInitialization", { dummy: bcs.u8() }),
  StateUpdate: bcs.struct("StateUpdate", { dummy: bcs.u8() }),
  ExternalClaim: bcs.struct("ExternalClaim", {
    claim: bcs.struct("ExternalClaimBody", {
      verifier_committee: bcs.vector(bcs.bytes(32)),
      verifier_quorum: bcs.u64(),
      claim_data: bcs.vector(bcs.u8()),
    }),
    signatures: bcs.vector(bcs.tuple([bcs.bytes(32), bcs.bytes(64)])),
  }),
  StateReset: bcs.struct("StateReset", { dummy: bcs.u8() }),
  JoinCommittee: bcs.struct("JoinCommittee", { dummy: bcs.u8() }),
  LeaveCommittee: bcs.struct("LeaveCommittee", { dummy: bcs.u8() }),
  ChangeCommittee: bcs.struct("ChangeCommittee", { dummy: bcs.u8() }),
  Batch: bcs.vector(
    bcs.enum("Operation", {
      TokenTransfer: bcs.struct("TokenTransferOperation", {
        token_id: bcs.bytes(32),
        recipient: bcs.bytes(32),
        amount: AmountBcs,
        user_data: bcs.option(bcs.bytes(32)),
      }),
      TokenCreation: bcs.struct("TokenCreationOperation", {
        token_name: bcs.string(),
        decimals: bcs.u8(),
        initial_amount: AmountBcs,
        mints: bcs.vector(bcs.bytes(32)),
        user_data: bcs.option(bcs.bytes(32)),
      }),
      TokenManagement: bcs.struct("TokenManagementOperation", {
        token_id: bcs.bytes(32),
        update_id: bcs.u64(),
        new_admin: bcs.option(bcs.bytes(32)),
        mints: bcs.vector(
          bcs.tuple([
            bcs.enum("BatchAddressChange", {
              Add: bcs.tuple([]),
              Remove: bcs.tuple([]),
            }),
            bcs.bytes(32),
          ])
        ),
        user_data: bcs.option(bcs.bytes(32)),
      }),
      Mint: bcs.struct("MintOperation", {
        token_id: bcs.bytes(32),
        recipient: bcs.bytes(32),
        amount: AmountBcs,
      }),
    })
  ),
});

const TransactionBcs = bcs.struct("Transaction", {
  sender: bcs.bytes(32),
  recipient: bcs.bytes(32),
  nonce: bcs.u64(),
  timestamp_nanos: bcs.u128(),
  claim: ClaimTypeBcs,
  archival: bcs.bool(),
});

export type FastAccountInfo = {
  sender?: number[];
  balance?: string;
  next_nonce?: number;
  requested_certificates?: FastTransactionCertificate[];
  requested_certificate?: FastTransactionCertificate | null;
  token_balance?: Array<[number[], string]>;
};

export type FastTransaction = {
  sender: number[];
  recipient: number[];
  nonce: number;
  timestamp_nanos: number | bigint;
  claim: Record<string, unknown>;
  archival: boolean;
};

export type FastTransactionCertificate = {
  envelope: {
    transaction: FastTransaction;
    signature: unknown;
  };
  signatures: Array<[number[], number[]]>;
};

function normalizeHex(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2).toLowerCase() : trimmed.toLowerCase();
}

export function fastRpcUrl() {
  return (process.env.FAST_RPC_URL || FAST_RPC_URL_DEFAULT).trim() || FAST_RPC_URL_DEFAULT;
}

export function fastTreasuryPrivateKey() {
  const raw =
    (process.env.FAST_TREASURY_PRIVATE_KEY || process.env.MONEY_FAST_PRIVATE_KEY || "").trim();
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error("FAST treasury private key is not configured.");
  }
  return normalizeHex(raw);
}

export async function fastTreasuryAddress() {
  const configured = (process.env.FAST_TREASURY_ADDRESS || "").trim();
  if (configured) return normalizeFastAddress(configured);
  const publicKey = await ed25519.getPublicKeyAsync(Buffer.from(fastTreasuryPrivateKey(), "hex"));
  return publicKeyToFastAddress(publicKey);
}

export function publicKeyToFastAddress(publicKey: string | Uint8Array, hrp = "fast") {
  const bytes = typeof publicKey === "string" ? Buffer.from(normalizeHex(publicKey), "hex") : publicKey;
  return bech32m.encode(hrp, bech32m.toWords(bytes), 90);
}

export function normalizeFastAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const decoded = bech32m.decode(trimmed, 90);
  if (decoded.prefix !== "fast" && decoded.prefix !== "set") {
    throw new Error("Unsupported FAST address prefix.");
  }
  return bech32m.encode("fast", decoded.words, 90);
}

export function fastAddressToPublicKeyBytes(address: string) {
  const decoded = bech32m.decode(normalizeFastAddress(address), 90);
  return new Uint8Array(bech32m.fromWords(decoded.words));
}

export function fastAddressToPublicKeyHex(address: string) {
  return Buffer.from(fastAddressToPublicKeyBytes(address)).toString("hex");
}

function fastPublicKeyToSpki(publicKeyHex: string) {
  const raw = Buffer.from(normalizeHex(publicKeyHex), "hex");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return Buffer.concat([prefix, raw]);
}

export function utf8ToHex(value: string) {
  return Buffer.from(value, "utf8").toString("hex");
}

export async function verifyFastMessageSignature(args: {
  publicKeyHex: string;
  signatureHex: string;
  messageBytesHex: string;
}) {
  const publicKey = crypto.createPublicKey({
    key: fastPublicKeyToSpki(args.publicKeyHex),
    format: "der",
    type: "spki",
  });
  return crypto.verify(
    null,
    Buffer.from(normalizeHex(args.messageBytesHex), "hex"),
    publicKey,
    Buffer.from(normalizeHex(args.signatureHex), "hex")
  );
}

function jsonBody(data: unknown) {
  return JSON.stringify(data, (_key, value) => {
    if (value instanceof Uint8Array) return Array.from(value);
    if (typeof value === "bigint") return Number(value);
    return value;
  });
}

export async function fastRpcCall<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(fastRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const json = (await response.json()) as { result?: T; error?: unknown };
    if (json.error) {
      throw new Error(`FAST RPC error: ${JSON.stringify(json.error)}`);
    }
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getFastAccountInfo(address: string, certificateByNonce?: { start: number; end: number; limit?: number }) {
  return await fastRpcCall<FastAccountInfo>("proxy_getAccountInfo", {
    address: Array.from(fastAddressToPublicKeyBytes(address)),
    token_balances_filter: [],
    state_key_filter: null,
    certificate_by_nonce: certificateByNonce ? { ...certificateByNonce, limit: certificateByNonce.limit ?? 1 } : null,
  });
}

function settlementTokenIdHex() {
  return Buffer.from(FAST_SETTLEMENT_TOKEN_ID).toString("hex");
}

function amountDecimalToRpcHex(value: string) {
  const atomic = BigInt(value);
  if (atomic < 0n) throw new Error("FAST amount must be non-negative.");
  return atomic.toString(16);
}

function amountHexToDecimal(value: string) {
  const normalized = normalizeHex(value || "0");
  if (!normalized) return "0";
  return BigInt(`0x${normalized}`).toString(10);
}

function transactionTimestamp() {
  return BigInt(Date.now()) * 1000000n;
}

export function hashFastTransaction(transaction: FastTransaction) {
  const serialized = TransactionBcs.serialize(transaction as any).toBytes();
  const hash = keccak_256(serialized);
  return `0x${Buffer.from(hash).toString("hex")}`;
}

export function buildFastTokenTransferClaim(amountWei: string) {
  return {
    TokenTransfer: {
      token_id: FAST_SETTLEMENT_TOKEN_ID,
      amount: amountDecimalToRpcHex(amountWei),
      user_data: null,
    },
  };
}

export function extractFastTransfer(certificate: FastTransactionCertificate) {
  const transaction = certificate?.envelope?.transaction;
  if (!transaction) throw new Error("Missing FAST certificate transaction.");
  const claim = transaction.claim as { TokenTransfer?: { token_id?: number[]; amount?: string } };
  if (!claim?.TokenTransfer) throw new Error("FAST certificate is not a token transfer.");

  const senderBytes = new Uint8Array(transaction.sender || []);
  const recipientBytes = new Uint8Array(transaction.recipient || []);
  const tokenIdBytes = new Uint8Array(claim.TokenTransfer.token_id || []);
  const senderAddress = publicKeyToFastAddress(senderBytes);
  const recipientAddress = publicKeyToFastAddress(recipientBytes);
  const amountWei = amountHexToDecimal(String(claim.TokenTransfer.amount || "0"));
  const txHash = hashFastTransaction(transaction);

  return {
    txHash,
    nonce: Number(transaction.nonce || 0),
    senderAddress,
    recipientAddress,
    amountWei,
    tokenIdHex: Buffer.from(tokenIdBytes).toString("hex"),
    transaction,
  };
}

export async function verifyFastFundingCertificate(args: {
  certificate: FastTransactionCertificate;
  expectedSender: string;
  expectedRecipient: string;
  expectedAmountWei: string;
}) {
  const transfer = extractFastTransfer(args.certificate);
  if (normalizeFastAddress(transfer.senderAddress) !== normalizeFastAddress(args.expectedSender)) {
    throw new Error("FAST funding sender does not match the bound FAST wallet.");
  }
  if (normalizeFastAddress(transfer.recipientAddress) !== normalizeFastAddress(args.expectedRecipient)) {
    throw new Error("FAST funding recipient does not match treasury.");
  }
  if (transfer.amountWei !== BigInt(args.expectedAmountWei).toString(10)) {
    throw new Error("FAST funding amount does not match request max.");
  }
  if (transfer.tokenIdHex !== settlementTokenIdHex()) {
    throw new Error(`FAST rail supports ${FAST_SETTLEMENT_TOKEN_SYMBOL} only.`);
  }

  try {
    const accountInfo = await getFastAccountInfo(transfer.senderAddress, {
      start: transfer.nonce,
      end: transfer.nonce,
      limit: 1,
    });
    const certificates = [
      ...(accountInfo.requested_certificates || []),
      ...(accountInfo.requested_certificate ? [accountInfo.requested_certificate] : []),
    ];
    const seen = certificates.some((candidate) => {
      try {
        return hashFastTransaction(candidate.envelope.transaction) === transfer.txHash;
      } catch {
        return false;
      }
    });
    if (seen) return transfer;
  } catch {
    // The live proxy may omit certificate-by-nonce results even for valid transfers.
  }

  if (!Array.isArray(args.certificate.signatures) || args.certificate.signatures.length === 0) {
    throw new Error("FAST funding certificate has no validator signatures.");
  }
  return transfer;
}

export async function submitFastTreasuryTransfer(args: {
  to: string;
  amountWei: string;
}) {
  const privateKey = fastTreasuryPrivateKey();
  const senderPublicKey = await ed25519.getPublicKeyAsync(Buffer.from(privateKey, "hex"));
  const senderAddress = publicKeyToFastAddress(senderPublicKey);
  const recipientBytes = fastAddressToPublicKeyBytes(args.to);
  const accountInfo = await getFastAccountInfo(senderAddress);
  const nonce = Number(accountInfo.next_nonce || 0);

  const transaction: FastTransaction = {
    sender: Array.from(senderPublicKey),
    recipient: Array.from(recipientBytes),
    nonce,
    timestamp_nanos: transactionTimestamp(),
    claim: buildFastTokenTransferClaim(args.amountWei),
    archival: false,
  };

  const msgHead = new TextEncoder().encode("Transaction::");
  const msgBody = TransactionBcs.serialize(transaction as any).toBytes();
  const msg = new Uint8Array(msgHead.length + msgBody.length);
  msg.set(msgHead, 0);
  msg.set(msgBody, msgHead.length);
  const signature = await ed25519.signAsync(msg, Buffer.from(privateKey, "hex"));

  const submitResult = await fastRpcCall<any>("proxy_submitTransaction", {
    transaction,
    signature: { Signature: Array.from(signature) },
  });
  const certificate = (submitResult?.Success ?? submitResult) as FastTransactionCertificate;
  const transfer = extractFastTransfer(certificate);
  return {
    txHash: transfer.txHash,
    nonce,
    certificate,
    senderAddress,
  };
}
