"use client";

import { parseUnits } from "viem";

export const FAST_SETTLEMENT_TOKEN = "SETUSDC";
export const FAST_SETTLEMENT_TOKEN_DECIMALS = 6;
export const FAST_SETTLEMENT_TOKEN_ID = "0x1e744900021182b293538bb6685b77df095e351364d550021614ce90c8ab9e0a";

export type FastWalletAccount = {
  address: string;
  publicKey: string;
};

export type FastWalletTransferCertificate = {
  envelope: {
    transaction: unknown;
    signature: unknown;
  };
  signatures: Array<[number[], number[]]>;
};

type FastWalletApi = {
  connect: (options?: { permissions: string[] }) => Promise<boolean>;
  getAccounts: () => Promise<FastWalletAccount[]>;
  signMessage: (params: { message: number[]; account: FastWalletAccount }) => Promise<{ signature: string; messageBytes: string }>;
  transfer: (params: {
    amount: string;
    recipient: string;
    account: FastWalletAccount;
    tokenId?: string;
  }) => Promise<FastWalletTransferCertificate>;
  disconnect?: () => Promise<boolean>;
};

declare global {
  interface Window {
    fastset?: FastWalletApi;
  }
}

const FASTSET_PERMISSIONS = ["viewAccount", "suggestTransactions"];

function fastsetWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function getFastWallet() {
  return fastsetWindow()?.fastset ?? null;
}

export function isFastWalletAddress(value: string) {
  return /^(fast|set)1[0-9ac-hj-np-z]{38,87}$/i.test(value.trim());
}

export function canonicalFastAddress(value: string) {
  return value.trim().toLowerCase().replace(/^set1/i, "fast1");
}

export async function waitForFastWallet(timeoutMs = 2500) {
  const wallet = getFastWallet();
  if (wallet) return wallet;

  const win = fastsetWindow();
  if (!win) return null;

  return await new Promise<FastWalletApi | null>((resolve) => {
    const timer = window.setTimeout(() => {
      win.removeEventListener("fastset#initialized", onReady as EventListener);
      resolve(getFastWallet());
    }, timeoutMs);

    const onReady = () => {
      window.clearTimeout(timer);
      win.removeEventListener("fastset#initialized", onReady as EventListener);
      resolve(getFastWallet());
    };

    win.addEventListener("fastset#initialized", onReady as EventListener, { once: true });
  });
}

export async function connectFastWallet() {
  const wallet = await waitForFastWallet();
  if (!wallet) throw new Error("FastSet wallet extension not found.");
  const connected = await wallet.connect({ permissions: FASTSET_PERMISSIONS });
  if (!connected) throw new Error("FastSet wallet connection was rejected.");
  const accounts = await wallet.getAccounts();
  const account = accounts[0];
  if (!account) throw new Error("FastSet wallet returned no accounts.");
  if (!isFastWalletAddress(account.address)) throw new Error("FastSet wallet returned an invalid FAST address.");
  return {
    wallet,
    account: {
      address: canonicalFastAddress(account.address),
      publicKey: account.publicKey.trim().toLowerCase(),
    },
  };
}

export async function signFastMessage(input: { wallet: FastWalletApi; account: FastWalletAccount; message: string }) {
  const messageBytes = Array.from(new TextEncoder().encode(input.message));
  const result = await input.wallet.signMessage({
    message: messageBytes,
    account: input.account,
  });
  return {
    signature: result.signature.trim().toLowerCase(),
    messageBytes: result.messageBytes.trim().toLowerCase(),
  };
}

export function fastAmountToTransferHex(amount: string) {
  const atomic = parseUnits(amount, FAST_SETTLEMENT_TOKEN_DECIMALS);
  return `0x${atomic.toString(16)}`;
}

export async function transferFast(input: {
  wallet: FastWalletApi;
  account: FastWalletAccount;
  recipient: string;
  amount: string;
}) {
  return await input.wallet.transfer({
    recipient: canonicalFastAddress(input.recipient),
    amount: fastAmountToTransferHex(input.amount),
    account: input.account,
    tokenId: FAST_SETTLEMENT_TOKEN_ID,
  });
}
