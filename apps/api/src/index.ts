import crypto from "node:crypto";
import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";
import { startIndexer } from "./indexer/indexer.js";
import { concatBytes, createPublicClient, fallback, http, isAddress, keccak256, parseAbi, stringToHex, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseGithubIssueUrl, parseGithubPullRequestUrl } from "./github/parse.js";
import { backfillLinkedPullRequests } from "./github/backfill.js";
import { getPrisma } from "./db.js";
import { createApiSession, resolveGithubAuthFromRequest, revokeApiSession } from "./auth/sessions.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMsFromError(err: unknown): number | null {
  // viem's HttpRequestError usually includes `status` and a human string in `details`.
  if (!err || typeof err !== "object") return null;
  const anyErr = err as any;
  const status = typeof anyErr.status === "number" ? anyErr.status : null;
  if (status !== 429) return null;

  const details = typeof anyErr.details === "string" ? anyErr.details : "";
  // Examples seen:
  //   Retry after 5m0s
  //   ... Retry after 30s
  const m = details.match(/retry after\s+(\d+)\s*m\s*(\d+)\s*s/i);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  const s = details.match(/retry after\s+(\d+)\s*s/i);
  if (s) return Number(s[1]) * 1000;

  // If we know it's 429 but can't parse the window, avoid hot-looping.
  return 300_000;
}

async function main() {
  const env = loadEnv();
  // Prisma reads DATABASE_URL from process.env at construction time.
  process.env.DATABASE_URL ||= env.DATABASE_URL;

  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0 && env.RPC_URLS.length === 0) {
    throw new Error("RPC not configured. Set RPC_URL (comma-separated ok) or RPC_URLS_ETHEREUM_SEPOLIA/RPC_URLS_ETHEREUM_MAINNET.");
  }

  const rpcTransport =
    env.RPC_URLS.length > 1 ? fallback(env.RPC_URLS.map((url) => http(url))) : http(env.RPC_URLS[0] || "");

  const githubMode = env.GITHUB_AUTH_MODE ?? "pat";
  const github =
    githubMode === "app"
      ? env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_PRIVATE_KEY_PEM
        ? { appId: env.GITHUB_APP_ID, installationId: env.GITHUB_INSTALLATION_ID, privateKeyPem: env.GITHUB_PRIVATE_KEY_PEM }
        : null
      : env.GITHUB_TOKEN && env.GITHUB_TOKEN.length > 0
        ? { userToken: env.GITHUB_TOKEN }
        : null;

  const app = await buildServer({ github });

  app.get("/id", async (req, reply) => {
    const q = req.query as { repo?: string; issue?: string };
    const repoRaw = typeof q.repo === "string" ? q.repo.trim() : "";
    const issueRaw = typeof q.issue === "string" ? q.issue.trim() : "";
    if (!repoRaw) return reply.code(400).send({ error: "Missing repo" });
    if (!issueRaw || !/^\d+$/.test(issueRaw)) return reply.code(400).send({ error: "Invalid issue" });

    const issueNumber = BigInt(issueRaw);
    const trimmed = repoRaw.trim();
    const withoutProto = trimmed.replace(/^https?:\/\//, "");
    const withoutHost = withoutProto.replace(/^www\./, "");
    const normalized =
      withoutHost.startsWith("github.com/")
        ? withoutHost
        : withoutHost.includes("/")
          ? `github.com/${withoutHost.replace(/^\/+/, "")}`
          : `github.com/${withoutHost}`;

    const repoHash = keccak256(stringToHex(normalized));
    const repoBytes = toBytes(repoHash);
    const issueBytes = toBytes(issueNumber, { size: 32 });
    const bountyId = keccak256(concatBytes([repoBytes, issueBytes]));
    return reply.send({ repo: normalized, repoHash, issueNumber: issueNumber.toString(), bountyId });
  });

  app.get("/infofi/id", async (req, reply) => {
    const q = req.query as {
      requester?: string;
      sourceURI?: string;
      question?: string;
      salt?: string;
      consultant?: string;
      amountWei?: string;
      etaSeconds?: string;
      offerId?: string;
    };
    const requester = typeof q.requester === "string" ? q.requester.trim() : "";
    const sourceURI = typeof q.sourceURI === "string" ? q.sourceURI.trim() : "";
    const question = typeof q.question === "string" ? q.question.trim() : "";
    const saltRaw = typeof q.salt === "string" ? q.salt.trim() : "";
    const consultant = typeof q.consultant === "string" ? q.consultant.trim() : "";
    const amountWeiRaw = typeof q.amountWei === "string" ? q.amountWei.trim() : "";
    const etaRaw = typeof q.etaSeconds === "string" ? q.etaSeconds.trim() : "";
    const offerIdRaw = typeof q.offerId === "string" ? q.offerId.trim() : "";

    if (!isAddress(requester as Address)) return reply.code(400).send({ error: "Invalid requester" });
    if (!sourceURI) return reply.code(400).send({ error: "Missing sourceURI" });
    if (!saltRaw) return reply.code(400).send({ error: "Missing salt" });

    const salt = /^0x[a-fA-F0-9]{64}$/.test(saltRaw) ? (saltRaw as Hex) : keccak256(stringToHex(saltRaw));
    const requestId = keccak256(
      concatBytes([
        toBytes(requester as Hex, { size: 20 }),
        toBytes(keccak256(stringToHex(sourceURI))),
        toBytes(keccak256(stringToHex(question))),
        toBytes(salt)
      ])
    );

    let offerId: Hex | null = null;
    if (consultant && amountWeiRaw && etaRaw) {
      if (!isAddress(consultant as Address)) return reply.code(400).send({ error: "Invalid consultant" });
      if (!/^\d+$/.test(amountWeiRaw)) return reply.code(400).send({ error: "Invalid amountWei" });
      if (!/^\d+$/.test(etaRaw)) return reply.code(400).send({ error: "Invalid etaSeconds" });
      offerId = keccak256(
        concatBytes([
          toBytes(requestId),
          toBytes(consultant as Hex, { size: 20 }),
          toBytes(BigInt(amountWeiRaw), { size: 32 }),
          toBytes(BigInt(etaRaw), { size: 8 }),
          toBytes(salt)
        ])
      );
    }

    const jobSource = /^0x[a-fA-F0-9]{64}$/.test(offerIdRaw) ? (offerIdRaw as Hex) : offerId;
    const jobId = jobSource ? keccak256(concatBytes([toBytes(jobSource), toBytes(requester as Hex, { size: 20 })])) : null;

    return reply.send({
      requester: requester.toLowerCase(),
      sourceURI,
      question,
      salt,
      requestId,
      offerId,
      jobId
    });
  });

  app.get("/contract", async (req, reply) => {
    if (!env.CONTRACT_ADDRESS) return reply.code(400).send({ error: "CONTRACT_ADDRESS not configured" });
    if (env.CONTRACT_KIND === "infofi") {
      return reply.send({
        contractKind: env.CONTRACT_KIND,
        chainId: env.CHAIN_ID,
        rpcUrl: env.RPC_URL,
        contractAddress: env.CONTRACT_ADDRESS,
        settlement: "requester-signed",
        tokenModes: ["ETH", "ERC20"]
      });
    }

    const client = createPublicClient({ transport: rpcTransport });
    const abi = parseAbi([
      "function payoutAuthorizer() view returns (address)",
      "function dao() view returns (address)",
      "function daoDelaySeconds() view returns (uint64)",
      "function defaultLockDuration() view returns (uint64)"
    ]);
    const [payoutAuthorizer, dao, daoDelaySeconds, defaultLockDuration] = await Promise.all([
      client.readContract({ address: env.CONTRACT_ADDRESS as Hex, abi, functionName: "payoutAuthorizer" }) as Promise<Hex>,
      client.readContract({ address: env.CONTRACT_ADDRESS as Hex, abi, functionName: "dao" }) as Promise<Hex>,
      client.readContract({ address: env.CONTRACT_ADDRESS as Hex, abi, functionName: "daoDelaySeconds" }) as Promise<bigint>,
      client.readContract({ address: env.CONTRACT_ADDRESS as Hex, abi, functionName: "defaultLockDuration" }) as Promise<bigint>
    ]);

    return reply.send({
      contractKind: env.CONTRACT_KIND,
      chainId: env.CHAIN_ID,
      rpcUrl: env.RPC_URL,
      contractAddress: env.CONTRACT_ADDRESS,
      payoutAuthorizer,
      dao,
      daoDelaySeconds: daoDelaySeconds.toString(),
      defaultLockDuration: defaultLockDuration.toString()
    });
  });

  app.get("/github/admin", async (req, reply) => {
    const q = req.query as { bountyId?: string };
    if (!q.bountyId) return reply.code(400).send({ error: "Missing bountyId", isAdmin: false });

    const { githubToken } = await resolveGithubAuthFromRequest(req);
    if (!githubToken) return reply.code(401).send({ error: "Missing GitHub auth", isAdmin: false });

    const prisma = getPrisma();
    const bounty = await prisma.bounty.findUnique({ where: { bountyId: q.bountyId } });
    if (!bounty) return reply.code(404).send({ error: "Unknown bountyId", isAdmin: false });

    let owner: string;
    let repo: string;
    try {
      const parsed = parseGithubIssueUrl(bounty.metadataURI);
      owner = parsed.owner;
      repo = parsed.repo;
    } catch {
      return reply.code(400).send({ error: `Bounty metadataURI is not a GitHub issue URL: ${bounty.metadataURI}`, isAdmin: false });
    }

    const ghHeaders = {
      Accept: "application/vnd.github+json",
      "User-Agent": "gh-bounties"
    } as Record<string, string>;

    let ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { ...ghHeaders, Authorization: `Bearer ${githubToken}` }
    });
    if (ghRes.status === 401) {
      ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { ...ghHeaders, Authorization: `token ${githubToken}` }
      });
    }
    if (!ghRes.ok) {
      const text = await ghRes.text().catch(() => "");
      if (ghRes.status === 401) {
        return reply.code(401).send({ error: "GitHub session expired or invalid. Please reconnect GitHub.", isAdmin: false });
      }
      return reply.code(403).send({ error: `GitHub API error (${ghRes.status}): ${text || ghRes.statusText}`, isAdmin: false });
    }
    const ghData = (await ghRes.json()) as any;
    if (!ghData?.permissions?.admin) {
      return reply.code(403).send({ error: "GitHub user is not a repo admin", isAdmin: false });
    }

    return reply.send({ isAdmin: true });
  });

  // ---- CLI device flow (Option 2) ----
  app.post("/auth/device/start", async (req, reply) => {
    const clientId = env.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID || "";
    if (!clientId) return reply.code(500).send({ error: "GitHub OAuth not configured (missing GITHUB_OAUTH_CLIENT_ID)" });
    if (!env.API_TOKEN_ENCRYPTION_KEY) return reply.code(500).send({ error: "Device flow disabled (missing API_TOKEN_ENCRYPTION_KEY)" });

    const rawBody = req.body as any;
    let body: any = rawBody;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
      try {
        const text = Buffer.from(body).toString("utf8");
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!body || typeof body !== "object") body = {};
    const scope = typeof body?.scope === "string" ? body.scope.trim() : (env.GITHUB_OAUTH_SCOPE || "").trim();
    const label = typeof body?.label === "string" ? body.label.trim() : "";

    const form = new URLSearchParams();
    form.set("client_id", clientId);
    if (scope) form.set("scope", scope);

    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "gh-bounties" },
      body: form.toString()
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.device_code) {
      const msg = typeof json?.error_description === "string" ? json.error_description : res.statusText;
      return reply.code(502).send({ error: `GitHub device flow start failed (${res.status}): ${msg}` });
    }

    const deviceCode = String(json.device_code);
    const userCode = String(json.user_code || "");
    const verificationUri = String(json.verification_uri || "");
    const interval = Number(json.interval || 5);
    const expiresIn = Number(json.expires_in || 900);
    if (!deviceCode || !userCode || !verificationUri) return reply.code(502).send({ error: "GitHub device flow returned invalid payload" });

    const prisma = getPrisma();
    const deviceCodeHash = crypto.createHash("sha256").update(deviceCode).digest("hex");
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await prisma.githubDeviceAuth.create({
      data: {
        deviceCodeHash,
        userCode,
        verificationUri,
        interval: Math.max(1, Math.floor(interval)),
        scope: scope || null,
        label: label || null,
        expiresAt
      }
    });

    return reply.send({
      deviceCode,
      userCode,
      verificationUri,
      interval: Math.max(1, Math.floor(interval)),
      expiresIn,
      label: label || undefined
    });
  });

  app.post("/auth/device/poll", async (req, reply) => {
    const clientId = env.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID || "";
    if (!clientId) return reply.code(500).send({ error: "GitHub OAuth not configured (missing GITHUB_OAUTH_CLIENT_ID)" });
    if (!env.API_TOKEN_ENCRYPTION_KEY) return reply.code(500).send({ error: "Device flow disabled (missing API_TOKEN_ENCRYPTION_KEY)" });

    const rawBody = req.body as any;
    let body: any = rawBody;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
      try {
        const text = Buffer.from(body).toString("utf8");
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!body || typeof body !== "object") body = {};
    const deviceCode = typeof body?.deviceCode === "string" ? body.deviceCode.trim() : "";
    const label = typeof body?.label === "string" ? body.label.trim() : null;
    if (!deviceCode) return reply.code(400).send({ error: "Missing deviceCode" });

    const prisma = getPrisma();
    const deviceCodeHash = crypto.createHash("sha256").update(deviceCode).digest("hex");
    const record = await prisma.githubDeviceAuth.findUnique({ where: { deviceCodeHash } });
    if (!record) return reply.code(404).send({ error: "Unknown deviceCode" });
    if (record.expiresAt.getTime() <= Date.now()) {
      await prisma.githubDeviceAuth.delete({ where: { deviceCodeHash } }).catch(() => {});
      return reply.code(400).send({ error: "Device code expired" });
    }

    const form = new URLSearchParams();
    form.set("client_id", clientId);
    form.set("device_code", deviceCode);
    form.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "gh-bounties" },
      body: form.toString()
    });
    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const msg = typeof json?.error_description === "string" ? json.error_description : res.statusText;
      return reply.code(502).send({ error: `GitHub device flow poll failed (${res.status}): ${msg}` });
    }

    if (json?.error) {
      const err = String(json.error);
      if (err === "authorization_pending" || err === "slow_down") {
        const interval = err === "slow_down" ? record.interval + 5 : record.interval;
        if (err === "slow_down" && interval !== record.interval) {
          await prisma.githubDeviceAuth.update({ where: { deviceCodeHash }, data: { interval } }).catch(() => {});
        }
        return reply.code(202).send({ status: "pending", interval });
      }
      if (err === "access_denied") {
        await prisma.githubDeviceAuth.delete({ where: { deviceCodeHash } }).catch(() => {});
        return reply.code(403).send({ error: "Access denied" });
      }
      if (err === "expired_token") {
        await prisma.githubDeviceAuth.delete({ where: { deviceCodeHash } }).catch(() => {});
        return reply.code(400).send({ error: "Device code expired" });
      }
      return reply.code(400).send({ error: `Device flow error: ${err}` });
    }

    const githubAccessToken = typeof json?.access_token === "string" ? json.access_token : "";
    if (!githubAccessToken) return reply.code(502).send({ error: "GitHub device flow returned no access_token" });

    const ghHeaders = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubAccessToken}`,
      "User-Agent": "gh-bounties"
    } as Record<string, string>;
    const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
    if (!userRes.ok) {
      const text = await userRes.text().catch(() => "");
      return reply.code(502).send({ error: `GitHub /user failed (${userRes.status}): ${text || userRes.statusText}` });
    }
    const userData = (await userRes.json()) as any;
    if (!userData?.login) return reply.code(502).send({ error: "GitHub /user returned invalid payload" });

    const session = await createApiSession({
      githubAccessToken,
      user: { login: String(userData.login), id: Number(userData.id || 0), avatar_url: userData.avatar_url ?? null },
      label: label || record.label || null
    });
    await prisma.githubDeviceAuth.delete({ where: { deviceCodeHash } }).catch(() => {});
    return reply.send({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: session.user
    });
  });

  app.post("/auth/token/revoke", async (req, reply) => {
    const auth = req.headers.authorization || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1]?.trim() || "";
    if (!token) return reply.code(400).send({ error: "Missing Authorization: Bearer <token>" });
    const ok = await revokeApiSession(token);
    return reply.send({ ok });
  });

  // Payout authorization: verify GitHub admin and sign an EIP-712 authorization.
  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0 && env.BACKEND_SIGNER_PRIVATE_KEY && env.BACKEND_SIGNER_PRIVATE_KEY.length > 0) {
    const client = createPublicClient({ transport: rpcTransport });
    const signer = privateKeyToAccount(env.BACKEND_SIGNER_PRIVATE_KEY as Hex);

	    const authAbi = parseAbi([
	      "function payoutNonces(bytes32 bountyId) view returns (uint256)",
	      "function refundNonces(bytes32 bountyId) view returns (uint256)",
	      "function claimNonces(bytes32 bountyId, address claimer) view returns (uint256)",
	      "function escrowed(bytes32 bountyId, address token) view returns (uint256)",
	      "function bounties(bytes32 bountyId) view returns (bytes32 repoHash, uint256 issueNumber, uint8 status, uint64 createdAt, string metadataURI)"
	    ]);

    app.post("/payout-auth", async (req, reply) => {
      // Preferred: GitHub OAuth login via HttpOnly session cookie.
      // Back-compat: allow Authorization: Bearer <token> for local testing / scripts.
      const { githubToken } = await resolveGithubAuthFromRequest(req);
      if (!githubToken) return reply.code(401).send({ error: "Not logged in (use GitHub OAuth login or send Authorization: Bearer <token>)" });

      // Be tolerant of mis-parsed JSON bodies (e.g. body arrives as a string).
      const rawBody = req.body as any;
      let body: any = rawBody;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = null;
        }
      }
      // Some clients/content-type parsers may deliver JSON as a Buffer/Uint8Array.
      if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
        try {
          const text = Buffer.from(body).toString("utf8");
          body = JSON.parse(text);
        } catch {
          req.log.warn(
            {
              contentType: req.headers["content-type"],
              contentLength: req.headers["content-length"]
            },
            "Failed to parse JSON buffer body"
          );
          body = null;
        }
      }

      if (!body || typeof body !== "object") {
        req.log.warn(
          {
            contentType: req.headers["content-type"],
            contentLength: req.headers["content-length"],
            bodyType: typeof rawBody
          },
          "Invalid /payout-auth body"
        );
        return reply.code(400).send({ error: "Invalid JSON body" });
      }

      const bountyIdRaw = body?.bountyId as unknown;
      const token = body?.token as Address | undefined;
      const recipient = body?.recipient as Address | undefined;
      const amountWeiStr = body?.amountWei as string | undefined;
      const deadlineStr = body?.deadline as string | undefined;

      let bountyIdStr = typeof bountyIdRaw === "string" ? bountyIdRaw.trim() : "";
      // Accept both `0x`-prefixed and bare 32-byte hex strings.
      if (/^[a-fA-F0-9]{64}$/.test(bountyIdStr)) bountyIdStr = `0x${bountyIdStr}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(bountyIdStr)) {
        req.log.warn({ received: bountyIdRaw, type: typeof bountyIdRaw }, "Invalid bountyId");
        return reply.code(400).send({ error: "Invalid bountyId", received: bountyIdRaw ?? null });
      }
      const bountyId = bountyIdStr as Hex;
      if (!token || !isAddress(token)) return reply.code(400).send({ error: "Invalid token address" });
      if (!recipient || !isAddress(recipient)) return reply.code(400).send({ error: "Invalid recipient address" });
      if (!amountWeiStr || !/^\d+$/.test(amountWeiStr)) return reply.code(400).send({ error: "Invalid amountWei" });

      const amountWei = BigInt(amountWeiStr);
      const deadline = deadlineStr && /^\d+$/.test(deadlineStr) ? BigInt(deadlineStr) : BigInt(Math.floor(Date.now() / 1000) + 10 * 60);

      // Helpful debug without leaking secrets.
      req.log.info(
        {
          bountyId,
          token,
          recipient,
          amountWei: amountWei.toString(),
          deadline: deadline.toString()
        },
        "payout-auth request"
      );

	      const bounty = (await client.readContract({
	        address: env.CONTRACT_ADDRESS as Hex,
	        abi: authAbi,
	        functionName: "bounties",
	        args: [bountyId]
	      })) as readonly [Hex, bigint, number, bigint, string];

	      const createdAt = BigInt(bounty[3] ?? 0n);
	      const issueUrl = (bounty[4] ?? "").toString();
	      if (createdAt === 0n) return reply.code(404).send({ error: "Bounty not found on-chain" });

	      // Preflight the on-chain constraint: payoutWithAuthorization reverts if amount > escrowed[bountyId][token].
	      // This avoids signing payloads that will fail on-chain (and helps catch indexer/UI mismatches).
	      const escrowedWei = (await client.readContract({
	        address: env.CONTRACT_ADDRESS as Hex,
	        abi: authAbi,
	        functionName: "escrowed",
	        args: [bountyId, token]
	      })) as bigint;
	      if (amountWei === 0n || amountWei > escrowedWei) {
	        return reply.code(400).send({
	          error: "Invalid amount (exceeds escrowed)",
	          amountWei: amountWei.toString(),
	          escrowedWei: escrowedWei.toString()
	        });
	      }

	      let owner: string;
	      let repo: string;
	      try {
	        const parsed = parseGithubIssueUrl(issueUrl);
        owner = parsed.owner;
        repo = parsed.repo;
      } catch (e: any) {
        return reply.code(400).send({ error: `Bounty metadataURI is not a GitHub issue URL: ${issueUrl}` });
      }

      // Verify that the caller is an admin on the repo.
      const ghHeaders = {
        Accept: "application/vnd.github+json",
        "User-Agent": "gh-bounties"
      } as Record<string, string>;

      // GitHub classic PATs historically used `token`, while fine-grained and OAuth tokens use `Bearer`.
      let ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { ...ghHeaders, Authorization: `Bearer ${githubToken}` }
      });
      if (ghRes.status === 401) {
        ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { ...ghHeaders, Authorization: `token ${githubToken}` }
        });
      }
      if (!ghRes.ok) {
        const text = await ghRes.text().catch(() => "");
        req.log.warn({ status: ghRes.status, text: text.slice(0, 200) }, "GitHub repo permission check failed");
        return reply.code(403).send({ error: `GitHub API error (${ghRes.status}): ${text || ghRes.statusText}` });
      }
      const ghData = (await ghRes.json()) as any;
      if (!ghData?.permissions?.admin) return reply.code(403).send({ error: "GitHub user is not a repo admin" });

      const nonce = (await client.readContract({
        address: env.CONTRACT_ADDRESS as Hex,
        abi: authAbi,
        functionName: "payoutNonces",
        args: [bountyId]
      })) as bigint;

      const signature = await signer.signTypedData({
        domain: { name: "GHBounties", version: "1", chainId: env.CHAIN_ID, verifyingContract: env.CONTRACT_ADDRESS as Hex },
        types: {
          Payout: [
            { name: "bountyId", type: "bytes32" },
            { name: "token", type: "address" },
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ]
        },
        primaryType: "Payout",
        message: { bountyId, token, recipient, amount: amountWei, nonce, deadline }
      });

      return reply.send({
        issueUrl,
        owner,
        repo,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature
      });
    });

    app.post("/claim-auth", async (req, reply) => {
      const { githubToken, user: cookieOrSessionUser } = await resolveGithubAuthFromRequest(req);
      let githubUser = cookieOrSessionUser;
      if (githubToken && !githubUser) {
        const ghHeaders = {
          Accept: "application/vnd.github+json",
          "User-Agent": "gh-bounties"
        } as Record<string, string>;

        let userRes = await fetch("https://api.github.com/user", {
          headers: { ...ghHeaders, Authorization: `Bearer ${githubToken}` }
        });
        if (userRes.status === 401) {
          userRes = await fetch("https://api.github.com/user", {
            headers: { ...ghHeaders, Authorization: `token ${githubToken}` }
          });
        }
        if (userRes.ok) {
          const userData = (await userRes.json()) as any;
          if (userData?.login && typeof userData.login === "string") {
            githubUser = { login: userData.login, id: Number(userData.id || 0), avatar_url: userData.avatar_url ?? null };
          }
        }
      }

      if (!githubToken || !githubUser?.login) {
        return reply.code(401).send({ error: "Not logged in (use GitHub OAuth login or send Authorization: Bearer <token>)" });
      }

      const rawBody = req.body as any;
      let body: any = rawBody;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = null;
        }
      }
      if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
        try {
          const text = Buffer.from(body).toString("utf8");
          body = JSON.parse(text);
        } catch {
          req.log.warn(
            {
              contentType: req.headers["content-type"],
              contentLength: req.headers["content-length"]
            },
            "Failed to parse JSON buffer body"
          );
          body = null;
        }
      }
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ error: "Invalid JSON body" });
      }

      const bountyIdRaw = body?.bountyId as unknown;
      const claimMetadataURI = typeof body?.claimMetadataURI === "string" ? body.claimMetadataURI.trim() : "";
      const claimer = body?.claimer as Address | undefined;

      let bountyIdStr = typeof bountyIdRaw === "string" ? bountyIdRaw.trim() : "";
      if (/^[a-fA-F0-9]{64}$/.test(bountyIdStr)) bountyIdStr = `0x${bountyIdStr}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(bountyIdStr)) {
        req.log.warn({ received: bountyIdRaw, type: typeof bountyIdRaw }, "Invalid bountyId");
        return reply.code(400).send({ error: "Invalid bountyId", received: bountyIdRaw ?? null });
      }
      const bountyId = bountyIdStr as Hex;
      if (!claimer || !isAddress(claimer)) return reply.code(400).send({ error: "Invalid claimer address" });
      if (!claimMetadataURI) return reply.code(400).send({ error: "Missing claimMetadataURI" });

      const bounty = (await client.readContract({
        address: env.CONTRACT_ADDRESS as Hex,
        abi: authAbi,
        functionName: "bounties",
        args: [bountyId]
      })) as readonly [Hex, bigint, number, bigint, string];

      const createdAt = BigInt(bounty[3] ?? 0n);
      const issueUrl = (bounty[4] ?? "").toString();
      if (createdAt === 0n) return reply.code(404).send({ error: "Bounty not found on-chain" });

      let owner: string;
      let repo: string;
      try {
        const parsed = parseGithubIssueUrl(issueUrl);
        owner = parsed.owner;
        repo = parsed.repo;
      } catch {
        return reply.code(400).send({ error: `Bounty metadataURI is not a GitHub issue URL: ${issueUrl}` });
      }

      let prOwner: string;
      let prRepo: string;
      let pullNumber: number;
      try {
        const parsed = parseGithubPullRequestUrl(claimMetadataURI);
        prOwner = parsed.owner;
        prRepo = parsed.repo;
        pullNumber = parsed.pullNumber;
      } catch {
        return reply.code(400).send({ error: "Invalid pull request URL" });
      }

      if (prOwner.toLowerCase() !== owner.toLowerCase() || prRepo.toLowerCase() !== repo.toLowerCase()) {
        return reply.code(400).send({ error: "PR repo does not match bounty repo" });
      }

      const ghHeaders = {
        Accept: "application/vnd.github+json",
        "User-Agent": "gh-bounties"
      } as Record<string, string>;

      let prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
        headers: { ...ghHeaders, Authorization: `Bearer ${githubToken}` }
      });
      if (prRes.status === 401) {
        prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
          headers: { ...ghHeaders, Authorization: `token ${githubToken}` }
        });
      }
      if (!prRes.ok) {
        const text = await prRes.text().catch(() => "");
        return reply.code(403).send({ error: `GitHub API error (${prRes.status}): ${text || prRes.statusText}` });
      }
      const prData = (await prRes.json()) as any;
      const prAuthor = prData?.user?.login;
      if (!prAuthor || prAuthor.toLowerCase() !== githubUser.login.toLowerCase()) {
        return reply.code(403).send({ error: `PR author is @${prAuthor ?? "unknown"}, not @${githubUser.login}` });
      }

      const nonce = (await client.readContract({
        address: env.CONTRACT_ADDRESS as Hex,
        abi: authAbi,
        functionName: "claimNonces",
        args: [bountyId, claimer]
      })) as bigint;

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 60);
      const claimHash = keccak256(toBytes(claimMetadataURI));

      const signature = await signer.signTypedData({
        domain: { name: "GHBounties", version: "1", chainId: env.CHAIN_ID, verifyingContract: env.CONTRACT_ADDRESS as Hex },
        types: {
          Claim: [
            { name: "bountyId", type: "bytes32" },
            { name: "claimer", type: "address" },
            { name: "claimHash", type: "bytes32" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ]
        },
        primaryType: "Claim",
        message: { bountyId, claimer, claimHash, nonce, deadline }
      });

      return reply.send({
        issueUrl,
        owner,
        repo,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        claimHash,
        signature
      });
    });

    app.post("/refund-auth", async (req, reply) => {
      const { githubToken } = await resolveGithubAuthFromRequest(req);
      if (!githubToken) return reply.code(401).send({ error: "Not logged in (use GitHub OAuth login or send Authorization: Bearer <token>)" });

      const rawBody = req.body as any;
      let body: any = rawBody;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = null;
        }
      }
      if (body && typeof body === "object" && (Buffer.isBuffer(body) || body instanceof Uint8Array)) {
        try {
          const text = Buffer.from(body).toString("utf8");
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      if (!body || typeof body !== "object") return reply.code(400).send({ error: "Invalid JSON body" });

      const bountyIdRaw = body?.bountyId as unknown;
      const token = body?.token as Address | undefined;
      const funder = body?.funder as Address | undefined;
      const amountWeiStr = body?.amountWei as string | undefined;
      const deadlineStr = body?.deadline as string | undefined;

      let bountyIdStr = typeof bountyIdRaw === "string" ? bountyIdRaw.trim() : "";
      if (/^[a-fA-F0-9]{64}$/.test(bountyIdStr)) bountyIdStr = `0x${bountyIdStr}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(bountyIdStr)) return reply.code(400).send({ error: "Invalid bountyId" });
      const bountyId = bountyIdStr as Hex;
      if (!token || !isAddress(token)) return reply.code(400).send({ error: "Invalid token address" });
      if (!funder || !isAddress(funder)) return reply.code(400).send({ error: "Invalid funder address" });
      if (!amountWeiStr || !/^\d+$/.test(amountWeiStr)) return reply.code(400).send({ error: "Invalid amountWei" });

      const amountWei = BigInt(amountWeiStr);
      const deadline = deadlineStr && /^\d+$/.test(deadlineStr) ? BigInt(deadlineStr) : BigInt(Math.floor(Date.now() / 1000) + 10 * 60);

      const bounty = (await client.readContract({
        address: env.CONTRACT_ADDRESS as Hex,
        abi: authAbi,
        functionName: "bounties",
        args: [bountyId]
      })) as readonly [Hex, bigint, number, bigint, string];

      const createdAt = BigInt(bounty[3] ?? 0n);
      const issueUrl = (bounty[4] ?? "").toString();
      if (createdAt === 0n) return reply.code(404).send({ error: "Bounty not found on-chain" });

      let owner: string;
      let repo: string;
      try {
        const parsed = parseGithubIssueUrl(issueUrl);
        owner = parsed.owner;
        repo = parsed.repo;
      } catch {
        return reply.code(400).send({ error: `Bounty metadataURI is not a GitHub issue URL: ${issueUrl}` });
      }

      const ghHeaders = {
        Accept: "application/vnd.github+json",
        "User-Agent": "gh-bounties"
      } as Record<string, string>;

      let ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { ...ghHeaders, Authorization: `Bearer ${githubToken}` }
      });
      if (ghRes.status === 401) {
        ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { ...ghHeaders, Authorization: `token ${githubToken}` }
        });
      }
      if (!ghRes.ok) {
        const text = await ghRes.text().catch(() => "");
        return reply.code(403).send({ error: `GitHub API error (${ghRes.status}): ${text || ghRes.statusText}` });
      }
      const ghData = (await ghRes.json()) as any;
      if (!ghData?.permissions?.admin) return reply.code(403).send({ error: "GitHub user is not a repo admin" });

      const nonce = (await client.readContract({
        address: env.CONTRACT_ADDRESS as Hex,
        abi: authAbi,
        functionName: "refundNonces",
        args: [bountyId]
      })) as bigint;

      const signature = await signer.signTypedData({
        domain: { name: "GHBounties", version: "1", chainId: env.CHAIN_ID, verifyingContract: env.CONTRACT_ADDRESS as Hex },
        types: {
          Refund: [
            { name: "bountyId", type: "bytes32" },
            { name: "token", type: "address" },
            { name: "funder", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ]
        },
        primaryType: "Refund",
        message: { bountyId, token, funder, amount: amountWei, nonce, deadline }
      });

      return reply.send({
        issueUrl,
        owner,
        repo,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature
      });
    });

    app.log.info({ signer: signer.address }, "payout auth enabled");
  } else {
    app.log.warn("payout auth disabled (missing CONTRACT_ADDRESS or BACKEND_SIGNER_PRIVATE_KEY)");
  }

  // Indexer is optional while bootstrapping the UI, but usually you'll set CONTRACT_ADDRESS.
  if (env.CONTRACT_ADDRESS && env.CONTRACT_ADDRESS.length > 0) {
		    const indexerCfg = {
		      rpcUrls: env.RPC_URLS,
		      chainId: env.CHAIN_ID,
		      contractAddress: (env.CONTRACT_ADDRESS.toLowerCase() as any),
          contractKind: env.CONTRACT_KIND,
		      github,
		      backfillBlockChunk: env.INDEXER_BACKFILL_BLOCK_CHUNK,
		      startBlock: env.INDEXER_START_BLOCK
		    };

    // Don't crash the API if RPC is down / rate limited. Keep retrying in the background.
    void (async () => {
      let delayMs = 5_000;
      while (true) {
        try {
          await startIndexer(indexerCfg);
          app.log.info({ contract: env.CONTRACT_ADDRESS, chainId: env.CHAIN_ID, contractKind: env.CONTRACT_KIND }, "indexer started");
          return;
        } catch (err: any) {
          const retryAfterMs = retryAfterMsFromError(err);
          if (retryAfterMs) delayMs = Math.max(delayMs, retryAfterMs);
          app.log.error(
            { err: err?.shortMessage ?? err?.message ?? String(err), delayMs, rpcUrl: env.RPC_URL },
            "indexer failed to start; retrying"
          );
          await sleep(delayMs);
          delayMs = Math.min(delayMs * 2, 60_000);
        }
      }
    })();
  } else {
    app.log.warn("CONTRACT_ADDRESS is empty; indexer disabled");
  }

  if (env.CONTRACT_KIND !== "infofi" && env.GITHUB_BACKFILL_INTERVAL_MINUTES > 0) {
    let backfillInFlight = false;
    const intervalMs = env.GITHUB_BACKFILL_INTERVAL_MINUTES * 60 * 1000;
    const prisma = getPrisma();

    const runBackfill = async () => {
      if (backfillInFlight) {
        app.log.warn("skipping PR backfill; previous run still in flight");
        return;
      }
      if (!github) {
        app.log.warn("skipping PR backfill; GitHub auth not configured");
        return;
      }
      backfillInFlight = true;
      try {
        const result = await backfillLinkedPullRequests({
          prisma,
          github,
          logger: app.log
        });
        if (!result.ok) {
          app.log.warn({ error: result.error }, "linked PR backfill failed");
        } else {
          app.log.info(
            {
              scanned: result.scanned,
              created: result.created,
              updated: result.updated,
              skipped: result.skipped,
              rateLimited: result.rateLimited
            },
            "linked PR backfill completed"
          );
        }
      } catch (err: any) {
        app.log.warn({ err: err?.message ?? String(err) }, "linked PR backfill crashed");
      } finally {
        backfillInFlight = false;
      }
    };

    runBackfill().catch(() => {
      // logged inside
    });
    setInterval(() => {
      runBackfill().catch(() => {
        // logged inside
      });
    }, intervalMs);
  }

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
