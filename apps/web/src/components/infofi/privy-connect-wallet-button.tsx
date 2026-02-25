"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import * as React from "react";
import type { Address } from "viem";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logUiAction } from "@/lib/infofi-ux";
import { formatWalletFundingSummary, readWalletBalanceSnapshot } from "@/lib/wallet-balance";

function shortHash(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function PrivyConnectWalletButton() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [error, setError] = React.useState<string | null>(null);
  const [balanceSummary, setBalanceSummary] = React.useState("Loading balances...");

  const privyWalletAddress = React.useMemo(() => {
    const wallet = wallets.find((candidate) => candidate.type === "ethereum");
    if (!wallet || typeof wallet.address !== "string") return null;
    return wallet.address;
  }, [wallets]);

  React.useEffect(() => {
    if (!privyWalletAddress) {
      setBalanceSummary("Loading balances...");
      return;
    }

    let cancelled = false;
    async function refreshBalances() {
      try {
        const snapshot = await readWalletBalanceSnapshot(privyWalletAddress as Address);
        if (!cancelled) setBalanceSummary(formatWalletFundingSummary(snapshot));
      } catch {
        if (!cancelled) setBalanceSummary("Balance unavailable");
      }
    }

    void refreshBalances();
    const timer = window.setInterval(() => {
      void refreshBalances();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [privyWalletAddress]);

  if (!ready) {
    return (
      <Button variant="outline" disabled>
        Privy Loading...
      </Button>
    );
  }

  if (privyWalletAddress) {
    return (
      <Badge variant="secondary" className="font-mono">
        Wallet: {shortHash(privyWalletAddress)} | {balanceSummary}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        onClick={() => {
          setError(null);
          try {
            logUiAction("privy_wallet_connect_opened");
            login();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to start Privy login.";
            setError(message);
            logUiAction("privy_wallet_connect_failed", { message });
          }
        }}
      >
        {authenticated ? "Create Privy Wallet" : "Connect/Create Privy"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
