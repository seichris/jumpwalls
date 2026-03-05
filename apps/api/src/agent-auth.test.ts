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

async function createSignedChallenge(args: {
  app: Awaited<ReturnType<typeof buildServer>>;
  agentAddress: string;
  purpose: "signup" | "heartbeat";
  signMessage: (message: string) => Promise<string>;
}) {
  const challengeResponse = await args.app.inject({
    method: "POST",
    url: "/agents/challenge",
    payload: { agentAddress: args.agentAddress, purpose: args.purpose }
  });
  assert.equal(challengeResponse.statusCode, 200);
  const challengeBody = challengeResponse.json() as {
    challenge: { nonce: string; messageToSign: string };
  };
  const signature = await args.signMessage(challengeBody.challenge.messageToSign);
  return { nonce: challengeBody.challenge.nonce, signature };
}

test("setup plan reports missing required inputs for live-agent-notify", async () => {
  await clearAgentTables();
  const app = await buildServer();

  const response = await app.inject({
    method: "POST",
    url: "/agents/setup/plan",
    payload: {
      mode: "live-agent-notify",
      domains: ["x.com"],
      notificationChannel: "terminal",
      pollIntervalSeconds: 30,
      envKeysPresent: ["API_URL"]
    }
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    plan: { readyForExecution: boolean; missing: string[]; warnings: string[] };
  };
  assert.equal(body.plan.readyForExecution, false);
  assert.ok(body.plan.missing.includes("network"));
  assert.ok(body.plan.missing.includes("env.PRIVATE_KEY"));
  assert.match(body.plan.warnings.join(" "), /twitter\.com/i);

  await app.close();
});

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

test("agent readiness is ready after signup and active heartbeat for requested x.com domain", async () => {
  await clearAgentTables();
  const app = await buildServer();
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const agentAddress = account.address.toLowerCase();

  const signupChallenge = await createSignedChallenge({
    app,
    agentAddress,
    purpose: "signup",
    signMessage: (message) => account.signMessage({ message })
  });
  const signupResponse = await app.inject({
    method: "POST",
    url: "/agents/signup",
    payload: {
      agentAddress,
      nonce: signupChallenge.nonce,
      signature: signupChallenge.signature,
      status: "ACTIVE",
      capabilities: [
        {
          domain: "x.com",
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

  const heartbeatChallenge = await createSignedChallenge({
    app,
    agentAddress,
    purpose: "heartbeat",
    signMessage: (message) => account.signMessage({ message })
  });
  const heartbeatResponse = await app.inject({
    method: "POST",
    url: "/agents/heartbeat",
    payload: {
      agentAddress,
      nonce: heartbeatChallenge.nonce,
      signature: heartbeatChallenge.signature,
      domainsLoggedIn: ["x.com"],
      ttlSeconds: 120
    }
  });
  assert.equal(heartbeatResponse.statusCode, 200);

  const readinessResponse = await app.inject({
    method: "GET",
    url: `/agents/${agentAddress}/readiness?domains=x.com`
  });
  assert.equal(readinessResponse.statusCode, 200);
  const readinessBody = readinessResponse.json() as {
    readiness: {
      ready: boolean;
      listedDomains: string[];
      missingRequirements: string[];
      requestedDomainsCoverage: {
        uncoveredCapabilities: string[];
        notLive: string[];
      };
    };
  };
  assert.equal(readinessBody.readiness.ready, true);
  assert.ok(readinessBody.readiness.listedDomains.includes("x.com"));
  assert.deepEqual(readinessBody.readiness.missingRequirements, []);
  assert.deepEqual(readinessBody.readiness.requestedDomainsCoverage.uncoveredCapabilities, []);
  assert.deepEqual(readinessBody.readiness.requestedDomainsCoverage.notLive, []);

  await app.close();
});

test("cors allows apex and www aliases for WEB_ORIGIN", async () => {
  const originalWebOrigin = process.env.WEB_ORIGIN;
  let app: Awaited<ReturnType<typeof buildServer>> | null = null;
  try {
    process.env.WEB_ORIGIN = "https://jumpwalls.com";
    app = await buildServer();

    const apex = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://jumpwalls.com" }
    });
    assert.equal(apex.statusCode, 200);
    assert.equal(apex.headers["access-control-allow-origin"], "https://jumpwalls.com");

    const www = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://www.jumpwalls.com" }
    });
    assert.equal(www.statusCode, 200);
    assert.equal(www.headers["access-control-allow-origin"], "https://www.jumpwalls.com");
  } finally {
    if (app) await app.close();
    if (originalWebOrigin == null) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = originalWebOrigin;
  }
});

test.after(async () => {
  await getPrisma().$disconnect();
});
