import crypto from "node:crypto";

type InstallationToken = { token: string; expiresAt: number };

export type GithubAuthConfig = {
  appId?: string;
  installationId?: string;
  privateKeyPem?: string;
  userToken?: string;
};

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwtRS256(payload: object, privateKeyPem: string): string {
  const header = { alg: "RS256", typ: "JWT" };
  const encHeader = base64UrlEncode(Buffer.from(JSON.stringify(header), "utf8"));
  const encPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const data = `${encHeader}.${encPayload}`;

  const sig = crypto.sign("RSA-SHA256", Buffer.from(data, "utf8"), privateKeyPem);
  return `${data}.${base64UrlEncode(sig)}`;
}

function normalizePem(pem: string): string {
  // Allow storing PEM as a single line with "\n" escapes.
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

let cached: InstallationToken | null = null;

export async function getInstallationToken(opts: {
  appId: string;
  installationId: string;
  privateKeyPem: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const jwt = signJwtRS256(
    {
      // GitHub recommends iat a little in the past to allow for clock skew.
      iat: now - 60,
      exp: now + 9 * 60,
      iss: opts.appId
    },
    normalizePem(opts.privateKeyPem)
  );

  const res = await fetch(`https://api.github.com/app/installations/${opts.installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "gh-bounties"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub installation token error: ${res.status} ${text}`);
  }

  const json = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = Math.floor(new Date(json.expires_at).getTime() / 1000);
  cached = { token: json.token, expiresAt };
  return json.token;
}

export async function getGithubToken(opts: GithubAuthConfig): Promise<string | null> {
  const hasApp = Boolean(opts.appId && opts.installationId && opts.privateKeyPem);
  if (hasApp) {
    return getInstallationToken({
      appId: opts.appId as string,
      installationId: opts.installationId as string,
      privateKeyPem: opts.privateKeyPem as string
    });
  }
  if (opts.userToken && opts.userToken.trim().length > 0) return opts.userToken.trim();
  return null;
}
