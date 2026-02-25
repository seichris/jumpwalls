import { keccak256, stringToHex, concatBytes, toBytes } from "viem";
export { infoFiAbi } from "./infofiAbi";

export const USDC = {
  // Mainnet
  mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bDa02913",
  // Testnets (Gateway-supported)
  sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  avalancheFuji: "0x5425890298aed601595a70AB815c96711a31Bc65",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  sonicBlaze: "0xA4879Fed32Ecbef99399e5cbC247E533421C4eC6",
  worldChainSepolia: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
  seiAtlantic: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
  hyperEvmTestnet: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
  // Testnets (CCTP-only, not Gateway)
  arbitrumSepolia: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  opSepolia: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
} as const;

export function usdcAddressForChainId(chainId: number): string | null {
  // Mainnet
  if (chainId === 1) return USDC.mainnet;
  if (chainId === 8453) return USDC.base;
  // Testnets (Gateway-supported)
  if (chainId === 11155111) return USDC.sepolia;           // Ethereum Sepolia
  if (chainId === 43113) return USDC.avalancheFuji;        // Avalanche Fuji
  if (chainId === 84532) return USDC.baseSepolia;          // Base Sepolia
  if (chainId === 57054) return USDC.sonicBlaze;           // Sonic Blaze Testnet
  if (chainId === 4801) return USDC.worldChainSepolia;     // World Chain Sepolia
  if (chainId === 1328) return USDC.seiAtlantic;           // Sei Atlantic-2
  if (chainId === 998) return USDC.hyperEvmTestnet;        // HyperEVM Testnet
  // Testnets (CCTP-only, not Gateway)
  if (chainId === 421614) return USDC.arbitrumSepolia;
  if (chainId === 11155420) return USDC.opSepolia;
  return null;
}

export function normalizeRepoId(repoId: string): string {
  // Accept "owner/repo" or "github.com/owner/repo" or full URL.
  const trimmed = repoId.trim();
  const withoutProto = trimmed.replace(/^https?:\/\//, "");
  const withoutHost = withoutProto.replace(/^www\./, "");

  if (withoutHost.startsWith("github.com/")) return withoutHost;
  if (withoutHost.includes("/")) return `github.com/${withoutHost.replace(/^\/+/, "")}`;
  return `github.com/${withoutHost}`;
}

export function repoHash(repoId: string): `0x${string}` {
  const norm = normalizeRepoId(repoId);
  return keccak256(stringToHex(norm));
}

// Must match solidity: keccak256(abi.encodePacked(repoHash, issueNumber))
export function bountyId(repoHashHex: `0x${string}`, issueNumber: bigint): `0x${string}` {
  const repoBytes = toBytes(repoHashHex);
  // uint256 big-endian 32 bytes
  const issueBytes = toBytes(issueNumber, { size: 32 });
  return keccak256(concatBytes([repoBytes, issueBytes]));
}

export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as const;

function asBytes32(value: `0x${string}` | string): `0x${string}` {
  const trimmed = value.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    return trimmed as `0x${string}`;
  }
  return keccak256(stringToHex(trimmed));
}

export function infoFiRequestId(
  requester: `0x${string}`,
  sourceURI: string,
  question: string,
  salt: `0x${string}` | string
): `0x${string}` {
  return keccak256(
    concatBytes([
      toBytes(requester, { size: 20 }),
      toBytes(keccak256(stringToHex(sourceURI))),
      toBytes(keccak256(stringToHex(question))),
      toBytes(asBytes32(salt))
    ])
  );
}

export function infoFiOfferId(
  requestId: `0x${string}`,
  consultant: `0x${string}`,
  amountWei: bigint,
  etaSeconds: number,
  salt: `0x${string}` | string
): `0x${string}` {
  return keccak256(
    concatBytes([
      toBytes(requestId),
      toBytes(consultant, { size: 20 }),
      toBytes(amountWei, { size: 32 }),
      toBytes(BigInt(etaSeconds), { size: 8 }),
      toBytes(asBytes32(salt))
    ])
  );
}

export function infoFiJobId(offerId: `0x${string}`, requester: `0x${string}`): `0x${string}` {
  return keccak256(concatBytes([toBytes(offerId), toBytes(requester, { size: 20 })]));
}
