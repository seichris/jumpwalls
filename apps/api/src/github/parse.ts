export type ParsedIssue = {
  owner: string;
  repo: string;
  issueNumber: number;
};

export type ParsedPullRequest = {
  owner: string;
  repo: string;
  pullNumber: number;
};

export function parseGithubIssueUrl(input: string): ParsedIssue {
  const url = input.trim();
  const m = url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i);
  if (!m) throw new Error("Invalid GitHub issue URL");
  return { owner: m[1], repo: m[2].replace(/\.git$/i, ""), issueNumber: Number(m[3]) };
}

export function parseGithubPullRequestUrl(input: string): ParsedPullRequest {
  const url = input.trim();
  const m = url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!m) throw new Error("Invalid GitHub pull request URL");
  return { owner: m[1], repo: m[2].replace(/\.git$/i, ""), pullNumber: Number(m[3]) };
}
