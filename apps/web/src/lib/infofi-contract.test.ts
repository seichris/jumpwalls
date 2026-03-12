import { describe, expect, it } from "vitest";

import {
  FAST_SETTLEMENT_TOKEN,
  HISTORICAL_FAST_SETTLEMENT_TOKEN,
  LEGACY_FAST_TOKEN,
  isFastSettlementToken,
  parseAmount,
  tokenDecimals,
  tokenSymbol,
} from "./infofi-contract";

describe("infofi contract token helpers", () => {
  it("supports fastUSDC and historical SETUSDC as 6-decimal FAST settlement tokens", () => {
    expect(isFastSettlementToken(FAST_SETTLEMENT_TOKEN)).toBe(true);
    expect(isFastSettlementToken(HISTORICAL_FAST_SETTLEMENT_TOKEN)).toBe(true);
    expect(tokenDecimals(FAST_SETTLEMENT_TOKEN)).toBe(6);
    expect(tokenDecimals(HISTORICAL_FAST_SETTLEMENT_TOKEN)).toBe(6);
    expect(parseAmount(FAST_SETTLEMENT_TOKEN, "1").toString()).toBe("1000000");
    expect(parseAmount(HISTORICAL_FAST_SETTLEMENT_TOKEN, "0.5").toString()).toBe("500000");
  });

  it("preserves token labels for fastUSDC, historical SETUSDC, and native FAST", () => {
    expect(tokenSymbol(FAST_SETTLEMENT_TOKEN)).toBe("fastUSDC");
    expect(tokenSymbol(HISTORICAL_FAST_SETTLEMENT_TOKEN)).toBe("SETUSDC");
    expect(tokenSymbol(LEGACY_FAST_TOKEN)).toBe("FAST");
  });
});
