"use client";

import * as React from "react";
import type { Address } from "viem";

import { PrivyConnectWalletButton, type PrivyFundingOutcome } from "@/components/infofi/privy-connect-wallet-button";
import { RailLogo } from "@/components/infofi/rail-badge";
import { Button } from "@/components/ui/button";
import { useUserRail } from "@/components/providers/user-rail-provider";

function shortFastAddress(value: string | null | undefined) {
  if (!value) return "FAST";
  return `${value.slice(0, 9)}...${value.slice(-4)}`;
}

function railWrapperClass(active: boolean) {
  return [
    "rounded-md border bg-background/60 px-1 py-1 transition-colors",
    active ? "border-foreground shadow-sm" : "border-border/60",
  ].join(" ");
}

export function AccountRailControls({
  expectedChainId,
  walletAddress,
  walletChainId,
  onFundingOutcome,
}: {
  expectedChainId?: number;
  walletAddress?: Address | null;
  walletChainId?: number | null;
  onFundingOutcome?: (outcome: PrivyFundingOutcome) => void;
}) {
  const { activeRail, setActiveRail, bindFastWallet, fastBound, loadingProfile, profile } = useUserRail();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className={railWrapperClass(activeRail === "BASE")}
          onClickCapture={() => setActiveRail("BASE")}
        >
          <PrivyConnectWalletButton
            expectedChainId={expectedChainId}
            walletAddress={walletAddress}
            walletChainId={walletChainId}
            onFundingOutcome={onFundingOutcome}
          />
        </div>

        <div className={railWrapperClass(activeRail === "FAST")}>
          <Button
            variant="ghost"
            className="h-9 gap-2 px-3"
            disabled={!walletAddress || loadingProfile}
            onClick={async () => {
              setError(null);
              try {
                if (fastBound) {
                  setActiveRail("FAST");
                } else {
                  await bindFastWallet();
                }
              } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Failed to bind FAST wallet.");
              }
            }}
          >
            {loadingProfile ? (
              "FAST..."
            ) : fastBound ? (
              <span className="font-mono">{shortFastAddress(profile?.fastAddress)}</span>
            ) : (
              <>
                <span>Enable</span>
                <RailLogo rail="FAST" className="h-3.5 w-auto" />
              </>
            )}
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
