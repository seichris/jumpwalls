const FALLBACK_SITE_ORIGIN = "http://localhost:3000";

function normalizeOrigin(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).origin;
    } catch {
      return null;
    }
  }

  try {
    return new URL(`https://${trimmed}`).origin;
  } catch {
    return null;
  }
}

export function getSiteOrigin(): string {
  return (
    normalizeOrigin(process.env.NEXT_PUBLIC_WEB_ORIGIN) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_WEB_ORIGIN_BASE_MAINNET) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_MAINNET) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_SEPOLIA) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_WEB_ORIGIN_SUI) ||
    normalizeOrigin(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    FALLBACK_SITE_ORIGIN
  );
}
