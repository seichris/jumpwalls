import type { PrismaClient } from "../../src/generated/prisma/index.js";
import { getGithubToken, type GithubAuthConfig } from "./appAuth.js";
import { postPullRequestCommentIfMissing } from "./comments.js";
import { parseGithubIssueUrl } from "./parse.js";
import { buildPrClaimReminderComment, PR_CLAIM_REMINDER_MARKER } from "./prReminder.js";

type BackfillOptions = {
  prisma: PrismaClient;
  github: GithubAuthConfig | null;
  repo?: string;
  issueUrl?: string;
  take?: number;
  maxPages?: number;
  dryRun?: boolean;
  logger?: { info: (obj: any, msg?: string) => void; warn: (obj: any, msg?: string) => void };
};

type BackfillIssueResult = {
  issueUrl: string;
  bountyId: string;
  prsFound: number;
  created: number;
  updated: number;
  skipped: number;
};

function normalizeRepo(input?: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").toLowerCase();
}

async function githubRequest(token: string, url: string) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gh-bounties",
    Authorization: `Bearer ${token}`
  };
  let res = await fetch(url, { headers });
  if (res.status === 401) {
    res = await fetch(url, { headers: { ...headers, Authorization: `token ${token}` } });
  }
  return res;
}

function buildSearchQuery(owner: string, repo: string, issueNumber: number) {
  const issueRef = `#${issueNumber}`;
  const repoRef = `${owner}/${repo}#${issueNumber}`;
  const urlRef = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
  return `repo:${owner}/${repo} type:pr in:title,body ("${issueRef}" OR "${repoRef}" OR "${urlRef}")`;
}

async function searchPullRequests(token: string, query: string, maxPages: number) {
  const items: any[] = [];
  const perPage = 100;
  let rateLimited = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
    const res = await githubRequest(token, url);
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      rateLimited = true;
      break;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub search error (${res.status}): ${text || res.statusText}`);
    }
    const json = (await res.json()) as { items?: any[] };
    const pageItems = json.items ?? [];
    items.push(...pageItems);
    if (pageItems.length < perPage) break;
  }

  return { items, rateLimited };
}

export async function backfillLinkedPullRequests(opts: BackfillOptions) {
  const log = opts.logger;
  if (!opts.github) {
    return { ok: false, error: "GitHub auth not configured" };
  }
  const token = await getGithubToken(opts.github);
  if (!token) return { ok: false, error: "GitHub auth not configured" };

  const chainId = Number(process.env.CHAIN_ID || "0");
  const contractAddress = (process.env.CONTRACT_ADDRESS || "").toLowerCase();
  const take = Math.min(Math.max(Number(opts.take || 200), 1), 1000);
  const maxPages = Math.min(Math.max(Number(opts.maxPages || 2), 1), 5);
  const normalizedRepo = normalizeRepo(opts.repo);

  const where: any = {};
  if (chainId) where.chainId = chainId;
  if (contractAddress) where.contractAddress = contractAddress;
  if (opts.issueUrl) {
    const url = opts.issueUrl.trim();
    const alt = url.replace(/^https?:\/\//, "");
    where.metadataURI = { in: [url, alt] };
  }

  const bounties = await opts.prisma.bounty.findMany({
    where,
    take,
    orderBy: { updatedAt: "desc" },
    include: { linkedPullRequests: true }
  });

  const results: BackfillIssueResult[] = [];
  let scanned = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let rateLimited = false;

  for (const bounty of bounties) {
    let parsed: { owner: string; repo: string; issueNumber: number } | null = null;
    try {
      parsed = parseGithubIssueUrl(bounty.metadataURI);
    } catch {
      skipped += 1;
      continue;
    }
    const repoKey = `${parsed.owner}/${parsed.repo}`.toLowerCase();
    if (normalizedRepo && repoKey !== normalizedRepo) continue;

    scanned += 1;
    const query = buildSearchQuery(parsed.owner, parsed.repo, parsed.issueNumber);

    let items: any[] = [];
    try {
      const search = await searchPullRequests(token, query, maxPages);
      items = search.items;
      if (search.rateLimited) {
        rateLimited = true;
        break;
      }
    } catch (err: any) {
      log?.warn({ err: err?.message ?? String(err), issueUrl: bounty.metadataURI }, "PR backfill search failed");
      continue;
    }

    const existing = new Set(bounty.linkedPullRequests.map((link) => link.prUrl.toLowerCase()));
    let issueCreated = 0;
    let issueUpdated = 0;
    let issueSkipped = 0;

    for (const item of items) {
      const prUrl = item?.html_url;
      if (!prUrl || typeof prUrl !== "string") {
        issueSkipped += 1;
        continue;
      }
      const author = item?.user?.login ?? null;
      const createdAt = item?.created_at ? new Date(item.created_at) : new Date();
      const already = existing.has(prUrl.toLowerCase());

      if (opts.dryRun) {
        if (already) issueUpdated += 1;
        else issueCreated += 1;
        continue;
      }

      await opts.prisma.linkedPullRequest.upsert({
        where: { bountyId_prUrl: { bountyId: bounty.bountyId, prUrl } },
        create: { bountyId: bounty.bountyId, prUrl, author, createdAt },
        update: { author }
      });

      // Backfill should also add the same reminder comment used by live webhook flow.
      try {
        const commentBody = buildPrClaimReminderComment({
          author,
          issueUrls: [bounty.metadataURI]
        });
        await postPullRequestCommentIfMissing({
          github: opts.github,
          prUrl,
          body: commentBody,
          marker: PR_CLAIM_REMINDER_MARKER
        });
      } catch (err: any) {
        log?.warn({ err: err?.message ?? String(err), prUrl, issueUrl: bounty.metadataURI }, "PR backfill comment failed");
      }

      if (already) issueUpdated += 1;
      else issueCreated += 1;
    }

    created += issueCreated;
    updated += issueUpdated;
    skipped += issueSkipped;
    results.push({
      issueUrl: bounty.metadataURI,
      bountyId: bounty.bountyId,
      prsFound: items.length,
      created: issueCreated,
      updated: issueUpdated,
      skipped: issueSkipped
    });
  }

  return {
    ok: true,
    scanned,
    created,
    updated,
    skipped,
    rateLimited,
    results
  };
}
