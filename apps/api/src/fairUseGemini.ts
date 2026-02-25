import {
  type FairUseInput,
  type FairUseLlmKeySource,
  type FairUseLlmReview,
  type FairUseRiskLevel,
  type FairUseVerdict,
  riskLevelToVerdict,
} from "./fairUse.js";

type GeminiReviewParams = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  keySource: FairUseLlmKeySource;
  input: FairUseInput;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRiskLevel(value: unknown): FairUseRiskLevel | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
  return null;
}

function normalizeVerdict(value: unknown): FairUseVerdict | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "allow" || normalized === "warn" || normalized === "block") return normalized;
  return null;
}

function riskFromVerdict(verdict: FairUseVerdict): FairUseRiskLevel {
  if (verdict === "allow") return "low";
  if (verdict === "warn") return "medium";
  return "high";
}

function riskRank(level: FairUseRiskLevel) {
  if (level === "low") return 0;
  if (level === "medium") return 1;
  return 2;
}

function defaultScoreFromRisk(riskLevel: FairUseRiskLevel) {
  if (riskLevel === "low") return 80;
  if (riskLevel === "medium") return 55;
  return 20;
}

function textFromGeminiPayload(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }
  if (typeof payload?.text === "string") return payload.text.trim();
  return "";
}

function stripCodeFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

function parseLooseJson(text: string) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match?.[0]) return JSON.parse(match[0]);
    throw new Error("Could not parse Gemini JSON output");
  }
}

function trimReasonList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.trim();
    if (!text) continue;
    out.push(text);
    if (out.length >= 6) break;
  }
  return out;
}

function normalizeGeminiReview(raw: any, model: string, keySource: FairUseLlmKeySource): FairUseLlmReview {
  const providedRisk = normalizeRiskLevel(raw?.riskLevel ?? raw?.risk);
  const providedVerdict = normalizeVerdict(raw?.verdict);

  let riskLevel = providedRisk;
  let verdict = providedVerdict;

  if (!riskLevel && verdict) riskLevel = riskFromVerdict(verdict);
  if (!verdict && riskLevel) verdict = riskLevelToVerdict(riskLevel);
  if (!riskLevel || !verdict) {
    throw new Error("Gemini response missing valid riskLevel/verdict");
  }

  // Resolve inconsistent outputs conservatively by keeping the higher-risk side.
  const verdictRisk = riskFromVerdict(verdict);
  if (riskRank(verdictRisk) > riskRank(riskLevel)) {
    riskLevel = verdictRisk;
  }
  verdict = riskLevelToVerdict(riskLevel);

  const rawScore = Number(raw?.score);
  const score = Number.isFinite(rawScore) ? clamp(Math.round(rawScore), 0, 100) : defaultScoreFromRisk(riskLevel);
  const confidenceRaw = Number(raw?.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? clamp(confidenceRaw, 0, 1) : null;
  const reasons = trimReasonList(raw?.reasons);
  const summaryRaw = typeof raw?.summary === "string" ? raw.summary.trim() : "";
  const summary = summaryRaw || reasons[0] || "Gemini fair-use reviewer flagged this digest for manual review.";

  return {
    provider: "gemini",
    model,
    keySource,
    verdict,
    riskLevel,
    score,
    summary,
    reasons,
    confidence,
  };
}

function safeSnippet(value: unknown, maxChars: number) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[TRUNCATED ${text.length - maxChars} chars]`;
}

function buildPrompt(input: FairUseInput) {
  const citationsSnippet = input.citations === undefined ? "null" : safeSnippet(input.citations, 4000);
  const digestSnippet = safeSnippet(input.digest, 12000);
  const source = input.sourceURI ? input.sourceURI : "(none)";
  const question = input.question ? input.question : "(none)";
  const proof = input.proof ? input.proof : "(none)";

  return [
    "You are evaluating U.S. fair-use risk for a paid digest submission.",
    "This is a risk-screening decision for a marketplace, not legal advice.",
    "Return STRICT JSON only (no markdown, no prose) with this schema:",
    '{ "riskLevel":"low|medium|high", "verdict":"allow|warn|block", "score":0-100, "summary":"...", "reasons":["..."], "confidence":0-1 }',
    "",
    "Guidance:",
    "- high/block: large verbatim reuse, full-text reproduction, or market-substitution behavior.",
    "- medium/warn: moderate quote density, uncertain transformation, weak attribution/citations.",
    "- low/allow: transformative summary/analysis with limited quoting and source attribution.",
    "",
    "Submission context:",
    `sourceURI: ${source}`,
    `question: ${question}`,
    `proof: ${proof}`,
    `citations: ${citationsSnippet}`,
    "",
    "Digest text:",
    digestSnippet,
  ].join("\n");
}

export async function reviewDigestFairUseWithGemini(params: GeminiReviewParams): Promise<FairUseLlmReview> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
  const prompt = buildPrompt(params.input);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), params.timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok) {
    const apiMessage = typeof payload?.error?.message === "string" ? payload.error.message : "";
    const suffix = apiMessage ? `: ${apiMessage}` : "";
    throw new Error(`Gemini API error (${response.status})${suffix}`);
  }

  if (payload?.promptFeedback?.blockReason) {
    throw new Error(`Gemini prompt blocked: ${payload.promptFeedback.blockReason}`);
  }

  const text = textFromGeminiPayload(payload);
  if (!text) {
    throw new Error("Gemini API returned no candidate text");
  }

  const parsed = parseLooseJson(text);
  return normalizeGeminiReview(parsed, params.model, params.keySource);
}
