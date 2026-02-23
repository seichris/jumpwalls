import { getGithubToken, type GithubAuthConfig } from "./appAuth.js";
import { parseGithubIssueUrl } from "./parse.js";

const STATE_LABELS = ["bounty - open", "bounty - implemented", "bounty - closed"] as const;

function colorFor(label: string): string {
  if (label === "bounty") return "0e7490"; // cyan-ish
  if (label === "bounty - open") return "16a34a"; // green
  if (label === "bounty - implemented") return "2563eb"; // blue
  return "6b7280"; // gray
}

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

async function ensureRepoLabel(token: string, owner: string, repo: string, name: string) {
  // Create label if missing; ignore "already exists" style failures.
  const res = await ghRequest(token, `/repos/${owner}/${repo}/labels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, color: colorFor(name), description: "gh-bounties" })
  });
  if (res.ok) return;
  // 422 typically means it already exists.
  if (res.status === 422) return;
  // Lack of permission / other errors should be surfaced.
  const text = await res.text();
  throw new Error(`ensureRepoLabel failed (${name}): ${res.status} ${text}`);
}

async function addIssueLabels(token: string, owner: string, repo: string, issueNumber: number, labels: string[]) {
  const res = await ghRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ labels })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`addIssueLabels failed: ${res.status} ${text}`);
  }
}

async function removeIssueLabel(token: string, owner: string, repo: string, issueNumber: number, labelName: string) {
  const res = await ghRequest(token, `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(labelName)}`, {
    method: "DELETE"
  });
  // 404: label not present -> fine.
  if (res.ok || res.status === 404) return;
  const text = await res.text();
  throw new Error(`removeIssueLabel failed (${labelName}): ${res.status} ${text}`);
}

export async function syncBountyLabels(opts: {
  github: GithubAuthConfig | null;
  issueUrl: string;
  status: "OPEN" | "IMPLEMENTED" | "CLOSED";
}) {
  if (!opts.github) return;
  const token = await getGithubToken(opts.github);
  if (!token) return;

  const { owner, repo, issueNumber } = parseGithubIssueUrl(opts.issueUrl);

  const desiredState =
    opts.status === "OPEN" ? "bounty - open" : opts.status === "IMPLEMENTED" ? "bounty - implemented" : "bounty - closed";

  // Ensure labels exist on the repo first.
  await ensureRepoLabel(token, owner, repo, "bounty");
  for (const l of STATE_LABELS) await ensureRepoLabel(token, owner, repo, l);

  // Add required labels.
  await addIssueLabels(token, owner, repo, issueNumber, ["bounty", desiredState]);

  // Remove other state labels (don't touch user labels).
  for (const l of STATE_LABELS) {
    if (l === desiredState) continue;
    await removeIssueLabel(token, owner, repo, issueNumber, l);
  }
}
