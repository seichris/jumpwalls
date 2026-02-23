import { parseGithubIssueUrl } from "./parse.js";

export type GithubIssueLabel = { name: string; color: string };
export type GithubIssueAuthor = { login: string; avatar_url?: string | null };
export type GithubIssueSummary = {
  title: string;
  state: string;
  labels: GithubIssueLabel[];
  updatedAt: string;
  htmlUrl: string;
  author: GithubIssueAuthor | null;
  repo?: {
    description: string | null;
    homepage: string | null;
    htmlUrl: string | null;
  } | null;
};

type CacheEntry = { value: GithubIssueSummary | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const SUCCESS_TTL_MS = 5 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;

function nowMs() {
  return Date.now();
}

function readCache(key: string): GithubIssueSummary | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= nowMs()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeCache(key: string, value: GithubIssueSummary | null, ttlMs: number) {
  cache.set(key, { value, expiresAt: nowMs() + ttlMs });
}

async function githubGet(url: string, token?: string | null) {
  const baseHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gh-bounties"
  } as Record<string, string>;

  const authVariants = token
    ? [`Bearer ${token}`, `token ${token}`, null]
    : [null];

  for (let i = 0; i < authVariants.length; i += 1) {
    const authHeader = authVariants[i];
    const res = await fetch(url, {
      headers: authHeader ? { ...baseHeaders, Authorization: authHeader } : baseHeaders
    });

    // Retry with a different auth strategy when credentials appear invalid.
    if (res.status === 401 && i < authVariants.length - 1) {
      continue;
    }
    return res;
  }

  return fetch(url, { headers: baseHeaders });
}

export async function fetchGithubIssueByUrl(opts: {
  issueUrl: string;
  token?: string | null;
}): Promise<GithubIssueSummary | null> {
  const cached = readCache(opts.issueUrl);
  if (cached !== undefined) return cached;

  let parsed: { owner: string; repo: string; issueNumber: number };
  try {
    parsed = parseGithubIssueUrl(opts.issueUrl);
  } catch {
    writeCache(opts.issueUrl, null, ERROR_TTL_MS);
    return null;
  }

  const issueApiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.issueNumber}`;
  const repoApiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  try {
    const res = await githubGet(issueApiUrl, opts.token);

    if (res.status === 404) {
      writeCache(opts.issueUrl, null, ERROR_TTL_MS);
      return null;
    }

    if (!res.ok) {
      writeCache(opts.issueUrl, null, ERROR_TTL_MS);
      return null;
    }

    const payload = (await res.json()) as any;
    let repoSummary: GithubIssueSummary["repo"] = null;
    try {
      const repoRes = await githubGet(repoApiUrl, opts.token);
      if (repoRes.ok) {
        const repoPayload = (await repoRes.json()) as any;
        repoSummary = {
          description: repoPayload?.description ?? null,
          homepage: repoPayload?.homepage ?? null,
          htmlUrl: repoPayload?.html_url ?? null
        };
      }
    } catch {
      repoSummary = null;
    }

    const summary: GithubIssueSummary = {
      title: payload?.title ?? "",
      state: payload?.state ?? "unknown",
      labels: Array.isArray(payload?.labels)
        ? payload.labels
            .map((label: any) => ({
              name: typeof label?.name === "string" ? label.name : "",
              color: typeof label?.color === "string" ? label.color : "cccccc"
            }))
            .filter((label: GithubIssueLabel) => label.name)
        : [],
      updatedAt: payload?.updated_at ?? "",
      htmlUrl: payload?.html_url ?? opts.issueUrl,
      author: payload?.user?.login
        ? { login: payload.user.login, avatar_url: payload.user.avatar_url ?? null }
        : null,
      repo: repoSummary
    };

    writeCache(opts.issueUrl, summary, SUCCESS_TTL_MS);
    return summary;
  } catch {
    writeCache(opts.issueUrl, null, ERROR_TTL_MS);
    return null;
  }
}
