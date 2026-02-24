import { describe, expect, it } from "vitest";
import { domainMatches, extractDomainFromSource, extractDomainFromUrl, normalizeDomain } from "./domain";

describe("domain helpers", () => {
  it("normalizes case and strips www", () => {
    expect(normalizeDomain("WWW.Example.com")).toBe("example.com");
  });

  it("extracts domain from source URL and plain domain", () => {
    expect(extractDomainFromSource("https://sub.example.com/path")).toBe("sub.example.com");
    expect(extractDomainFromSource("github.com/openai/openai")).toBe("github.com");
  });

  it("returns null for invalid source", () => {
    expect(extractDomainFromSource("")).toBeNull();
    expect(extractDomainFromSource("%%%not-a-url%%%")).toBeNull();
  });

  it("matches exact domain and subdomain", () => {
    expect(domainMatches("example.com", "example.com")).toBe(true);
    expect(domainMatches("example.com", "news.example.com")).toBe(true);
    expect(domainMatches("example.com", "another.com")).toBe(false);
  });

  it("extracts domain from a browser URL", () => {
    expect(extractDomainFromUrl("https://www.wsj.com/articles/foo")).toBe("wsj.com");
  });
});
