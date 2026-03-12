"use client";

import { BrowserFastProvider, BrowserFastWallet } from "./fast-browser";
import {
  canonicalFastAddress,
  fastAmountToTransferHex,
  isFastWalletAddress,
  normalizeFastHex,
  type FastSetAccount,
  type FastSetTransferCertificate,
} from "./fastset-transport";

export const FAST_SETTLEMENT_TOKEN = "fastUSDC";
export const FAST_SETTLEMENT_TOKEN_DECIMALS = 6;

export type FastWalletAccount = FastSetAccount;
export type FastWalletTransferCertificate = FastSetTransferCertificate;

export { BrowserFastProvider, BrowserFastWallet, canonicalFastAddress, fastAmountToTransferHex, isFastWalletAddress, normalizeFastHex };

export async function connectFastWallet() {
  const wallet = await new BrowserFastWallet().connect(new BrowserFastProvider());
  return {
    wallet,
    account: await wallet.exportKeys(),
  };
}

export async function signFastMessage(input: { wallet: BrowserFastWallet; account: FastWalletAccount; message: string }) {
  void input.account;
  const signed = await input.wallet.sign({ message: input.message });
  return {
    signature: signed.signature,
    messageBytes: signed.messageBytes,
  };
}

export async function transferFast(input: {
  wallet: BrowserFastWallet;
  account: FastWalletAccount;
  recipient: string;
  amount: string;
}) {
  void input.account;
  const sent = await input.wallet.send({
    to: input.recipient,
    amount: input.amount,
  });
  return sent.certificate as FastWalletTransferCertificate;
}
