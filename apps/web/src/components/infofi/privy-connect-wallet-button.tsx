"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { CreditCard } from "lucide-react";
import * as React from "react";
import { formatUnits, type Address } from "viem";

import { PrivyFundWalletDialog, type PrivyFundingOutcome } from "@/components/infofi/privy-fund-wallet-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logUiAction } from "@/lib/infofi-ux";
import { readWalletBalanceSnapshot, type WalletBalanceSnapshot } from "@/lib/wallet-balance";

function fnv1a(input: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function walletIdenticon(address: string) {
  const seed = fnv1a(address.toLowerCase());
  const random = mulberry32(seed);
  const hue = seed % 360;
  const fill = `hsl(${hue} 65% 45%)`;
  const accent = `hsl(${(hue + 38) % 360} 70% 60%)`;
  const background = `hsl(${(hue + 210) % 360} 22% 18%)`;

  const cells: Array<{ x: number; y: number; accent: boolean }> = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      if (random() < 0.45) continue;
      const useAccent = random() > 0.78;
      cells.push({ x, y, accent: useAccent });
      if (x !== 2) {
        cells.push({ x: 4 - x, y, accent: useAccent });
      }
    }
  }

  return { fill, accent, background, cells };
}

function WalletIdenticon({ address }: { address: string }) {
  const icon = React.useMemo(() => walletIdenticon(address), [address]);
  return (
    <svg viewBox="0 0 5 5" className="h-4 w-4 rounded-sm border border-border/60 bg-background" aria-hidden="true">
      <rect x={0} y={0} width={5} height={5} fill={icon.background} />
      {icon.cells.map((cell, index) => (
        <rect key={`${cell.x}-${cell.y}-${index}`} x={cell.x} y={cell.y} width={1} height={1} fill={cell.accent ? icon.accent : icon.fill} />
      ))}
    </svg>
  );
}

type PrivyConnectWalletButtonProps = {
  expectedChainId?: number;
  walletAddress?: Address | null;
  walletChainId?: number | null;
  onFundingOutcome?: (outcome: PrivyFundingOutcome) => void;
};

export function PrivyConnectWalletButton({ expectedChainId, walletAddress, walletChainId, onFundingOutcome }: PrivyConnectWalletButtonProps) {
  const { ready, authenticated, login, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const [error, setError] = React.useState<string | null>(null);
  const [balanceSummary, setBalanceSummary] = React.useState("Loading balances...");
  const [balanceSnapshot, setBalanceSnapshot] = React.useState<WalletBalanceSnapshot | null>(null);

  const privyWalletAddress = React.useMemo(() => {
    const wallet = wallets.find((candidate) => candidate.type === "ethereum");
    if (!wallet || typeof wallet.address !== "string") return null;
    return wallet.address;
  }, [wallets]);

  React.useEffect(() => {
    if (!privyWalletAddress) {
      setBalanceSummary("Loading balances...");
      setBalanceSnapshot(null);
      return;
    }

    let cancelled = false;
    async function refreshBalances() {
      try {
        const snapshot = await readWalletBalanceSnapshot(privyWalletAddress as Address);
        if (!cancelled) {
          setBalanceSnapshot(snapshot);
          const eth = Number(formatUnits(snapshot.ethWei, 18)).toFixed(6);
          const usdc = snapshot.usdcWei === null ? "-" : Number(formatUnits(snapshot.usdcWei, 6)).toFixed(2);
          setBalanceSummary(`${eth} ETH, ${usdc} USDC`);
        }
      } catch {
        if (!cancelled) {
          setBalanceSnapshot(null);
          setBalanceSummary("Balance unavailable");
        }
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
        Wallet loading
      </Button>
    );
  }

  if (privyWalletAddress) {
    const resolvedWalletAddress = walletAddress || (privyWalletAddress as Address);
    const canShowFundingAction = typeof expectedChainId === "number";
    const usdcIsZero = balanceSnapshot?.usdcWei === 0n;
    const ethDisplay = balanceSnapshot ? Number(formatUnits(balanceSnapshot.ethWei, 18)).toFixed(6) : null;
    const usdcDisplay = balanceSnapshot
      ? balanceSnapshot.usdcWei === null
        ? "-"
        : Number(formatUnits(balanceSnapshot.usdcWei, 6)).toFixed(2)
      : null;
    const fundTriggerClassName = [
      "inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      usdcIsZero ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground",
    ].join(" ");
    const renderFundingTrigger = ({ disabled, openDialog }: { disabled: boolean; openDialog: () => void }) => (
      <button
        type="button"
        title="Fund Wallet With Card"
        aria-label="Fund Wallet With Card"
        className={fundTriggerClassName}
        disabled={disabled}
        onClick={openDialog}
      >
        <CreditCard className="h-3.5 w-3.5" />
      </button>
    );

    return (
      <Badge
        variant="secondary"
        className="group h-9 px-3 font-mono gap-1.5 whitespace-nowrap border-0 bg-transparent hover:bg-transparent"
      >
        <span className="inline-flex items-center gap-1.5">
          <WalletIdenticon address={privyWalletAddress} />
          <span className="hidden text-xs group-hover:inline group-focus-within:inline">{privyWalletAddress}</span>
        </span>
        {balanceSnapshot ? (
          <span className="inline-flex items-center gap-1">
            <span className="hidden group-hover:inline group-focus-within:inline">{ethDisplay} ETH,</span>
            <span className="inline-flex items-center gap-1">
              <span>{usdcDisplay} USDC</span>
              {canShowFundingAction ? (
                <PrivyFundWalletDialog
                  walletAddress={resolvedWalletAddress}
                  walletEthWei={balanceSnapshot.ethWei}
                  walletChainId={walletChainId}
                  expectedChainId={expectedChainId}
                  onFundingOutcome={onFundingOutcome}
                  renderTrigger={renderFundingTrigger}
                />
              ) : null}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <span>{balanceSummary}</span>
            {canShowFundingAction ? (
              <PrivyFundWalletDialog
                walletAddress={resolvedWalletAddress}
                walletEthWei={null}
                walletChainId={walletChainId}
                expectedChainId={expectedChainId}
                onFundingOutcome={onFundingOutcome}
                renderTrigger={renderFundingTrigger}
              />
            ) : null}
          </span>
        )}
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
            if (authenticated) {
              connectWallet();
            } else {
              login();
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to open wallet prompt.";
            setError(message);
            logUiAction("privy_wallet_connect_failed", { message });
          }
        }}
      >
        {authenticated ? "Unlock wallet" : "Connect Wallet"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
