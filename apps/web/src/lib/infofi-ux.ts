import { isEthToken, tokenSymbol } from "./infofi-contract";

export function fullTextRisk(question: string): boolean {
  const q = question.toLowerCase();
  return /(full[\s-]?text|verbatim|raw\s+text|entire\s+(paper|article)|copy\s+the\s+(paper|article))/i.test(q);
}

export function lowBudgetWarning(token: string, amount: string): string | null {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (isEthToken(token) && parsed < 0.0002) {
    return "Budget is very low for ETH and may not attract quality offers.";
  }
  if (!isEthToken(token) && parsed < 0.2) {
    return `Budget is very low for ${tokenSymbol(token)} and may not attract quality offers.`;
  }
  return null;
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function logUiAction(action: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[infofi-ui] ${action}`, details || {});
  }
}
