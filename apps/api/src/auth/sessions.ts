import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getPrisma } from "../db.js";
import { decryptString, encryptString } from "./crypto.js";
import { getGithubAccessTokenFromRequest, getGithubUserFromRequest } from "../github/oauth.js";

export type GithubUser = { login: string; id: number; avatar_url?: string | null };

function nowMs() {
  return Date.now();
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function isApiSessionToken(token: string): boolean {
  const prefix = process.env.API_SESSION_TOKEN_PREFIX || "ghb_";
  return token.startsWith(prefix);
}

export function mintApiSessionToken(): string {
  const prefix = process.env.API_SESSION_TOKEN_PREFIX || "ghb_";
  return `${prefix}${crypto.randomBytes(24).toString("hex")}`;
}

export function apiSessionTtlMs(): number {
  const hoursRaw = process.env.API_SESSION_TTL_HOURS || "24";
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours <= 0) return 24 * 60 * 60 * 1000;
  return Math.floor(hours * 60 * 60 * 1000);
}

export async function createApiSession(opts: { githubAccessToken: string; user: GithubUser; label?: string | null }) {
  const prisma = getPrisma();
  const token = mintApiSessionToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(nowMs() + apiSessionTtlMs());

  const githubAccessTokenEnc = encryptString(opts.githubAccessToken);
  await prisma.apiSession.create({
    data: {
      tokenHash,
      githubAccessTokenEnc,
      userLogin: opts.user.login,
      userId: opts.user.id,
      userAvatarUrl: opts.user.avatar_url ?? null,
      label: opts.label ?? null,
      expiresAt
    }
  });

  return { token, expiresAt, user: opts.user };
}

export async function resolveApiSessionFromToken(token: string) {
  const prisma = getPrisma();
  const tokenHash = sha256Hex(token);
  const s = await prisma.apiSession.findUnique({ where: { tokenHash } });
  if (!s) return null;
  if (s.expiresAt.getTime() <= nowMs()) {
    await prisma.apiSession.delete({ where: { tokenHash } }).catch(() => {});
    return null;
  }
  let githubAccessToken = "";
  try {
    githubAccessToken = decryptString(s.githubAccessTokenEnc);
  } catch {
    return null;
  }
  const user: GithubUser = { login: s.userLogin, id: s.userId, avatar_url: s.userAvatarUrl ?? null };
  return { githubAccessToken, user, expiresAt: s.expiresAt, label: s.label };
}

export async function revokeApiSession(token: string): Promise<boolean> {
  const prisma = getPrisma();
  const tokenHash = sha256Hex(token);
  const deleted = await prisma.apiSession.delete({ where: { tokenHash } }).catch(() => null);
  return Boolean(deleted);
}

export async function resolveGithubAuthFromRequest(req: FastifyRequest): Promise<{ githubToken: string; user: GithubUser | null }> {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1]?.trim() || "";

  if (bearer && isApiSessionToken(bearer)) {
    const session = await resolveApiSessionFromToken(bearer);
    if (session) return { githubToken: session.githubAccessToken, user: session.user };
    return { githubToken: "", user: null };
  }

  if (bearer) {
    return { githubToken: bearer, user: null };
  }

  const githubToken = (await getGithubAccessTokenFromRequest(req)) || "";
  const user = await getGithubUserFromRequest(req);
  return { githubToken, user };
}
