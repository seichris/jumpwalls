import { encodeFunctionData, formatUnits, parseEther, type Address } from "viem";

import { erc20Abi } from "./abi";
import { ETH_TOKEN, isEthToken, usdcForChain } from "./infofi-contract";
import { getActiveEthereumProvider, getPublicClient } from "./wallet";

export const MIN_POST_REQUEST_GAS_BUFFER_WEI = parseEther("0.00003");
export const MIN_HIRE_GAS_BUFFER_WEI = parseEther("0.00002");

export type WalletBalanceSnapshot = {
  address: Address;
  ethWei: bigint;
  usdcWei: bigint | null;
  fetchedAtMs: number;
};

export type WalletBalanceDelta = {
  ethWeiDelta: bigint | null;
  usdcWeiDelta: bigint | null;
};

export async function readWalletBalanceSnapshot(address: Address): Promise<WalletBalanceSnapshot> {
  const usdc = usdcForChain();

  try {
    const client = getPublicClient();
    const ethWei = await client.getBalance({ address });

    let usdcWei: bigint | null = null;
    if (usdc) {
      try {
        usdcWei = await client.readContract({
          address: usdc as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
      } catch {
        // Keep funding UX resilient even if token balance read fails.
        usdcWei = null;
      }
    }

    return {
      address,
      ethWei,
      usdcWei,
      fetchedAtMs: Date.now(),
    };
  } catch {
    const provider = getActiveEthereumProvider();
    if (!provider?.request) throw new Error("No wallet provider available for balance read.");

    const ethHex = await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    if (typeof ethHex !== "string") throw new Error("Wallet provider returned invalid ETH balance.");

    let usdcWei: bigint | null = null;
    if (usdc) {
      try {
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
        const usdcHex = await provider.request({
          method: "eth_call",
          params: [{ to: usdc, data }, "latest"],
        });
        if (typeof usdcHex === "string") {
          usdcWei = BigInt(usdcHex);
        }
      } catch {
        usdcWei = null;
      }
    }

    return {
      address,
      ethWei: BigInt(ethHex),
      usdcWei,
      fetchedAtMs: Date.now(),
    };
  }
}

export function diffWalletBalanceSnapshots(
  before: WalletBalanceSnapshot | null,
  after: WalletBalanceSnapshot | null,
): WalletBalanceDelta {
  return {
    ethWeiDelta: before && after ? after.ethWei - before.ethWei : null,
    usdcWeiDelta: before && after && before.usdcWei !== null && after.usdcWei !== null ? after.usdcWei - before.usdcWei : null,
  };
}

export function canPostRequestWithBalance(snapshot: WalletBalanceSnapshot | null) {
  if (!snapshot) return false;
  return snapshot.ethWei >= MIN_POST_REQUEST_GAS_BUFFER_WEI;
}

export function canHireOfferWithBalance(input: {
  snapshot: WalletBalanceSnapshot | null;
  paymentToken: string;
  offerAmountWei: bigint;
}) {
  const { snapshot, paymentToken, offerAmountWei } = input;
  if (!snapshot) return false;

  if (isEthToken(paymentToken)) {
    return snapshot.ethWei >= offerAmountWei + MIN_HIRE_GAS_BUFFER_WEI;
  }

  if (snapshot.usdcWei === null) return false;
  return snapshot.usdcWei >= offerAmountWei && snapshot.ethWei >= MIN_HIRE_GAS_BUFFER_WEI;
}

export function formatWalletFundingSummary(snapshot: WalletBalanceSnapshot | null) {
  if (!snapshot) return "Balance unavailable";
  const eth = Number(formatUnits(snapshot.ethWei, 18)).toFixed(6);
  const usdc = snapshot.usdcWei === null ? "-" : Number(formatUnits(snapshot.usdcWei, 6)).toFixed(2);
  return `${eth} ETH, ${usdc} USDC`;
}

export function tokenBalanceForSnapshot(snapshot: WalletBalanceSnapshot | null, token: string) {
  if (!snapshot) return null;
  if (isEthToken(token)) return snapshot.ethWei;
  const usdc = usdcForChain();
  if (usdc && token.toLowerCase() === usdc.toLowerCase()) return snapshot.usdcWei;
  if (token.toLowerCase() === ETH_TOKEN.toLowerCase()) return snapshot.ethWei;
  return null;
}
