import { getGithubToken, type GithubAuthConfig } from "./appAuth.js";
import { parseGithubIssueUrl, parseGithubPullRequestUrl } from "./parse.js";

async function ghRequest(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
      "User-Agent": "gh-bounties",
      ...(init?.headers || {})
    }
  });
  return res;
}

async function listIssueComments(opts: { token: string; owner: string; repo: string; issueNumber: number }) {
  const res = await ghRequest(
    opts.token,
    `/repos/${opts.owner}/${opts.repo}/issues/${opts.issueNumber}/comments?per_page=100&sort=created&direction=desc`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`listIssueComments failed: ${res.status} ${text}`);
  }
  return (await res.json()) as Array<{ body?: string | null }>;
}

export async function postIssueComment(opts: {
  github: GithubAuthConfig | null;
  issueUrl: string;
  body: string;
}) {
  if (!opts.github) return;
  const token = await getGithubToken(opts.github);
  if (!token) return;

  const { owner, repo, issueNumber } = parseGithubIssueUrl(opts.issueUrl);

  const res = await ghRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: opts.body })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postIssueComment failed: ${res.status} ${text}`);
  }
}

export async function postIssueCommentIfMissing(opts: {
  github: GithubAuthConfig | null;
  issueUrl: string;
  body: string;
  marker: string;
}) {
  if (!opts.github) return false;
  const token = await getGithubToken(opts.github);
  if (!token) return false;

  const { owner, repo, issueNumber } = parseGithubIssueUrl(opts.issueUrl);
  const markerTag = `<!-- ${opts.marker} -->`;
  const legacyBody = opts.body.trim();

  const comments = await listIssueComments({ token, owner, repo, issueNumber });
  const alreadyPosted = comments.some((comment) => {
    const body = comment?.body || "";
    if (body.includes(markerTag)) return true;
    // Legacy compatibility: avoid reposting historical comments that existed before markers.
    return body.trim() === legacyBody;
  });
  if (alreadyPosted) return false;

  const commentBody = `${opts.body}\n\n${markerTag}`;
  const res = await ghRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: commentBody })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postIssueCommentIfMissing failed: ${res.status} ${text}`);
  }

  return true;
}

export async function postPullRequestCommentIfMissing(opts: {
  github: GithubAuthConfig | null;
  prUrl: string;
  body: string;
  marker: string;
}) {
  if (!opts.github) return false;
  const token = await getGithubToken(opts.github);
  if (!token) return false;

  const { owner, repo, pullNumber } = parseGithubPullRequestUrl(opts.prUrl);

  const comments = await listIssueComments({ token, owner, repo, issueNumber: pullNumber });
  const alreadyPosted = comments.some((comment) => comment?.body?.includes(opts.marker));
  if (alreadyPosted) return false;

  const res = await ghRequest(token, `/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: opts.body })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postPullRequestComment failed: ${res.status} ${text}`);
  }
  return true;
}
