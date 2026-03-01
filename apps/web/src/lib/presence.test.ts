import { describe, expect, it } from "vitest";
import { conversionRateLabel, demandScoreLabel, etaMinutesLabel, isQuickReplyLikely } from "./presence";

describe("presence helpers", () => {
  it("marks quick reply likely when active agents exist and ETA is low", () => {
    expect(
      isQuickReplyLikely({
        activeAgents: 2,
        medianExpectedEtaSeconds: 8 * 60
      })
    ).toBe(true);
    expect(
      isQuickReplyLikely({
        activeAgents: 0,
        medianExpectedEtaSeconds: 8 * 60
      })
    ).toBe(false);
  });

  it("formats conversion and eta labels", () => {
    expect(conversionRateLabel(0.42)).toBe("42%");
    expect(conversionRateLabel(null)).toBe("—");
    expect(etaMinutesLabel(95)).toBe("2m");
    expect(etaMinutesLabel(null)).toBe("—");
  });

  it("redacts demand score label when k-anonymity gate is active", () => {
    expect(demandScoreLabel({ demandScore24h: 12, demandScore24hRedacted: true })).toBe("hidden");
    expect(demandScoreLabel({ demandScore24h: 12, demandScore24hRedacted: false })).toBe("12");
  });
});
