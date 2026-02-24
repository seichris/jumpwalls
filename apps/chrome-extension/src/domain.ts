export function normalizeDomain(domain: string): string {
  const lowered = domain.trim().toLowerCase();
  return lowered.replace(/^www\./, "");
}

export function extractDomainFromSource(sourceURI: string): string | null {
  const trimmed = sourceURI.trim();
  if (!trimmed) return null;

  const asUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(asUrl);
    return normalizeDomain(url.hostname);
  } catch {
    return null;
  }
}

export function domainMatches(targetDomain: string, candidateDomain: string): boolean {
  const target = normalizeDomain(targetDomain);
  const candidate = normalizeDomain(candidateDomain);
  return candidate === target || candidate.endsWith(`.${target}`);
}

export function extractDomainFromUrl(urlRaw: string): string | null {
  try {
    const url = new URL(urlRaw);
    return normalizeDomain(url.hostname);
  } catch {
    return null;
  }
}
