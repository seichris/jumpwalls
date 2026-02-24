"use client";

import * as React from "react";
import { PrivyProvider, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";

import { isPrivyFeatureEnabled } from "@/lib/privy";
import { setBridgedWalletState, type Eip1193Provider } from "@/lib/wallet";

function parsePrivyChainId(input: string | null | undefined): number | null {
  if (!input) return null;
  if (input.startsWith("eip155:")) {
    const parsed = Number.parseInt(input.slice("eip155:".length), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (input.startsWith("0x")) {
    const parsed = Number.parseInt(input, 16);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function PrivyWalletBridge() {
  const { wallets, ready } = useWallets();

  React.useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    async function sync() {
      if (!ready) {
        setBridgedWalletState({ address: null, chainId: null, provider: null });
        return;
      }

      const wallet = wallets.find((candidate) => candidate.type === "ethereum") || null;
      if (!wallet) {
        setBridgedWalletState({ address: null, chainId: null, provider: null });
        return;
      }

      const provider = (await wallet.getEthereumProvider()) as Eip1193Provider;
      if (cancelled) return;

      const push = (next: { address: Address | null; chainId: number | null }) => {
        setBridgedWalletState({
          address: next.address,
          chainId: next.chainId,
          provider,
        });
      };

      const initialChain = parsePrivyChainId(wallet.chainId);
      let currentAddress = wallet.address as Address;
      let currentChainId = initialChain;
      push({
        address: currentAddress,
        chainId: initialChain,
      });

      const onAccountsChanged = (accountsUnknown: unknown) => {
        const list = Array.isArray(accountsUnknown) ? accountsUnknown : [];
        const first = typeof list[0] === "string" ? (list[0] as Address) : null;
        currentAddress = first || currentAddress;
        push({ address: first, chainId: currentChainId });
      };
      const onChainChanged = (chainUnknown: unknown) => {
        const chainHex = typeof chainUnknown === "string" ? chainUnknown : "";
        const parsed = parsePrivyChainId(chainHex);
        currentChainId = parsed;
        push({ address: currentAddress, chainId: parsed });
      };

      provider.on?.("accountsChanged", onAccountsChanged);
      provider.on?.("chainChanged", onChainChanged);
      cleanup = () => {
        provider.removeListener?.("accountsChanged", onAccountsChanged);
        provider.removeListener?.("chainChanged", onChainChanged);
      };
    }

    sync().catch(() => {
      if (!cancelled) {
        setBridgedWalletState({ address: null, chainId: null, provider: null });
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
      setBridgedWalletState({ address: null, chainId: null, provider: null });
    };
  }, [ready, wallets]);

  return null;
}

export function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  const appId = (process.env.NEXT_PUBLIC_PRIVY_APP_ID || "").trim();
  const clientId = (process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || "").trim();

  if (!isPrivyFeatureEnabled() || !appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId || undefined}
      config={{
        loginMethods: ["wallet", "email"],
        appearance: { walletChainType: "ethereum-only" },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
      }}
    >
      <PrivyWalletBridge />
      {children}
    </PrivyProvider>
  );
}
