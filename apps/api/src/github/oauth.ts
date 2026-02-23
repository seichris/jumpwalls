import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrisma } from "../db.js";

const COOKIE_NAME = "ghb_session";
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type GithubUser = { login: string; id: number; avatar_url?: string | null };

const pendingStates = new Map<string, { returnTo: string; createdAt: number }>();
function nowMs() {
  return Date.now();
}

function parseOriginCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString("hex");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

async function fetchGithubUserWithToken(accessToken: string): Promise<{ user: GithubUser | null; status: number; errorText: string }> {
  const baseHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gh-bounties"
  } as Record<string, string>;

  let userRes = await fetch("https://api.github.com/user", {
    headers: { ...baseHeaders, Authorization: `Bearer ${accessToken}` }
  });
  if (userRes.status === 401) {
    userRes = await fetch("https://api.github.com/user", {
      headers: { ...baseHeaders, Authorization: `token ${accessToken}` }
    });
  }
  if (!userRes.ok) {
    const text = await userRes.text().catch(() => "");
    return { user: null, status: userRes.status, errorText: text || userRes.statusText };
  }

  const user = (await userRes.json().catch(() => null)) as GithubUser | null;
  if (!user?.login) {
    return { user: null, status: 502, errorText: "Invalid GitHub /user payload" };
  }

  return { user, status: 200, errorText: "" };
}

function setCookie(reply: FastifyReply, value: string) {
  // Host-only cookie (no Domain) so it works cleanly for localhost dev.
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  reply.header("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearCookie(reply: FastifyReply) {
  reply.header("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function getGithubAccessTokenFromRequest(req: FastifyRequest): Promise<string | null> {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return Promise.resolve(null);
  const prisma = getPrisma();
  return prisma.githubSession
    .findUnique({ where: { id: sid } })
    .then((s) => {
      if (!s) return null;
      if (s.expiresAt.getTime() <= nowMs()) {
        return prisma.githubSession.delete({ where: { id: sid } }).then(() => null);
      }
      return s.accessToken;
    })
    .catch(() => null);
}

export function getGithubUserFromRequest(req: FastifyRequest): Promise<GithubUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return Promise.resolve(null);
  const prisma = getPrisma();
  return prisma.githubSession
    .findUnique({ where: { id: sid } })
    .then((s) => {
      if (!s) return null;
      if (s.expiresAt.getTime() <= nowMs()) {
        return prisma.githubSession.delete({ where: { id: sid } }).then(() => null);
      }
      return { login: s.userLogin, id: s.userId, avatar_url: s.userAvatarUrl };
    })
    .catch(() => null);
}

export function registerGithubOAuthRoutes(app: FastifyInstance) {
  const prisma = getPrisma();

  app.get("/auth/github/start", async (req, reply) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID || "";
    const callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL || "";
    const webOrigins = parseOriginCsv(process.env.WEB_ORIGIN);
    const webOrigin = webOrigins[0] || "http://localhost:3000";
    const scope = process.env.GITHUB_OAUTH_SCOPE || "";

    if (!clientId || !callbackUrl) {
      return reply.code(500).send({ error: "GitHub OAuth not configured (missing GITHUB_OAUTH_CLIENT_ID/GITHUB_OAUTH_CALLBACK_URL)" });
    }

    const q = req.query as any;
    const returnTo = typeof q?.returnTo === "string" ? q.returnTo : webOrigin;
    const allowedCsv = (process.env.ALLOWED_RETURN_TO_ORIGINS || "").trim();
    const apiOrigins = parseOriginCsv(process.env.API_ORIGIN);
    const allowed =
      allowedCsv.length > 0
        ? parseOriginCsv(allowedCsv)
        : [...webOrigins, ...apiOrigins].filter(Boolean);

    const ok = allowed.some((origin) => returnTo.startsWith(origin));
    if (!ok) {
      return reply.code(400).send({ error: "Invalid returnTo" });
    }

    const state = randomHex(16);
    pendingStates.set(state, { returnTo, createdAt: nowMs() });

    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", callbackUrl);
    authorize.searchParams.set("state", state);
    if (scope) authorize.searchParams.set("scope", scope);

    return reply.redirect(authorize.toString());
  });

  app.get("/auth/github/callback", async (req, reply) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID || "";
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || "";
    const callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL || "";
    const webOrigins = parseOriginCsv(process.env.WEB_ORIGIN);
    const webOrigin = webOrigins[0] || "http://localhost:3000";

    if (!clientId || !clientSecret || !callbackUrl) {
      return reply.code(500).send({ error: "GitHub OAuth not configured" });
    }

    const q = req.query as any;
    const code = typeof q?.code === "string" ? q.code : "";
    const state = typeof q?.state === "string" ? q.state : "";
    if (!code || !state) return reply.code(400).send({ error: "Missing code/state" });

    const st = pendingStates.get(state);
    pendingStates.delete(state);
    if (!st || nowMs() - st.createdAt > STATE_TTL_MS) return reply.code(400).send({ error: "Invalid state" });

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "gh-bounties" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl, state })
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => "");
      return reply.code(502).send({ error: `GitHub token exchange failed (${tokenRes.status}): ${text || tokenRes.statusText}` });
    }
    const tokenJson = (await tokenRes.json()) as any;
    const accessToken = (tokenJson?.access_token as string) || "";
    if (!accessToken) return reply.code(502).send({ error: "GitHub token exchange returned no access_token" });

    const userCheck = await fetchGithubUserWithToken(accessToken);
    if (!userCheck.user) {
      return reply.code(502).send({ error: `GitHub /user failed (${userCheck.status}): ${userCheck.errorText}` });
    }
    const user = userCheck.user;

    const sid = randomHex(24);
    const expiresAt = new Date(nowMs() + SESSION_TTL_MS);
    await prisma.githubSession.create({
      data: {
        id: sid,
        accessToken,
        userLogin: user.login,
        userId: user.id,
        userAvatarUrl: user.avatar_url ?? null,
        expiresAt
      }
    });
    setCookie(reply, sid);
    return reply.redirect(st.returnTo || webOrigin);
  });

  app.get("/auth/me", async (req, reply) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[COOKIE_NAME];
    if (!sid) return reply.code(401).send({ error: "Not logged in" });

    const token = await getGithubAccessTokenFromRequest(req);
    const user = await getGithubUserFromRequest(req);
    if (!token || !user) {
      clearCookie(reply);
      return reply.code(401).send({ error: "Not logged in" });
    }

    const userCheck = await fetchGithubUserWithToken(token);
    if (!userCheck.user && userCheck.status === 401) {
      await prisma.githubSession.delete({ where: { id: sid } }).catch(() => {});
      clearCookie(reply);
      return reply.code(401).send({ error: "GitHub session expired. Please reconnect GitHub." });
    }
    if (userCheck.user) {
      if (
        userCheck.user.login !== user.login ||
        userCheck.user.id !== user.id ||
        (userCheck.user.avatar_url ?? null) !== (user.avatar_url ?? null)
      ) {
        await prisma.githubSession
          .update({
            where: { id: sid },
            data: {
              userLogin: userCheck.user.login,
              userId: userCheck.user.id,
              userAvatarUrl: userCheck.user.avatar_url ?? null
            }
          })
          .catch(() => {});
      }
      return reply.send({ user: userCheck.user });
    }

    return reply.send({ user });
  });

  app.post("/auth/logout", async (req, reply) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[COOKIE_NAME];
    if (sid) await prisma.githubSession.delete({ where: { id: sid } }).catch(() => {});
    clearCookie(reply);
    return reply.send({ ok: true });
  });
}
