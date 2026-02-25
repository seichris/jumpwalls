import { afterEach, describe, expect, it } from "vitest";

import {
  defaultPrivyFundingAmountUsd,
  isPrivyFeatureEnabled,
  isPrivyFundingSupportedChain,
  privyFundingSupportedChainIds,
} from "./privy";

const KEYS = [
  "NEXT_PUBLIC_PRIVY_ENABLED",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "NEXT_PUBLIC_PRIVY_FUNDING_CHAIN_IDS",
  "NEXT_PUBLIC_PRIVY_DEFAULT_FUND_AMOUNT_USD",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of KEYS) {
  originalEnv.set(key, process.env[key]);
}

afterEach(() => {
  for (const key of KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("privy env config", () => {
  it("enables feature only when app id is present and flag is truthy", () => {
    process.env.NEXT_PUBLIC_PRIVY_ENABLED = "true";
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "";
    expect(isPrivyFeatureEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app_123";
    expect(isPrivyFeatureEnabled()).toBe(true);
  });

  it("parses funding chain ids and defaults to mainnet when invalid", () => {
    process.env.NEXT_PUBLIC_PRIVY_FUNDING_CHAIN_IDS = "8453, 11155111,not-a-number";
    expect(Array.from(privyFundingSupportedChainIds()).sort((a, b) => a - b)).toEqual([8453, 11155111]);
    expect(isPrivyFundingSupportedChain(8453)).toBe(true);

    process.env.NEXT_PUBLIC_PRIVY_FUNDING_CHAIN_IDS = "bad";
    expect(Array.from(privyFundingSupportedChainIds())).toEqual([8453]);
  });

  it("uses 50 USD as safe default amount", () => {
    process.env.NEXT_PUBLIC_PRIVY_DEFAULT_FUND_AMOUNT_USD = "75";
    expect(defaultPrivyFundingAmountUsd()).toBe("75");

    process.env.NEXT_PUBLIC_PRIVY_DEFAULT_FUND_AMOUNT_USD = "0";
    expect(defaultPrivyFundingAmountUsd()).toBe("50");

    process.env.NEXT_PUBLIC_PRIVY_DEFAULT_FUND_AMOUNT_USD = "invalid";
    expect(defaultPrivyFundingAmountUsd()).toBe("50");
  });
});
