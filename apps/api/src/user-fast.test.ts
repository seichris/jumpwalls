import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { privateKeyToAccount } from "viem/accounts";

import { getPrisma } from "./db.js";
import { publicKeyToFastAddress } from "./fast.js";
import { buildServer } from "./server.js";

((ed25519 as any).hashes ?? ((ed25519 as any).hashes = {})).sha512 = sha512;

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945385d5f7c88f5b51bb2f530f4f932c3b3f95";
const TEST_FAST_PRIVATE_KEY = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f";

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
