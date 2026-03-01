import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { getPrisma } from "./db.js";
import { buildServer } from "./server.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945385d5f7c88f5b51bb2f530f4f932c3b3f95";

async function clearAgentTables() {
  const prisma = getPrisma();
  await prisma.infoFiAgentHeartbeat.deleteMany();
  await prisma.infoFiAgentCapability.deleteMany();
  await prisma.infoFiAgentProfile.deleteMany();
  await prisma.infoFiAgentAuthChallenge.deleteMany();
}

test("signup challenge nonce is single-use and signature-verified", async () => {
  await clearAgentTables();
  const app = await buildServer();
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const agentAddress = account.address.toLowerCase();

  const challengeResponse = await app.inject({
    method: "POST",
    url: "/agents/challenge",
    payload: {
      agentAddress,
      purpose: "signup"
    }
  });
  assert.equal(challengeResponse.statusCode, 200);
  const challengeBody = challengeResponse.json() as {
    challenge: { nonce: string; messageToSign: string };
  };
  assert.ok(challengeBody.challenge.nonce);
  const signature = await account.signMessage({ message: challengeBody.challenge.messageToSign });

  const signupPayload = {
    agentAddress,
    nonce: challengeBody.challenge.nonce,
    signature,
    status: "ACTIVE",
    capabilities: [
      {
        domain: "example.com",
        paymentToken: "ETH",
        minAmountWei: "1",
        maxAmountWei: "100",
        etaSeconds: 60,
        minConfidence: 0.65
      }
    ]
  };

  const firstSignup = await app.inject({
    method: "POST",
    url: "/agents/signup",
    payload: signupPayload
  });
  assert.equal(firstSignup.statusCode, 200);

  const secondSignup = await app.inject({
    method: "POST",
    url: "/agents/signup",
    payload: signupPayload
  });
  assert.equal(secondSignup.statusCode, 401);
  const secondBody = secondSignup.json() as { error: string };
  assert.match(secondBody.error, /already used/i);

  await app.close();
});

test("heartbeat rejects domains not covered by enabled capabilities", async () => {
  await clearAgentTables();
  const app = await buildServer();
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const agentAddress = account.address.toLowerCase();

  const signupChallengeResponse = await app.inject({
    method: "POST",
    url: "/agents/challenge",
    payload: { agentAddress, purpose: "signup" }
  });
  assert.equal(signupChallengeResponse.statusCode, 200);
  const signupChallenge = signupChallengeResponse.json() as {
    challenge: { nonce: string; messageToSign: string };
  };
  const signupSignature = await account.signMessage({ message: signupChallenge.challenge.messageToSign });

  const signupResponse = await app.inject({
    method: "POST",
    url: "/agents/signup",
    payload: {
      agentAddress,
      nonce: signupChallenge.challenge.nonce,
      signature: signupSignature,
      status: "ACTIVE",
      capabilities: [
        {
          domain: "example.com",
          paymentToken: "ETH",
          minAmountWei: "1",
          maxAmountWei: "100",
          etaSeconds: 60,
          minConfidence: 0.65
        }
      ]
    }
  });
  assert.equal(signupResponse.statusCode, 200);

  const heartbeatChallengeResponse = await app.inject({
    method: "POST",
    url: "/agents/challenge",
    payload: { agentAddress, purpose: "heartbeat" }
  });
  assert.equal(heartbeatChallengeResponse.statusCode, 200);
  const heartbeatChallenge = heartbeatChallengeResponse.json() as {
    challenge: { nonce: string; messageToSign: string };
  };
  const heartbeatSignature = await account.signMessage({ message: heartbeatChallenge.challenge.messageToSign });

  const heartbeatResponse = await app.inject({
    method: "POST",
    url: "/agents/heartbeat",
    payload: {
      agentAddress,
      nonce: heartbeatChallenge.challenge.nonce,
      signature: heartbeatSignature,
      domainsLoggedIn: ["not-example.com"],
      ttlSeconds: 120
    }
  });
  assert.equal(heartbeatResponse.statusCode, 400);
  const heartbeatBody = heartbeatResponse.json() as { error: string };
  assert.match(heartbeatBody.error, /not covered by enabled capabilities/i);

  await app.close();
});

test.after(async () => {
  await getPrisma().$disconnect();
});
