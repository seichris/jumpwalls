import type { InfoFiDomainPresenceRow } from "./infofi-types";

export const QUICK_REPLY_ETA_THRESHOLD_SECONDS = 15 * 60;

export function etaMinutesLabel(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

export function conversionRateLabel(rate: number | null) {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function isQuickReplyLikely(input: Pick<InfoFiDomainPresenceRow, "activeAgents" | "medianExpectedEtaSeconds">) {
  if (!input.activeAgents || input.activeAgents <= 0) return false;
  if (input.medianExpectedEtaSeconds == null) return false;
  return input.medianExpectedEtaSeconds <= QUICK_REPLY_ETA_THRESHOLD_SECONDS;
}

export function demandScoreLabel(input: Pick<InfoFiDomainPresenceRow, "demandScore24h" | "demandScore24hRedacted">) {
  if (input.demandScore24hRedacted) return "hidden";
  return String(input.demandScore24h);
}
