"use client";

import { useFundWallet, usePrivy, useWallets, type FundWalletConfig } from "@privy-io/react-auth";
import * as React from "react";
import type { Address } from "viem";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { logUiAction } from "@/lib/infofi-ux";
import { defaultPrivyFundingAmountUsd, isPrivyFeatureEnabled, isPrivyFundingSupportedChain } from "@/lib/privy";
import { buildPrivyFundingOptions, classifyFundingError, isPositiveNumberString, type FundingErrorCode } from "@/lib/privy-funding";
import { errorMessage } from "@/lib/utils";
import {
  diffWalletBalanceSnapshots,
  formatWalletFundingSummary,
  readWalletBalanceSnapshot,
  type WalletBalanceDelta,
  type WalletBalanceSnapshot,
} from "@/lib/wallet-balance";

type FundingStatus = "completed" | "cancelled" | "error";

export type PrivyFundingOutcome = {
  status: FundingStatus;
  address: Address | null;
  asset: "ETH" | "USDC";
  amountUsd: string;
  balancesBefore: WalletBalanceSnapshot | null;
  balancesAfter: WalletBalanceSnapshot | null;
  balanceDelta: WalletBalanceDelta;
  errorCode?: FundingErrorCode;
  errorMessage?: string;
};

function hasPositiveDelta(delta: WalletBalanceDelta) {
  if (delta.ethWeiDelta !== null && delta.ethWeiDelta > 0n) return true;
  if (delta.usdcWeiDelta !== null && delta.usdcWeiDelta > 0n) return true;
  return false;
}

export function PrivyFundWalletDialog({
  walletAddress,
  walletChainId,
  expectedChainId,
  onFundingOutcome,
}: {
  walletAddress: Address | null;
  walletChainId?: number | null;
  expectedChainId: number;
  onFundingOutcome?: (outcome: PrivyFundingOutcome) => void;
}) {
  const privyEnabled = isPrivyFeatureEnabled();
  const chainSupported = isPrivyFundingSupportedChain(expectedChainId);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet({
    onUserExited: ({ address, chain, fundingMethod, balance }) => {
      logUiAction("privy_funding_exited", {
        address,
        chainId: chain.id,
        fundingMethod: fundingMethod || null,
        balance: balance?.toString() || null,
      });
    },
  });

  const privyWalletAddress = React.useMemo(() => {
    const wallet = wallets.find((candidate) => candidate.type === "ethereum");
    if (!wallet || typeof wallet.address !== "string") return null;
    return wallet.address as Address;
  }, [wallets]);
  const targetAddress = walletAddress || privyWalletAddress;
  const walletChainMismatch = walletChainId !== null && walletChainId !== expectedChainId;

  const [open, setOpen] = React.useState(false);
  const [asset, setAsset] = React.useState<"ETH" | "USDC">("ETH");
  const [amountUsd, setAmountUsd] = React.useState(defaultPrivyFundingAmountUsd());
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setNotice(null);
  }, [open]);

  if (!privyEnabled) return null;

  const disabled = !chainSupported || submitting || walletChainMismatch;

  async function readBalancesWithRetry(address: Address, before: WalletBalanceSnapshot | null) {
    let latest: WalletBalanceSnapshot | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        latest = await readWalletBalanceSnapshot(address);
      } catch {
        latest = null;
      }
      if (!before || !latest) break;
      const delta = diffWalletBalanceSnapshots(before, latest);
      if (hasPositiveDelta(delta)) break;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    }
    return latest;
  }

  async function submit() {
    if (!chainSupported) {
      setError(`Card funding is not enabled for chain ${expectedChainId}.`);
      logUiAction("privy_funding_blocked", { reason: "chain_unsupported", expectedChainId });
      return;
    }
    if (walletChainMismatch) {
      setError(`Switch wallet to chain ${expectedChainId} before funding.`);
      logUiAction("privy_funding_blocked", { reason: "wallet_chain_mismatch", expectedChainId, walletChainId });
      return;
    }
    if (!ready) {
      setError("Privy is still initializing. Try again in a moment.");
      logUiAction("privy_funding_blocked", { reason: "privy_not_ready" });
      return;
    }
    if (!isPositiveNumberString(amountUsd)) {
      setError("Enter a valid USD amount greater than 0.");
      logUiAction("privy_funding_blocked", { reason: "invalid_amount", amountUsd });
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (!authenticated) {
        logUiAction("privy_funding_login_requested");
        login();
        setError("Complete Privy login, then click Fund again.");
        return;
      }
      if (!targetAddress) {
        setError("No connected Ethereum wallet found. Connect or create a wallet in Privy, then retry.");
        logUiAction("privy_funding_blocked", { reason: "wallet_missing" });
        return;
      }

      const options: FundWalletConfig = buildPrivyFundingOptions({
        amountUsd,
        asset,
        chainId: expectedChainId,
      });
      const balancesBefore = await readWalletBalanceSnapshot(targetAddress).catch(() => null);
      logUiAction("privy_funding_started", {
        address: targetAddress,
        chainId: expectedChainId,
        asset,
        amountUsd: amountUsd.trim(),
      });

      const result = await fundWallet({
        address: targetAddress,
        options,
      });

      const balancesAfter = await readBalancesWithRetry(targetAddress, balancesBefore);
      const balanceDelta = diffWalletBalanceSnapshots(balancesBefore, balancesAfter);

      if (result.status === "completed") {
        const summary = formatWalletFundingSummary(balancesAfter);
        if (hasPositiveDelta(balanceDelta)) {
          setNotice(`Funding flow completed. Updated on-chain balance: ${summary}.`);
        } else {
          setNotice(`Funding flow completed. Current on-chain balance: ${summary}. Funds can take a few minutes to arrive.`);
        }
        logUiAction("privy_funding_completed", {
          address: targetAddress,
          chainId: expectedChainId,
          asset,
          amountUsd: amountUsd.trim(),
          balanceAfter: summary,
          ethWeiDelta: balanceDelta.ethWeiDelta?.toString() || null,
          usdcWeiDelta: balanceDelta.usdcWeiDelta?.toString() || null,
        });
        onFundingOutcome?.({
          status: "completed",
          address: targetAddress,
          asset,
          amountUsd: amountUsd.trim(),
          balancesBefore,
          balancesAfter,
          balanceDelta,
        });
        setOpen(false);
        return;
      }

      const summary = formatWalletFundingSummary(balancesAfter);
      setNotice(`Funding flow was cancelled before completion. Current on-chain balance: ${summary}.`);
      logUiAction("privy_funding_cancelled", {
        address: targetAddress,
        chainId: expectedChainId,
        asset,
        amountUsd: amountUsd.trim(),
        balanceAfter: summary,
      });
      onFundingOutcome?.({
        status: "cancelled",
        address: targetAddress,
        asset,
        amountUsd: amountUsd.trim(),
        balancesBefore,
        balancesAfter,
        balanceDelta,
      });
      setOpen(false);
    } catch (err: unknown) {
      const classified = classifyFundingError(err);
      setError(classified.message || errorMessage(err, "Funding flow failed."));
      logUiAction("privy_funding_failed", {
        code: classified.code,
        message: classified.rawMessage,
        chainId: expectedChainId,
        asset,
        amountUsd: amountUsd.trim(),
      });
      onFundingOutcome?.({
        status: "error",
        address: targetAddress,
        asset,
        amountUsd: amountUsd.trim(),
        balancesBefore: null,
        balancesAfter: null,
        balanceDelta: {
          ethWeiDelta: null,
          usdcWeiDelta: null,
        },
        errorCode: classified.code,
        errorMessage: classified.rawMessage,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          logUiAction("privy_funding_opened", {
            expectedChainId,
            walletAddress: targetAddress || null,
            walletChainId,
          });
        }}
        disabled={disabled}
      >
        Fund With Card
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fund Wallet</DialogTitle>
            <DialogDescription>
              Buy funds with card via Privy. Destination address:{" "}
              <span className="font-mono text-xs">{targetAddress || "-"}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Asset</Label>
                <Select value={asset} onValueChange={(value) => setAsset(value as "ETH" | "USDC")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="USDC">USDC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fund-usd-amount">USD Amount</Label>
                <Input
                  id="fund-usd-amount"
                  inputMode="decimal"
                  placeholder="50"
                  value={amountUsd}
                  onChange={(event) => setAmountUsd(event.target.value)}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Funding is processed by Privy onramp providers. Settlement time may vary by payment method.
            </p>
            {walletChainMismatch ? (
              <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                Wallet is on chain {walletChainId}. Switch to {expectedChainId} before funding.
              </p>
            ) : null}

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                {notice}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              Close
            </Button>
            <Button onClick={submit} disabled={submitting || !chainSupported || walletChainMismatch}>
              {submitting ? "Starting..." : authenticated ? "Fund Now" : "Login & Fund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
