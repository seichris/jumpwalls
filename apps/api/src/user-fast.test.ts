import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { privateKeyToAccount } from "viem/accounts";

import { getPrisma } from "./db.js";
import {
  FAST_SETTLEMENT_TOKEN_DECIMALS,
  FAST_SETTLEMENT_TOKEN_SYMBOL,
  publicKeyToFastAddress,
  resetFastSdkCaches,
  type FastTransactionCertificate,
} from "./fast.js";
import { buildServer } from "./server.js";

((ed25519 as any).hashes ?? ((ed25519 as any).hashes = {})).sha512 = sha512;

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945385d5f7c88f5b51bb2f530f4f932c3b3f95";
const TEST_FAST_PRIVATE_KEY = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f";
const TEST_FAST_USDC_TOKEN_ID = "0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5";

async function clearTables() {
  const prisma = getPrisma();
  await prisma.infoFiFastTransfer.deleteMany();
  await prisma.infoFiFastJob.deleteMany();
  await prisma.infoFiFastOffer.deleteMany();
  await prisma.infoFiFastRequest.deleteMany();
  await prisma.infoFiUserSession.deleteMany();
  await prisma.infoFiUserAuthChallenge.deleteMany();
  await prisma.infoFiUserProfile.deleteMany();
  await prisma.infoFiRefund.deleteMany();
  await prisma.infoFiPayout.deleteMany();
  await prisma.infoFiRating.deleteMany();
  await prisma.infoFiDigest.deleteMany();
  await prisma.infoFiJob.deleteMany();
  await prisma.infoFiOffer.deleteMany();
  await prisma.infoFiRequest.deleteMany();
}

async function createUserSessionCookie(app: Awaited<ReturnType<typeof buildServer>>, evmAddress: string) {
  const challengeResponse = await app.inject({
    method: "POST",
    url: "/auth/challenge",
    payload: { address: evmAddress },
  });
  assert.equal(challengeResponse.statusCode, 200);
  const challengeBody = challengeResponse.json() as {
    challenge: { nonce: string; messageToSign: string };
  };
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const signature = await account.signMessage({ message: challengeBody.challenge.messageToSign });
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: {
      address: evmAddress,
      nonce: challengeBody.challenge.nonce,
      signature,
    }
  });
  assert.equal(verifyResponse.statusCode, 200);
  const cookie = verifyResponse.cookies.find((entry) => entry.name === "infofi_user_session");
  assert.ok(cookie);
  return `${cookie!.name}=${cookie!.value}`;
}

function tokenIdBytes(tokenIdHex: string) {
  return Array.from(Buffer.from(tokenIdHex.slice(2), "hex"));
}

function weiToFastHex(amountWei: string) {
  return BigInt(amountWei).toString(16);
}

async function withMockedFastRpc<T>(options: {
  certificateByNonce?: FastTransactionCertificate | null;
  nextNonce?: number;
}, run: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body || "{}")) as {
      method?: string;
      params?: Record<string, unknown>;
    };
    switch (payload.method) {
      case "proxy_getTokenInfo":
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              requested_token_metadata: [[
                tokenIdBytes(TEST_FAST_USDC_TOKEN_ID),
                {
                  token_name: FAST_SETTLEMENT_TOKEN_SYMBOL,
                  decimals: FAST_SETTLEMENT_TOKEN_DECIMALS,
                }
              ]],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      case "proxy_getAccountInfo": {
        const wantsCertificate = Boolean(payload.params?.certificate_by_nonce);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: wantsCertificate
              ? {
                  next_nonce: options.nextNonce ?? 0,
                  requested_certificate: options.certificateByNonce ?? null,
                  requested_certificates: options.certificateByNonce ? [options.certificateByNonce] : [],
                }
              : {
                  next_nonce: options.nextNonce ?? 0,
                },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      case "proxy_submitTransaction": {
        const params = (payload.params ?? {}) as {
          signature?: unknown;
          transaction?: unknown;
        };
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              Success: {
                envelope: {
                  transaction: params.transaction,
                  signature: params.signature,
                },
                signatures: [[[1], [2]]],
              }
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      default:
        throw new Error(`Unexpected FAST RPC method: ${payload.method}`);
    }
  }) as typeof globalThis.fetch;
  resetFastSdkCaches();
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    resetFastSdkCaches();
  }
}

test("user auth verify creates a cookie-backed session", async () => {
  await clearTables();
  const app = await buildServer();
  const evmAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const cookie = await createUserSessionCookie(app, evmAccount.address.toLowerCase());

  const profileResponse = await app.inject({
    method: "GET",
    url: "/user/profile",
    headers: { cookie },
  });
  assert.equal(profileResponse.statusCode, 200);
  const body = profileResponse.json() as {
    authenticated: boolean;
    user: { evmAddress: string; fastAddress: string | null };
  };
  assert.equal(body.authenticated, true);
  assert.equal(body.user.evmAddress, evmAccount.address.toLowerCase());
  assert.equal(body.user.fastAddress, null);

  await app.close();
});

test("fast bind normalizes legacy set1 input to canonical fast1 storage", async () => {
  await clearTables();
  const app = await buildServer();
  const evmAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const cookie = await createUserSessionCookie(app, evmAccount.address.toLowerCase());
  const publicKey = Buffer.from(await ed25519.getPublicKeyAsync(Buffer.from(TEST_FAST_PRIVATE_KEY, "hex"))).toString("hex");
  const legacyAddress = publicKeyToFastAddress(publicKey, "set");
  const canonicalAddress = publicKeyToFastAddress(publicKey, "fast");

  const challengeResponse = await app.inject({
    method: "POST",
    url: "/user/fast/challenge",
    headers: { cookie },
    payload: {
      address: legacyAddress,
      publicKey,
    }
  });
  assert.equal(challengeResponse.statusCode, 200);
  const challengeBody = challengeResponse.json() as {
    challenge: { nonce: string; address: string; messageToSign: string };
  };
  assert.equal(challengeBody.challenge.address, canonicalAddress);

  const messageBytes = Buffer.from(challengeBody.challenge.messageToSign, "utf8");
  const signature = Buffer.from(
    await ed25519.signAsync(messageBytes, Buffer.from(TEST_FAST_PRIVATE_KEY, "hex"))
  ).toString("hex");

  const bindResponse = await app.inject({
    method: "POST",
    url: "/user/fast/bind",
    headers: { cookie },
    payload: {
      address: challengeBody.challenge.address,
      publicKey,
      nonce: challengeBody.challenge.nonce,
      signature,
      messageBytes: messageBytes.toString("hex"),
    }
  });
  assert.equal(bindResponse.statusCode, 200);
  const bindBody = bindResponse.json() as {
    user: { fastAddress: string | null; fastPublicKey: string | null };
  };
  assert.equal(bindBody.user.fastAddress, canonicalAddress);
  assert.equal(bindBody.user.fastPublicKey, publicKey);

  await app.close();
});

test("fast bind accepts 0x-prefixed public keys from FastSet", async () => {
  await clearTables();
  const app = await buildServer();
  const evmAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const cookie = await createUserSessionCookie(app, evmAccount.address.toLowerCase());
  const publicKey = Buffer.from(await ed25519.getPublicKeyAsync(Buffer.from(TEST_FAST_PRIVATE_KEY, "hex"))).toString("hex");
  const prefixedPublicKey = `0x${publicKey}`;
  const canonicalAddress = publicKeyToFastAddress(publicKey, "fast");

  const challengeResponse = await app.inject({
    method: "POST",
    url: "/user/fast/challenge",
    headers: { cookie },
    payload: {
      address: canonicalAddress,
      publicKey: prefixedPublicKey,
    }
  });
  assert.equal(challengeResponse.statusCode, 200);
  const challengeBody = challengeResponse.json() as {
    challenge: { nonce: string; publicKey: string; messageToSign: string };
  };
  assert.equal(challengeBody.challenge.publicKey, publicKey);

  const messageBytes = Buffer.from(challengeBody.challenge.messageToSign, "utf8");
  const signature = Buffer.from(
    await ed25519.signAsync(messageBytes, Buffer.from(TEST_FAST_PRIVATE_KEY, "hex"))
  ).toString("hex");

  const bindResponse = await app.inject({
    method: "POST",
    url: "/user/fast/bind",
    headers: { cookie },
    payload: {
      address: canonicalAddress,
      publicKey: prefixedPublicKey,
      nonce: challengeBody.challenge.nonce,
      signature: `0x${signature}`,
      messageBytes: `0x${messageBytes.toString("hex")}`,
    }
  });
  assert.equal(bindResponse.statusCode, 200);
  const bindBody = bindResponse.json() as {
    user: { fastAddress: string | null; fastPublicKey: string | null };
  };
  assert.equal(bindBody.user.fastAddress, canonicalAddress);
  assert.equal(bindBody.user.fastPublicKey, publicKey);

  await app.close();
});

test("requests endpoint aggregates BASE and FAST rails", async () => {
  await clearTables();
  const app = await buildServer();
  const prisma = getPrisma();
  const now = new Date();

  await prisma.infoFiRequest.create({
    data: {
      requestId: `0x${"11".repeat(32)}`,
      requester: "0x1111111111111111111111111111111111111111",
      paymentToken: "ETH",
      maxAmountWei: "1000000000000000000",
      sourceURI: "https://example.com/base",
      question: "base question",
      status: "OPEN",
      chainId: 8453,
      contractAddress: "0x2222222222222222222222222222222222222222",
      createdAt: new Date(now.getTime() - 1000),
      updatedAt: new Date(now.getTime() - 1000),
    }
  });

  await prisma.infoFiFastRequest.create({
    data: {
      requestId: "fastreq_test",
      requester: "0x3333333333333333333333333333333333333333",
      requesterFastAddress: publicKeyToFastAddress(crypto.randomBytes(32)),
      paymentToken: "SETUSDC",
      maxAmountWei: "2500000",
      sourceURI: "https://example.com/fast",
      question: "fast question",
      status: "OPEN",
      fundingTxHash: "0xabc",
      fundingNonce: 7,
      fundingCertificateJson: "{}",
      createdAt: now,
      updatedAt: now,
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/requests?take=10"
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { requests: Array<{ requestId: string; rail: string }> };
  assert.equal(body.requests.length, 2);
  assert.deepEqual(
    body.requests.map((entry) => entry.rail).sort(),
    ["BASE", "FAST"]
  );

  await app.close();
});

test("fast config exposes sdk-backed fastUSDC settlement metadata", async () => {
  await clearTables();
  const app = await buildServer();
  const previousTreasury = process.env.FAST_TREASURY_ADDRESS;
  process.env.FAST_TREASURY_ADDRESS = publicKeyToFastAddress(crypto.randomBytes(32));

  try {
    await withMockedFastRpc({}, async () => {
      const response = await app.inject({
        method: "GET",
        url: "/fast/config",
      });
      assert.equal(response.statusCode, 200);
      const body = response.json() as {
        config: {
          treasuryAddress: string;
          tokenSymbol: string;
          tokenDecimals: number;
          tokenId: string;
        };
      };
      assert.equal(body.config.tokenSymbol, FAST_SETTLEMENT_TOKEN_SYMBOL);
      assert.equal(body.config.tokenDecimals, FAST_SETTLEMENT_TOKEN_DECIMALS);
      assert.equal(body.config.tokenId, TEST_FAST_USDC_TOKEN_ID);
      assert.equal(body.config.treasuryAddress, process.env.FAST_TREASURY_ADDRESS);
    });
  } finally {
    if (previousTreasury == null) {
      delete process.env.FAST_TREASURY_ADDRESS;
    } else {
      process.env.FAST_TREASURY_ADDRESS = previousTreasury;
    }
    resetFastSdkCaches();
    await app.close();
  }
});

test("new fast requests persist fastUSDC for funding and request rows", async () => {
  await clearTables();
  const app = await buildServer();
  const prisma = getPrisma();
  const evmAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const cookie = await createUserSessionCookie(app, evmAccount.address.toLowerCase());
  const requesterPublicKey = Buffer.from(await ed25519.getPublicKeyAsync(Buffer.from(TEST_FAST_PRIVATE_KEY, "hex")));
  const requesterFastAddress = publicKeyToFastAddress(requesterPublicKey);
  const treasuryPublicKey = crypto.randomBytes(32);
  const treasuryAddress = publicKeyToFastAddress(treasuryPublicKey);
  const maxAmountWei = "2500000";
  const certificate: FastTransactionCertificate = {
    envelope: {
      transaction: {
        sender: Array.from(requesterPublicKey),
        recipient: Array.from(treasuryPublicKey),
        nonce: 7,
        timestamp_nanos: 1,
        claim: {
          TokenTransfer: {
            token_id: tokenIdBytes(TEST_FAST_USDC_TOKEN_ID),
            amount: weiToFastHex(maxAmountWei),
            user_data: null,
          },
        },
        archival: false,
      },
      signature: { Signature: [1, 2, 3] },
    },
    signatures: [[[1], [2]]],
  };
  const previousTreasury = process.env.FAST_TREASURY_ADDRESS;
  process.env.FAST_TREASURY_ADDRESS = treasuryAddress;
  await prisma.infoFiUserProfile.upsert({
    where: { evmAddress: evmAccount.address.toLowerCase() },
    create: {
      evmAddress: evmAccount.address.toLowerCase(),
      fastAddress: requesterFastAddress,
      fastPublicKey: requesterPublicKey.toString("hex"),
      fastBoundAt: new Date(),
    },
    update: {
      fastAddress: requesterFastAddress,
      fastPublicKey: requesterPublicKey.toString("hex"),
      fastBoundAt: new Date(),
    },
  });

  try {
    await withMockedFastRpc({ certificateByNonce: certificate }, async () => {
      const response = await app.inject({
        method: "POST",
        url: "/fast/requests",
        headers: { cookie },
        payload: {
          sourceURI: "https://example.com/fast-sdk",
          question: "What changed?",
          maxAmountWei,
          fundingCertificate: certificate,
        },
      });
      assert.equal(response.statusCode, 201);
      const body = response.json() as { request: { requestId: string; paymentToken: string } };
      assert.equal(body.request.paymentToken, FAST_SETTLEMENT_TOKEN_SYMBOL);

      const request = await prisma.infoFiFastRequest.findUnique({ where: { requestId: body.request.requestId } });
      assert.ok(request);
      assert.equal(request!.paymentToken, FAST_SETTLEMENT_TOKEN_SYMBOL);

      const transfer = await prisma.infoFiFastTransfer.findFirst({
        where: {
          requestId: body.request.requestId,
          direction: "FUNDING",
        },
      });
      assert.ok(transfer);
      assert.equal(transfer!.paymentToken, FAST_SETTLEMENT_TOKEN_SYMBOL);
    });
  } finally {
    if (previousTreasury == null) {
      delete process.env.FAST_TREASURY_ADDRESS;
    } else {
      process.env.FAST_TREASURY_ADDRESS = previousTreasury;
    }
    resetFastSdkCaches();
    await app.close();
  }
});

test("refund route records fastUSDC transfer rows through sdk-backed treasury submission", async () => {
  await clearTables();
  const app = await buildServer();
  const prisma = getPrisma();
  const evmAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const cookie = await createUserSessionCookie(app, evmAccount.address.toLowerCase());
  const requesterPublicKey = crypto.randomBytes(32);
  const requesterFastAddress = publicKeyToFastAddress(requesterPublicKey);
  const previousTreasuryKey = process.env.FAST_TREASURY_PRIVATE_KEY;
  process.env.FAST_TREASURY_PRIVATE_KEY = TEST_FAST_PRIVATE_KEY;
  await prisma.infoFiFastJob.create({
    data: {
      jobId: "fastjob_refund",
      requestId: "fastreq_refund",
      offerId: "fastoffer_refund",
      requester: evmAccount.address.toLowerCase(),
      requesterFastAddress,
      consultant: "0x9999999999999999999999999999999999999999",
      consultantFastAddress: publicKeyToFastAddress(crypto.randomBytes(32)),
      paymentToken: FAST_SETTLEMENT_TOKEN_SYMBOL,
      amountWei: "1500000",
      remainingWei: "2500000",
      status: "HIRED",
      hiredAt: new Date(),
    },
  });
  await prisma.infoFiFastRequest.create({
    data: {
      requestId: "fastreq_refund",
      requester: evmAccount.address.toLowerCase(),
      requesterFastAddress,
      paymentToken: FAST_SETTLEMENT_TOKEN_SYMBOL,
      maxAmountWei: "2500000",
      sourceURI: "https://example.com/refund",
      question: "refund me",
      status: "HIRED",
      hiredOfferId: "fastoffer_refund",
      fundingTxHash: "0xabc",
      fundingNonce: 1,
      fundingCertificateJson: "{}",
    },
  });
  await prisma.infoFiFastOffer.create({
    data: {
      offerId: "fastoffer_refund",
      requestId: "fastreq_refund",
      consultant: "0x9999999999999999999999999999999999999999",
      consultantFastAddress: publicKeyToFastAddress(crypto.randomBytes(32)),
      amountWei: "1500000",
      etaSeconds: 600,
      proofType: "reputation-only",
      status: "HIRED",
    },
  });

  try {
    await withMockedFastRpc({ nextNonce: 11 }, async () => {
      const response = await app.inject({
        method: "POST",
        url: "/fast/jobs/fastjob_refund/refund",
        headers: { cookie },
      });
      assert.equal(response.statusCode, 200);

      const refund = await prisma.infoFiFastTransfer.findFirst({
        where: {
          jobId: "fastjob_refund",
          direction: "REFUND",
        },
      });
      assert.ok(refund);
      assert.equal(refund!.paymentToken, FAST_SETTLEMENT_TOKEN_SYMBOL);
      assert.equal(refund!.status, "COMPLETED");
      assert.ok(refund!.txHash);
    });
  } finally {
    if (previousTreasuryKey == null) {
      delete process.env.FAST_TREASURY_PRIVATE_KEY;
    } else {
      process.env.FAST_TREASURY_PRIVATE_KEY = previousTreasuryKey;
    }
    resetFastSdkCaches();
    await app.close();
  }
});
