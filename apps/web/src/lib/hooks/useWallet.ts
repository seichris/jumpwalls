import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function getEthereum(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const maybe = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return maybe ?? null;
}

export function useWallet() {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const hasProvider = Boolean(getEthereum()?.request);

  useEffect(() => {
    const eth = getEthereum();
    if (!eth?.request) return;

    let cancelled = false;

    eth
      .request({ method: "eth_chainId" })
      .then((cid) => {
        if (cancelled) return;
        const asString = typeof cid === "string" ? cid : "";
        const parsed = Number.parseInt(asString, 16);
        setChainId(Number.isFinite(parsed) ? parsed : null);
      })
      .catch(() => {
        if (cancelled) return;
        setChainId(null);
      });

    eth
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (cancelled) return;
        const list = Array.isArray(accounts) ? accounts : [];
        const first = typeof list[0] === "string" ? (list[0] as Address) : null;
        setAddress(first);
      })
      .catch(() => {
        if (cancelled) return;
        setAddress(null);
      });

    const handleAccountsChanged = (accountsUnknown: unknown) => {
      const list = Array.isArray(accountsUnknown) ? accountsUnknown : [];
      const first = typeof list[0] === "string" ? (list[0] as Address) : null;
      setAddress(first);
    };

    const handleChainChanged = (cidUnknown: unknown) => {
      const cid = typeof cidUnknown === "string" ? cidUnknown : "";
      const parsed = Number.parseInt(cid, 16);
      setChainId(Number.isFinite(parsed) ? parsed : null);
    };

    eth.on?.("accountsChanged", handleAccountsChanged);
    eth.on?.("chainChanged", handleChainChanged);
    return () => {
      cancelled = true;
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
      eth.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = getEthereum();
    if (!eth?.request) throw new Error("No injected wallet found");
    const accountsUnknown = await eth.request({ method: "eth_requestAccounts" });
    const accounts = Array.isArray(accountsUnknown) ? accountsUnknown : [];
    const next = (typeof accounts[0] === "string" ? (accounts[0] as Address) : null) as Address | null;
    setAddress(next);
    return next;
  }, []);

  const switchChain = useCallback(async (nextChainId: number) => {
    const eth = getEthereum();
    if (!eth?.request) throw new Error("No injected wallet found");
    const hex = `0x${nextChainId.toString(16)}`;
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  }, []);

  return { address, chainId, hasProvider, connect, switchChain };
}
