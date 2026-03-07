import { describe, expect, it } from "vitest";

import { canonicalFastAddress, fastAmountToTransferHex, isFastWalletAddress, normalizeFastHex } from "./fast-wallet";

describe("fast wallet helpers", () => {
  it("normalizes legacy set1 addresses to fast1", () => {
    expect(canonicalFastAddress("set1abc")).toBe("fast1abc");
    expect(canonicalFastAddress("FAST1xyz")).toBe("fast1xyz");
  });

  it("recognizes fast1 and set1 bech32m-style addresses", () => {
    expect(isFastWalletAddress("fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")).toBe(true);
    expect(isFastWalletAddress("set1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")).toBe(true);
    expect(isFastWalletAddress("0xabc")).toBe(false);
  });

  it("converts FAST decimal amounts to transfer hex", () => {
    expect(fastAmountToTransferHex("1")).toBe("0xf4240");
    expect(fastAmountToTransferHex("0.5")).toBe("0x7a120");
  });

  it("normalizes 0x-prefixed FAST hex payloads", () => {
    expect(normalizeFastHex("0xABCD")).toBe("abcd");
    expect(normalizeFastHex("abcd")).toBe("abcd");
  });
});
