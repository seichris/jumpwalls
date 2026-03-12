"use client";

import { parseUnits } from "viem";

export type FastSetAccount = {
  address: string;
  publicKey: string;
};

export type FastSetTransferCertificate = {
  envelope: {
    transaction: unknown;
    signature: unknown;
  };
  signatures: Array<[number[], number[]]>;
};

export type FastSetWalletApi = {
  connect: (options?: { permissions: string[] }) => Promise<boolean>;
  getAccounts: () => Promise<FastSetAccount[]>;
  signMessage: (params: { message: number[]; account: FastSetAccount }) => Promise<{ signature: string; messageBytes: string }>;
  transfer: (params: {
    amount: string;
    recipient: string;
    account: FastSetAccount;
    tokenId?: string;
  }) => Promise<FastSetTransferCertificate>;
  disconnect?: () => Promise<boolean>;
};

declare global {
  interface Window {
    fastset?: FastSetWalletApi;
  }
}

const FASTSET_PERMISSIONS = ["viewAccount", "suggestTransactions"];

function fastsetWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function getFastSetWallet() {
  return fastsetWindow()?.fastset ?? null;
}

export function isFastWalletAddress(value: string) {
  return /^(fast|set)1[0-9ac-hj-np-z]{38,87}$/i.test(value.trim());
}

export function canonicalFastAddress(value: string) {
  return value.trim().toLowerCase().replace(/^set1/i, "fast1");
}

export function normalizeFastHex(value: string) {
  return value.trim().toLowerCase().replace(/^0x/i, "");
}

export function fastAmountToTransferHex(amount: string, decimals = 6) {
  const atomic = parseUnits(amount, decimals);
  return `0x${atomic.toString(16)}`;
}

export async function waitForFastSetWallet(timeoutMs = 2500) {
  const wallet = getFastSetWallet();
  if (wallet) return wallet;

  const win = fastsetWindow();
  if (!win) return null;

  return await new Promise<FastSetWalletApi | null>((resolve) => {
    const timer = window.setTimeout(() => {
      win.removeEventListener("fastset#initialized", onReady as EventListener);
      resolve(getFastSetWallet());
    }, timeoutMs);

    const onReady = () => {
      window.clearTimeout(timer);
      win.removeEventListener("fastset#initialized", onReady as EventListener);
      resolve(getFastSetWallet());
    };

    win.addEventListener("fastset#initialized", onReady as EventListener, { once: true });
  });
}

export async function connectFastSetWallet() {
  const wallet = await waitForFastSetWallet();
  if (!wallet) throw new Error("FastSet wallet extension not found.");
  const connected = await wallet.connect({ permissions: FASTSET_PERMISSIONS });
  if (!connected) throw new Error("FastSet wallet connection was rejected.");
  const accounts = await wallet.getAccounts();
  const account = accounts[0];
  if (!account) throw new Error("FastSet wallet returned no accounts.");
  if (!isFastWalletAddress(account.address)) throw new Error("FastSet wallet returned an invalid FAST address.");
  const publicKey = normalizeFastHex(account.publicKey);
  if (!/^[a-f0-9]{64}$/.test(publicKey)) {
    throw new Error("FastSet wallet returned an invalid FAST public key.");
  }
  return {
    wallet,
    account: {
      address: canonicalFastAddress(account.address),
      publicKey,
    },
  };
}

export async function signWithFastSet(input: { wallet: FastSetWalletApi; account: FastSetAccount; message: string }) {
  const messageBytes = Array.from(new TextEncoder().encode(input.message));
  const result = await input.wallet.signMessage({
    message: messageBytes,
    account: input.account,
  });
  return {
    signature: normalizeFastHex(result.signature),
    messageBytes: normalizeFastHex(result.messageBytes),
  };
}

export async function transferWithFastSet(input: {
  wallet: FastSetWalletApi;
  account: FastSetAccount;
  recipient: string;
  amount: string;
  decimals: number;
  tokenId: string;
}) {
  return await input.wallet.transfer({
    recipient: canonicalFastAddress(input.recipient),
    amount: fastAmountToTransferHex(input.amount, input.decimals),
    account: input.account,
    tokenId: input.tokenId,
  });
}
