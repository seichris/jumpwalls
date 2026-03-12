import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserFastProvider, BrowserFastWallet, resetBrowserFastProviderCache } from "./fast-browser";

const TEST_TOKEN_ID = "0xb4cf1b9e227bb6a21b959338895dfb39b8d2a96dfa1ce5dd633561c193124cb5";

function configResponse() {
  return new Response(
    JSON.stringify({
      config: {
        treasuryAddress: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
        tokenSymbol: "fastUSDC",
        tokenDecimals: 6,
        tokenId: TEST_TOKEN_ID,
        explorerUrl: "https://explorer.fast.xyz",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

afterEach(() => {
  resetBrowserFastProviderCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser fast provider", () => {
  it("caches fast config and normalizes historical aliases", async () => {
    const fetchMock = vi.fn(async () => configResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new BrowserFastProvider();
    const config = await provider.getConfig();
    const token = await provider.getSettlementToken("SETUSDC");

    expect(config.tokenSymbol).toBe("fastUSDC");
    expect(token.symbol).toBe("fastUSDC");
    expect(token.tokenId).toBe(TEST_TOKEN_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves explorer URLs from cached config", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => configResponse()));

    const provider = new BrowserFastProvider();
    await provider.getConfig();

    expect(await provider.getExplorerUrl("0xabc")).toBe("https://explorer.fast.xyz/txs/0xabc");
  });
});

describe("browser fast wallet", () => {
  it("fails cleanly when the extension is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => configResponse()));

    const wallet = new BrowserFastWallet();
    await expect(wallet.connect(new BrowserFastProvider())).rejects.toThrow("FastSet wallet extension not found.");
  });

  it("connects, signs, and sends through the FastSet facade", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => configResponse()));
    const transferCertificate = {
      envelope: {
        transaction: {
          sender: new Array(32).fill(0x11),
          recipient: new Array(32).fill(0x22),
          nonce: 3,
          timestamp_nanos: 1,
          claim: {
            TokenTransfer: {
              token_id: Array.from(Buffer.from(TEST_TOKEN_ID.slice(2), "hex")),
              amount: "f4240",
              user_data: null,
            },
          },
          archival: false,
        },
        signature: { Signature: [1, 2, 3] },
      },
      signatures: [[[1], [2]]],
    };
    vi.stubGlobal("window", {
      fastset: {
        connect: vi.fn(async () => true),
        getAccounts: vi.fn(async () => [{
          address: "set1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
          publicKey: `0x${"11".repeat(32)}`,
        }]),
        signMessage: vi.fn(async () => ({
          signature: `0x${"aa".repeat(64)}`,
          messageBytes: `0x${"bb".repeat(8)}`,
        })),
        transfer: vi.fn(async () => transferCertificate),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout,
      clearTimeout,
    });

    const provider = new BrowserFastProvider();
    const wallet = await new BrowserFastWallet().connect(provider);
    const keys = await wallet.exportKeys();
    const signed = await wallet.sign({ message: "bind me" });
    const sent = await wallet.send({
      to: "fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      amount: "1",
      token: "SETUSDC",
    });

    expect(keys.address).toBe("fast1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
    expect(keys.publicKey).toBe("11".repeat(32));
    expect(signed.address).toBe(keys.address);
    expect(signed.signature).toBe("aa".repeat(64));
    expect(signed.messageBytes).toBe("bb".repeat(8));
    expect(sent.certificate).toBe(transferCertificate);
    expect(sent.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sent.explorerUrl).toMatch(/^https:\/\/explorer\.fast\.xyz\/txs\/0x[0-9a-f]{64}$/);
  });
});
