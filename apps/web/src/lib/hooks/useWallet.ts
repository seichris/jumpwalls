import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  getBridgedWalletState,
  getInjectedEthereum,
  getWalletProviderPreference,
  type WalletProviderPreference,
  setWalletProviderPreference,
  subscribeWalletProviderPreference,
  subscribeBridgedWalletState,
} from "../wallet";

export function useWallet() {
  const [injectedAddress, setInjectedAddress] = useState<Address | null>(null);
  const [injectedChainId, setInjectedChainId] = useState<number | null>(null);
  const [bridgedAddress, setBridgedAddress] = useState<Address | null>(getBridgedWalletState().address);
  const [bridgedChainId, setBridgedChainId] = useState<number | null>(getBridgedWalletState().chainId);
  const [providerPreference, setProviderPreferenceState] = useState<WalletProviderPreference>(getWalletProviderPreference());
  const hasInjectedProvider = Boolean(getInjectedEthereum()?.request);
  const [hasBridgedProvider, setHasBridgedProvider] = useState(Boolean(getBridgedWalletState().provider?.request));
  const hasProvider = hasInjectedProvider || hasBridgedProvider;

  const activeWalletSource =
    providerPreference === "injected"
      ? injectedAddress
        ? "injected"
        : bridgedAddress
          ? "bridged"
          : null
      : bridgedAddress
        ? "bridged"
        : injectedAddress
          ? "injected"
          : null;

  const address = activeWalletSource === "injected" ? injectedAddress : activeWalletSource === "bridged" ? bridgedAddress : null;
  const chainId =
    activeWalletSource === "injected" ? injectedChainId : activeWalletSource === "bridged" ? bridgedChainId : null;

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
    return subscribeWalletProviderPreference((next) => {
      setProviderPreferenceState(next);
    });
  }, []);

  useEffect(() => {
    if (providerPreference === "injected" && injectedAddress) return;
    if (providerPreference === "bridged" && bridgedAddress) return;

    if (providerPreference === "injected" && bridgedAddress) {
      setWalletProviderPreference("bridged");
      return;
    }
    if (providerPreference === "bridged" && injectedAddress) {
      setWalletProviderPreference("injected");
      return;
    }

    if (!injectedAddress && !bridgedAddress) {
      if (hasInjectedProvider) {
        setWalletProviderPreference("injected");
        return;
      }
      if (hasBridgedProvider) {
        setWalletProviderPreference("bridged");
      }
      return;
    }
  }, [bridgedAddress, hasBridgedProvider, hasInjectedProvider, injectedAddress, providerPreference]);

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

  const setProviderPreference = useCallback((next: WalletProviderPreference) => {
    setWalletProviderPreference(next);
  }, []);

  const switchChain = useCallback(async (nextChainId: number) => {
    const injected = getInjectedEthereum();
    const bridged = getBridgedWalletState().provider;
    const eth =
      activeWalletSource === "bridged"
        ? bridged || injected
        : activeWalletSource === "injected"
          ? injected || bridged
          : injected || bridged;
    if (!eth?.request) throw new Error("No wallet provider found");
    const hex = `0x${nextChainId.toString(16)}`;
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  }, [activeWalletSource]);

  return {
    address,
    chainId,
    hasProvider,
    hasInjectedProvider,
    hasBridgedProvider,
    injectedAddress,
    injectedChainId,
    bridgedAddress,
    bridgedChainId,
    activeWalletSource,
    providerPreference,
    setProviderPreference,
    connect,
    switchChain,
  };
}
