import type { FundWalletConfig } from "@privy-io/react-auth";

import { errorMessage } from "./utils";

export type PrivyFundingAsset = "ETH" | "USDC";

export type FundingErrorCode =
  | "CHAIN_UNSUPPORTED"
  | "CHAIN_MISMATCH"
  | "PRIVY_NOT_READY"
  | "INVALID_AMOUNT"
  | "AUTH_REQUIRED"
  | "WALLET_MISSING"
  | "USER_CANCELLED"
  | "REGION_OR_PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

export type FundingErrorInfo = {
  code: FundingErrorCode;
  message: string;
  rawMessage: string;
};

export function isPositiveNumberString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}

export function buildPrivyFundingOptions(input: {
  amountUsd: string;
  asset: PrivyFundingAsset;
  chainId: number;
}): FundWalletConfig {
  const amount = input.amountUsd.trim();
  if (!isPositiveNumberString(amount)) {
    throw new Error("Enter a valid USD amount greater than 0.");
  }

  return {
    chain: { id: input.chainId },
    amount,
    asset: input.asset === "ETH" ? "native-currency" : "USDC",
    defaultFundingMethod: "card",
    card: { preferredProvider: "moonpay" },
  };
}

export function classifyFundingError(error: unknown): FundingErrorInfo {
  const raw = errorMessage(error, "Funding flow failed.");
  const lower = raw.toLowerCase();

  if (lower.includes("unsupported") && lower.includes("chain")) {
    return {
      code: "CHAIN_UNSUPPORTED",
      message: "Funding is not enabled for this chain in the current configuration.",
      rawMessage: raw,
    };
  }
  if (lower.includes("wrong chain") || lower.includes("chain mismatch") || lower.includes("wallet_switchethereumchain")) {
    return {
      code: "CHAIN_MISMATCH",
      message: "Switch to the app chain, then retry funding.",
      rawMessage: raw,
    };
  }
  if (lower.includes("initializing") || lower.includes("not ready")) {
    return {
      code: "PRIVY_NOT_READY",
      message: "Privy is still initializing. Try again in a moment.",
      rawMessage: raw,
    };
  }
  if (lower.includes("amount") || lower.includes("invalid number")) {
    return {
      code: "INVALID_AMOUNT",
      message: "Enter a valid USD amount greater than 0.",
      rawMessage: raw,
    };
  }
  if (lower.includes("login") || lower.includes("authenticated")) {
    return {
      code: "AUTH_REQUIRED",
      message: "Login to Privy first, then retry funding.",
      rawMessage: raw,
    };
  }
  if (lower.includes("wallet") && lower.includes("not found")) {
    return {
      code: "WALLET_MISSING",
      message: "No eligible wallet found. Connect or create a wallet, then retry.",
      rawMessage: raw,
    };
  }
  if (lower.includes("cancel") || lower.includes("rejected") || lower.includes("closed")) {
    return {
      code: "USER_CANCELLED",
      message: "Funding flow was cancelled before completion.",
      rawMessage: raw,
    };
  }
  if (
    lower.includes("region") ||
    lower.includes("country") ||
    lower.includes("provider") ||
    lower.includes("payment method") ||
    lower.includes("unsupported method")
  ) {
    return {
      code: "REGION_OR_PROVIDER_UNAVAILABLE",
      message: "Funding provider or payment method is unavailable in this region/account.",
      rawMessage: raw,
    };
  }

  return {
    code: "UNKNOWN",
    message: raw,
    rawMessage: raw,
  };
}

