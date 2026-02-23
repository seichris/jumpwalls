import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage) return maybeMessage;
  }
  return fallback;
}

export function friendlyTxError(error: unknown): string {
  const msg = errorMessage(error);
  const lower = msg.toLowerCase();
  if (lower.includes("insufficient funds")) {
    return "Insufficient funds for this transaction (value + gas).";
  }
  if (lower.includes("user rejected") || lower.includes("rejected the request")) {
    return "Transaction was rejected in the wallet.";
  }
  if (lower.includes("allowance") || lower.includes("approve")) {
    return "Token allowance/approval appears insufficient. Approve and retry.";
  }
  if (lower.includes("invalidnonce") || lower.includes("invalid nonce")) {
    return "Nonce is stale. Refresh data and retry.";
  }
  if (lower.includes("wallet_switchethereumchain") || lower.includes("chain")) {
    return "Wallet is on the wrong chain. Switch network and retry.";
  }
  return msg;
}
