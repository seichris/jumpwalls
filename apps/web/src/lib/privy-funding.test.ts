import { describe, expect, it } from "vitest";

import { buildPrivyFundingOptions, classifyFundingError, isPositiveNumberString } from "./privy-funding";

describe("privy funding helpers", () => {
  it("validates positive decimal numbers", () => {
    expect(isPositiveNumberString("50")).toBe(true);
    expect(isPositiveNumberString("50.25")).toBe(true);
    expect(isPositiveNumberString("0")).toBe(false);
    expect(isPositiveNumberString("-1")).toBe(false);
    expect(isPositiveNumberString("abc")).toBe(false);
  });

  it("builds funding config with requested chain and asset", () => {
    const ethOptions = buildPrivyFundingOptions({ amountUsd: " 25 ", asset: "ETH", chainId: 1 });
    expect(ethOptions.amount).toBe("25");
    expect(ethOptions.chain?.id).toBe(1);
    expect("asset" in ethOptions ? ethOptions.asset : null).toBe("native-currency");
    expect(ethOptions.defaultFundingMethod).toBe("card");
    expect(ethOptions.card?.preferredProvider).toBe("moonpay");

    const usdcOptions = buildPrivyFundingOptions({ amountUsd: "12.5", asset: "USDC", chainId: 11155111 });
    expect("asset" in usdcOptions ? usdcOptions.asset : null).toBe("USDC");
    expect(usdcOptions.chain?.id).toBe(11155111);
  });

  it("rejects invalid funding amount", () => {
    expect(() => buildPrivyFundingOptions({ amountUsd: "0", asset: "ETH", chainId: 1 })).toThrow(
      "Enter a valid USD amount greater than 0."
    );
  });

  it("classifies common funding errors into taxonomy codes", () => {
    expect(classifyFundingError(new Error("Wallet chain mismatch")).code).toBe("CHAIN_MISMATCH");
    expect(classifyFundingError(new Error("Funding was cancelled by user")).code).toBe("USER_CANCELLED");
    expect(classifyFundingError(new Error("Provider unsupported in your region")).code).toBe(
      "REGION_OR_PROVIDER_UNAVAILABLE"
    );
    expect(classifyFundingError(new Error("something else")).code).toBe("UNKNOWN");
  });
});
