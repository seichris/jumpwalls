import { parseAbi } from "viem";
import { infoFiAbi } from "@infofi/shared";

export { infoFiAbi };

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
]);

export const gatewayWalletAbi = parseAbi([
  "function deposit(address token, uint256 value)"
]);
