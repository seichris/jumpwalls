"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logUiAction } from "@/lib/infofi-ux";

function shortHash(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function PrivyConnectWalletButton() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [error, setError] = React.useState<string | null>(null);

  const privyWalletAddress = React.useMemo(() => {
    const wallet = wallets.find((candidate) => candidate.type === "ethereum");
    if (!wallet || typeof wallet.address !== "string") return null;
    return wallet.address;
  }, [wallets]);

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
        Privy {shortHash(privyWalletAddress)}
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

