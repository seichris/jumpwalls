"use client";

import { useFundWallet, usePrivy, useWallets, type FundWalletConfig } from "@privy-io/react-auth";
import * as React from "react";
import type { Address } from "viem";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultPrivyFundingAmountUsd, isPrivyFeatureEnabled, isPrivyFundingSupportedChain } from "@/lib/privy";
import { errorMessage } from "@/lib/utils";

function isPositiveNumberString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}

export function PrivyFundWalletDialog({
  walletAddress,
  expectedChainId,
}: {
  walletAddress: Address | null;
  expectedChainId: number;
}) {
  const privyEnabled = isPrivyFeatureEnabled();
  const chainSupported = isPrivyFundingSupportedChain(expectedChainId);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();

  const privyWalletAddress = React.useMemo(() => {
    const wallet = wallets.find((candidate) => candidate.type === "ethereum");
    if (!wallet || typeof wallet.address !== "string") return null;
    return wallet.address as Address;
  }, [wallets]);
  const targetAddress = walletAddress || privyWalletAddress;

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

  const disabled = !chainSupported || submitting;

  async function submit() {
    if (!chainSupported) {
      setError(`Card funding is not enabled for chain ${expectedChainId}.`);
      return;
    }
    if (!ready) {
      setError("Privy is still initializing. Try again in a moment.");
      return;
    }
    if (!isPositiveNumberString(amountUsd)) {
      setError("Enter a valid USD amount greater than 0.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (!authenticated) {
        login();
        setError("Complete Privy login, then click Fund again.");
        return;
      }
      if (!targetAddress) {
        setError("No connected Ethereum wallet found. Connect or create a wallet in Privy, then retry.");
        return;
      }

      const options: FundWalletConfig = {
        amount: amountUsd.trim(),
        asset: asset === "ETH" ? "native-currency" : "USDC",
        defaultFundingMethod: "card",
        card: { preferredProvider: "moonpay" },
      };

      const result = await fundWallet({
        address: targetAddress,
        options,
      });

      if (result.status === "completed") {
        setNotice("Funding flow completed. Funds can take a few minutes to arrive.");
        setOpen(false);
        return;
      }

      setNotice("Funding flow was cancelled before completion.");
    } catch (err: unknown) {
      setError(errorMessage(err, "Funding flow failed."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
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
            <Button onClick={submit} disabled={submitting || !chainSupported}>
              {submitting ? "Starting..." : authenticated ? "Fund Now" : "Login & Fund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
