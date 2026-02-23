import { createPublicClient, createWalletClient, custom, fallback, http, type Address, type Hex } from "viem";
import { appChain } from "./chain";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const maybe = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return maybe ?? null;
}

export function getConfig() {
  const chain = appChain();
  const contractAddress = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "") as Hex;
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (!contractAddress || !contractAddress.startsWith("0x") || contractAddress.length !== 42) {
    throw new Error("Missing NEXT_PUBLIC_CONTRACT_ADDRESS");
  }

  if (!rpcUrl) {
    throw new Error("Missing RPC URL (set NEXT_PUBLIC_RPC_URL, or NEXT_PUBLIC_RPC_URLS_ETHEREUM_SEPOLIA/MAINNET)");
  }

  if (!/^https?:\/\//i.test(rpcUrl)) {
    throw new Error(
      "Invalid RPC URL (must start with http:// or https://). Check for accidental quotes in env vars like NEXT_PUBLIC_RPC_URLS_ETHEREUM_MAINNET."
    );
  }

  return { chain, contractAddress, rpcUrl };
}

function parseChainIdHex(chainIdHex: unknown): number | null {
  if (typeof chainIdHex !== "string") return null;
  if (!chainIdHex.startsWith("0x")) return null;
  const n = Number.parseInt(chainIdHex, 16);
  return Number.isFinite(n) ? n : null;
}

export async function ensureWalletChain(targetChainId: number) {
  const eth = getEthereum();
  if (!eth?.request) throw new Error("No injected wallet found (window.ethereum)");
  const currentHex = await eth.request({ method: "eth_chainId" }).catch(() => null);
  const current = parseChainIdHex(currentHex);
  if (current === targetChainId) return;

  const targetHex = `0x${targetChainId.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetHex }] });
  } catch (err: unknown) {
    // Common MetaMask error code when the chain isn't added yet.
    const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    if (code === 4902) {
      throw new Error(`Wallet does not have chain ${targetChainId} configured. Add it in your wallet, then retry.`);
    }
    throw err;
  }
}

export function getPublicClient() {
  const { chain, rpcUrl } = getConfig();
  const rpcUrls = chain.rpcUrls.default.http.filter(Boolean);
  const transport = rpcUrls.length > 1 ? fallback(rpcUrls.map((url) => http(url))) : http(rpcUrl);
  return createPublicClient({ chain, transport });
}

export function getWalletClient() {
  const { chain } = getConfig();
  const eth = getEthereum();
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  return createWalletClient({ chain, transport: custom(eth) });
}

export async function requestAccounts(): Promise<Address> {
  const eth = getEthereum();
  if (!eth) throw new Error("No injected wallet found (window.ethereum)");
  const accountsUnknown = await eth.request({ method: "eth_requestAccounts" });
  const accounts = Array.isArray(accountsUnknown) ? accountsUnknown : [];
  if (!accounts.length || typeof accounts[0] !== "string") {
    throw new Error("No wallet account returned by provider");
  }
  return accounts[0] as Address;
}
