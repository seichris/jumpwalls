export const PR_CLAIM_REMINDER_MARKER = "<!-- gh-bounties-pr-claim-reminder -->";

function parseOrigins(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function commentAppUrl(): string | null {
  const origins = parseOrigins(process.env.WEB_ORIGIN);
  if (origins.length === 0) return null;
  const primary = origins[0]!;
  if (process.env.NODE_ENV === "production" && isLocalOrigin(primary)) {
    return null;
  }
  return `${primary.replace(/\/+$/, "")}/`;
}

export function buildPrClaimReminderComment(opts: { author?: string | null; issueUrls: string[] }) {
  const mention = opts.author ? `@${opts.author}` : "there";
  const lines = [
    PR_CLAIM_REMINDER_MARKER,
    `Hey ${mention} — this PR references bounty issue(s):`,
    ...opts.issueUrls.map((issueUrl) => `- ${issueUrl}`),
    ""
  ];

  const appUrl = commentAppUrl();
  if (appUrl) {
    lines.push(`If you're the implementer, please claim the bounty at ${appUrl} and submit this PR URL.`);
  } else {
    lines.push("If you're the implementer, please claim the bounty in gh-bounties and submit this PR URL.");
  }

  return lines.join("\n");
}

