export type FairUseVerdict = "allow" | "warn" | "block";
export type FairUseRiskLevel = "low" | "medium" | "high";
export type FairUseEnforcementMode = "off" | "warn" | "block";
export type FairUseReviewMethod = "heuristic-only" | "heuristic+gemini";
export type FairUseLlmKeySource = "request-header" | "server-env";

export type FairUseInput = {
  digest: string;
  sourceURI?: string | null;
  question?: string | null;
  citations?: unknown;
  proof?: string | null;
};

export type FairUseMetrics = {
  wordCount: number;
  quoteWordCount: number;
  quoteRatio: number;
  longestQuoteWords: number;
  longQuoteCount: number;
  citationsCount: number;
  hasSourceURI: boolean;
  hasProof: boolean;
  transformCueCount: number;
  fullTextCueCount: number;
  substitutionCueCount: number;
  attributionCueCount: number;
};

export type FairUseFactorScores = {
  purposeAndCharacter: number;
  natureOfSource: number;
  amountAndSubstantiality: number;
  marketEffect: number;
};

export type FairUseLlmReview = {
  provider: "gemini";
  model: string;
  keySource: FairUseLlmKeySource;
  verdict: FairUseVerdict;
  riskLevel: FairUseRiskLevel;
  score: number;
  summary: string;
  reasons: string[];
  confidence: number | null;
};

export type FairUseSnapshot = {
  policyVersion: string;
  verdict: FairUseVerdict;
  riskLevel: FairUseRiskLevel;
  score: number;
  summary: string;
  reasons: string[];
  factors: FairUseFactorScores;
  metrics: FairUseMetrics;
};

export type FairUseReport = {
  policyVersion: string;
  verdict: FairUseVerdict;
  riskLevel: FairUseRiskLevel;
  score: number;
  summary: string;
  reasons: string[];
  factors: FairUseFactorScores;
  metrics: FairUseMetrics;
  reviewMethod?: FairUseReviewMethod;
  heuristic?: FairUseSnapshot;
  llm?: FairUseLlmReview | null;
};

export const FAIR_USE_POLICY_VERSION = "infofi-fair-use-v2";

const TRANSFORM_CUES = [
  "summary",
  "summarize",
  "digest",
  "analysis",
  "takeaway",
  "takeaways",
  "insight",
  "insights",
  "explain",
  "explainer",
  "compare",
  "synthesis",
  "paraphrase",
];

const FULL_TEXT_CUES = [
  "full text",
  "verbatim",
  "word-for-word",
  "exact copy",
  "entire article",
  "entire chapter",
  "raw transcript",
  "copy and paste",
  "copied from source",
];

const SUBSTITUTION_CUES = [
  "instead of reading",
  "no need to read",
  "replaces the article",
  "skip the source",
  "paywall bypass",
  "same as the original",
];

const ATTRIBUTION_CUES = [
  "according to",
  "the author argues",
  "the article says",
  "the paper finds",
  "reported by",
  "writes that",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function riskRank(level: FairUseRiskLevel) {
  if (level === "low") return 0;
  if (level === "medium") return 1;
  return 2;
}

export function riskLevelToVerdict(level: FairUseRiskLevel): FairUseVerdict {
  if (level === "low") return "allow";
  if (level === "medium") return "warn";
  return "block";
}

function makeSnapshot(report: FairUseReport): FairUseSnapshot {
  return {
    policyVersion: report.policyVersion,
    verdict: report.verdict,
    riskLevel: report.riskLevel,
    score: report.score,
    summary: report.summary,
    reasons: report.reasons,
    factors: report.factors,
    metrics: report.metrics,
  };
}

function uniqueReasons(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function combineFairUseWithLlm(heuristic: FairUseReport, llm: FairUseLlmReview | null): FairUseReport {
  const heuristicSnapshot = makeSnapshot(heuristic);
  if (!llm) {
    return {
      ...heuristic,
      reviewMethod: "heuristic-only",
      heuristic: heuristicSnapshot,
      llm: null,
    };
  }

  const llmRiskHigher = riskRank(llm.riskLevel) >= riskRank(heuristic.riskLevel);
  const riskLevel = llmRiskHigher ? llm.riskLevel : heuristic.riskLevel;
  const summary = llmRiskHigher ? llm.summary : heuristic.summary;
  const reasons = uniqueReasons([...heuristic.reasons, ...llm.reasons]);
  const score = clamp(Math.min(heuristic.score, llm.score), 0, 100);

  return {
    ...heuristic,
    policyVersion: FAIR_USE_POLICY_VERSION,
    verdict: riskLevelToVerdict(riskLevel),
    riskLevel,
    score,
    summary,
    reasons: reasons.length > 0 ? reasons : [summary],
    reviewMethod: "heuristic+gemini",
    heuristic: heuristicSnapshot,
    llm,
  };
}

function countWordLikeTokens(text: string) {
  const matches = text.match(/[a-zA-Z0-9]+(?:[\'-][a-zA-Z0-9]+)*/g);
  return matches ? matches.length : 0;
}

function countCueMatches(text: string, cues: string[]) {
  const lower = text.toLowerCase();
  let count = 0;
  for (const cue of cues) {
    if (!cue) continue;
    if (lower.includes(cue)) count += 1;
  }
  return count;
}

function extractQuotedSegments(text: string) {
  const segments: string[] = [];
  const pushMatches = (regexp: RegExp) => {
    let match: RegExpExecArray | null = null;
    while ((match = regexp.exec(text)) !== null) {
      const segment = String(match[1] || "").trim();
      if (segment) segments.push(segment);
    }
  };

  pushMatches(/"([^"\n]{1,5000})"/g);
  pushMatches(/“([^”\n]{1,5000})”/g);
  return segments;
}

function countCitations(citations: unknown) {
  if (!citations) return 0;
  if (Array.isArray(citations)) return citations.filter((entry) => entry != null).length;
  if (typeof citations === "object") {
    const objectEntries = Object.entries(citations as Record<string, unknown>).filter(([, value]) => value != null);
    return objectEntries.length > 0 ? objectEntries.length : 1;
  }
  return 0;
}

function summarizeReasons(reasons: string[], riskLevel: FairUseRiskLevel) {
  if (reasons.length === 0) {
    if (riskLevel === "low") return "Low fair-use risk from automated checks.";
    if (riskLevel === "medium") return "Medium fair-use risk; review before payout.";
    return "High fair-use risk; digest was blocked by policy.";
  }
  return reasons[0];
}

export function parseFairUseEnforcementMode(raw: string | undefined): FairUseEnforcementMode {
  const normalized = String(raw || "block").trim().toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "warn") return "warn";
  return "block";
}

export function reviewDigestFairUse(input: FairUseInput): FairUseReport {
  const digest = input.digest.trim();
  const sourceURI = String(input.sourceURI || "");
  const question = String(input.question || "");
  const proof = String(input.proof || "");

  const fullContextText = [digest, question, proof].filter(Boolean).join("\n");
  const wordCount = countWordLikeTokens(digest);
  const quotedSegments = extractQuotedSegments(digest);
  const quotedWordCounts = quotedSegments.map((segment) => countWordLikeTokens(segment));
  const quoteWordCount = quotedWordCounts.reduce((sum, value) => sum + value, 0);
  const longestQuoteWords = quotedWordCounts.length > 0 ? Math.max(...quotedWordCounts) : 0;
  const longQuoteCount = quotedWordCounts.filter((count) => count >= 40).length;
  const quoteRatio = wordCount > 0 ? quoteWordCount / wordCount : 0;

  const citationsCount = countCitations(input.citations);
  const hasSourceURI = sourceURI.length > 0;
  const hasProof = proof.length > 0;

  const transformCueCount = countCueMatches(fullContextText, TRANSFORM_CUES);
  const fullTextCueCount = countCueMatches(fullContextText, FULL_TEXT_CUES);
  const substitutionCueCount = countCueMatches(fullContextText, SUBSTITUTION_CUES);
  const attributionCueCount = countCueMatches(fullContextText, ATTRIBUTION_CUES);

  const metrics: FairUseMetrics = {
    wordCount,
    quoteWordCount,
    quoteRatio,
    longestQuoteWords,
    longQuoteCount,
    citationsCount,
    hasSourceURI,
    hasProof,
    transformCueCount,
    fullTextCueCount,
    substitutionCueCount,
    attributionCueCount,
  };

  let purposeAndCharacter = 52;
  purposeAndCharacter += Math.min(26, transformCueCount * 6);
  purposeAndCharacter += Math.min(8, attributionCueCount * 4);
  if (citationsCount > 0) purposeAndCharacter += 4;
  purposeAndCharacter -= Math.min(36, fullTextCueCount * 18);
  purposeAndCharacter -= Math.min(30, substitutionCueCount * 10);
  purposeAndCharacter = clamp(Math.round(purposeAndCharacter), 0, 100);

  let natureOfSource = 50;
  const sourceLower = sourceURI.toLowerCase();
  if (sourceLower.includes("doi.org") || sourceLower.includes("arxiv") || sourceLower.includes("wikipedia.org")) {
    natureOfSource += 8;
  }
  if (sourceLower.includes("novel") || sourceLower.includes("lyrics") || sourceLower.includes("poem")) {
    natureOfSource -= 12;
  }
  natureOfSource = clamp(Math.round(natureOfSource), 0, 100);

  let amountAndSubstantiality = 88;
  amountAndSubstantiality -= Math.round(quoteRatio * 140);
  if (longestQuoteWords > 20) amountAndSubstantiality -= Math.round((longestQuoteWords - 20) * 0.55);
  amountAndSubstantiality -= Math.min(24, longQuoteCount * 8);
  if (wordCount > 900) amountAndSubstantiality -= 10;
  if (citationsCount > 0) amountAndSubstantiality += 4;
  amountAndSubstantiality = clamp(Math.round(amountAndSubstantiality), 0, 100);

  let marketEffect = 62;
  marketEffect -= Math.min(38, substitutionCueCount * 16);
  if (fullTextCueCount > 0) marketEffect -= 20;
  if (quoteRatio >= 0.25) marketEffect -= 20;
  if (transformCueCount > 0) marketEffect += 8;
  if (citationsCount > 0) marketEffect += 6;
  marketEffect = clamp(Math.round(marketEffect), 0, 100);

  const factors: FairUseFactorScores = {
    purposeAndCharacter,
    natureOfSource,
    amountAndSubstantiality,
    marketEffect,
  };

  const weightedScore = Math.round(
    purposeAndCharacter * 0.35 + natureOfSource * 0.1 + amountAndSubstantiality * 0.35 + marketEffect * 0.2
  );

  const reasons: string[] = [];
  let riskLevel: FairUseRiskLevel = "low";

  const hardBlock =
    quoteRatio >= 0.5 ||
    longestQuoteWords >= 160 ||
    (fullTextCueCount > 0 && quoteRatio >= 0.2) ||
    (substitutionCueCount > 0 && quoteRatio >= 0.2);

  if (hardBlock || weightedScore < 35) {
    riskLevel = "high";
  } else if (
    weightedScore < 65 ||
    quoteRatio >= 0.2 ||
    longestQuoteWords >= 70 ||
    fullTextCueCount > 0 ||
    substitutionCueCount > 0 ||
    (citationsCount === 0 && wordCount >= 350)
  ) {
    riskLevel = "medium";
  }

  if (quoteRatio >= 0.2) {
    reasons.push(`Quoted text ratio is ${(quoteRatio * 100).toFixed(1)}%, which is high for a digest.`);
  }
  if (longestQuoteWords >= 70) {
    reasons.push(`Longest quoted span is ${longestQuoteWords} words; shorter excerpts are safer.`);
  }
  if (fullTextCueCount > 0) {
    reasons.push("Detected language requesting full-text or verbatim reuse.");
  }
  if (substitutionCueCount > 0) {
    reasons.push("Detected language suggesting market substitution for the source.");
  }
  if (citationsCount === 0) {
    reasons.push("No structured citations provided.");
  }
  if (riskLevel === "low" && citationsCount > 0 && quoteRatio < 0.1) {
    reasons.push("Mostly transformative summary style with limited quoting.");
  }

  const verdict: FairUseVerdict = riskLevel === "high" ? "block" : riskLevel === "medium" ? "warn" : "allow";
  const summary = summarizeReasons(reasons, riskLevel);

  return {
    policyVersion: FAIR_USE_POLICY_VERSION,
    verdict,
    riskLevel,
    score: clamp(weightedScore, 0, 100),
    summary,
    reasons,
    factors,
    metrics,
  };
}
