import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  getBridgedWalletState,
  getInjectedEthereum,
  setWalletProviderPreference,
  subscribeBridgedWalletState,
} from "../wallet";

export function useWallet() {
  const [injectedAddress, setInjectedAddress] = useState<Address | null>(null);
  const [injectedChainId, setInjectedChainId] = useState<number | null>(null);
  const [bridgedAddress, setBridgedAddress] = useState<Address | null>(getBridgedWalletState().address);
  const [bridgedChainId, setBridgedChainId] = useState<number | null>(getBridgedWalletState().chainId);
  const [hasBridgedProvider, setHasBridgedProvider] = useState(Boolean(getBridgedWalletState().provider?.request));
  const hasProvider = Boolean(getInjectedEthereum()?.request || hasBridgedProvider);

  const address = injectedAddress ?? bridgedAddress;
  const chainId = injectedAddress ? injectedChainId : bridgedChainId;

  useEffect(() => {
    const eth = getInjectedEthereum();
    if (!eth?.request) return;

    let cancelled = false;

    eth
      .request({ method: "eth_chainId" })
      .then((cid) => {
        if (cancelled) return;
        const asString = typeof cid === "string" ? cid : "";
        const parsed = Number.parseInt(asString, 16);
        setInjectedChainId(Number.isFinite(parsed) ? parsed : null);
      })
      .catch(() => {
        if (cancelled) return;
        setInjectedChainId(null);
      });

    eth
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (cancelled) return;
        const list = Array.isArray(accounts) ? accounts : [];
        const first = typeof list[0] === "string" ? (list[0] as Address) : null;
        setInjectedAddress(first);
      })
      .catch(() => {
        if (cancelled) return;
        setInjectedAddress(null);
      });

    const handleAccountsChanged = (accountsUnknown: unknown) => {
      const list = Array.isArray(accountsUnknown) ? accountsUnknown : [];
      const first = typeof list[0] === "string" ? (list[0] as Address) : null;
      setInjectedAddress(first);
    };

    const handleChainChanged = (cidUnknown: unknown) => {
      const cid = typeof cidUnknown === "string" ? cidUnknown : "";
      const parsed = Number.parseInt(cid, 16);
      setInjectedChainId(Number.isFinite(parsed) ? parsed : null);
    };

    eth.on?.("accountsChanged", handleAccountsChanged);
    eth.on?.("chainChanged", handleChainChanged);
    return () => {
      cancelled = true;
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
      eth.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  useEffect(() => {
    return subscribeBridgedWalletState((state) => {
      setBridgedAddress(state.address);
      setBridgedChainId(state.chainId);
      setHasBridgedProvider(Boolean(state.provider?.request));
    });
  }, []);

  useEffect(() => {
    if (injectedAddress) {
      setWalletProviderPreference("injected");
      return;
    }
    if (bridgedAddress) {
      setWalletProviderPreference("bridged");
      return;
    }
    setWalletProviderPreference("injected");
  }, [injectedAddress, bridgedAddress]);

  const connect = useCallback(async () => {
    const eth = getInjectedEthereum();
    if (!eth?.request) throw new Error("No injected wallet found");
    const accountsUnknown = await eth.request({ method: "eth_requestAccounts" });
    const accounts = Array.isArray(accountsUnknown) ? accountsUnknown : [];
    const next = (typeof accounts[0] === "string" ? (accounts[0] as Address) : null) as Address | null;
    setInjectedAddress(next);
    if (next) setWalletProviderPreference("injected");
    return next;
  }, []);

  const switchChain = useCallback(async (nextChainId: number) => {
    const injected = getInjectedEthereum();
    const bridged = getBridgedWalletState().provider;
    const eth = injectedAddress ? injected : bridged || injected;
    if (!eth?.request) throw new Error("No wallet provider found");
    const hex = `0x${nextChainId.toString(16)}`;
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  }, [injectedAddress]);

  return { address, chainId, hasProvider, connect, switchChain };
}
