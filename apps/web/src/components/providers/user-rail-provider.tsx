"use client";

import * as React from "react";

import {
  bindFastWallet as bindFastWalletApi,
  createFastBindChallenge,
  createUserAuthChallenge,
  getUserProfile,
  verifyUserAuthChallenge,
} from "@/lib/api";
import { BrowserFastProvider, BrowserFastWallet } from "@/lib/fast-browser";
import { useWallet } from "@/lib/hooks/useWallet";
import type { InfoFiRail, InfoFiUserProfile, InfoFiUserProfileResponse } from "@/lib/infofi-types";
import { isPrivyFeatureEnabled } from "@/lib/privy";
import { getActiveEthereumProvider, getBridgedWalletState, type Eip1193Provider } from "@/lib/wallet";

type UserRailContextValue = {
  activeRail: InfoFiRail;
  setActiveRail: (next: InfoFiRail) => void;
  ensureRail: (next: InfoFiRail) => Promise<InfoFiRail>;
  refreshProfile: () => Promise<void>;
  ensureSession: () => Promise<InfoFiUserProfile | null>;
  bindFastWallet: () => Promise<InfoFiUserProfile>;
  loadingProfile: boolean;
  profile: InfoFiUserProfile | null;
  authenticatedForCurrentWallet: boolean;
  fastBound: boolean;
};

const ACTIVE_RAIL_STORAGE_KEY = "infofi-active-rail";
const UserRailContext = React.createContext<UserRailContextValue | null>(null);

function readStoredRail(): InfoFiRail {
  if (typeof window === "undefined") return "BASE";
  const value = window.localStorage.getItem(ACTIVE_RAIL_STORAGE_KEY);
  return value === "FAST" ? "FAST" : "BASE";
}

function writeStoredRail(next: InfoFiRail) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_RAIL_STORAGE_KEY, next);
}

async function signEvmMessage(address: string, message: string, provider?: Eip1193Provider | null) {
  const signer = provider ?? getActiveEthereumProvider();
  if (!signer?.request) throw new Error("Connect your EVM wallet first.");
  try {
    const result = await signer.request({
      method: "personal_sign",
      params: [message, address],
    });
    if (typeof result === "string" && result) return result;
  } catch {
    const fallback = await signer.request({
      method: "eth_sign",
      params: [address, message],
    });
    if (typeof fallback === "string" && fallback) return fallback;
  }
  throw new Error("Wallet did not return a signature.");
}

export function UserRailProvider({ children }: { children: React.ReactNode }) {
  const { address, bridgedAddress } = useWallet();
  const privyEnabled = isPrivyFeatureEnabled();
  const normalizedAddress = address?.toLowerCase() ?? null;
  const normalizedBridgedAddress = bridgedAddress?.toLowerCase() ?? null;
  const sessionAddress = privyEnabled ? normalizedBridgedAddress : normalizedAddress;
  const [activeRail, setActiveRailState] = React.useState<InfoFiRail>("BASE");
  const [profileResponse, setProfileResponse] = React.useState<InfoFiUserProfileResponse>({ authenticated: false, user: null });
  const [loadingProfile, setLoadingProfile] = React.useState(true);

  React.useEffect(() => {
    setActiveRailState(readStoredRail());
  }, []);

  const refreshProfile = React.useCallback(async () => {
    setLoadingProfile(true);
    try {
      const next = await getUserProfile();
      setProfileResponse(next);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  React.useEffect(() => {
    if (activeRail === "FAST" && (!sessionAddress || !profileResponse.user?.fastAddress || profileResponse.user.evmAddress !== sessionAddress)) {
      setActiveRailState("BASE");
      writeStoredRail("BASE");
    }
  }, [activeRail, profileResponse.user, sessionAddress]);

  const authenticatedForCurrentWallet = Boolean(
    sessionAddress &&
      profileResponse.authenticated &&
      profileResponse.user?.evmAddress?.toLowerCase() === sessionAddress
  );
  const profile = authenticatedForCurrentWallet ? profileResponse.user : null;
  const fastBound = Boolean(profile?.fastAddress);

  const ensureSession = React.useCallback(async () => {
    if (!sessionAddress) {
      throw new Error(privyEnabled ? "Connect the Privy wallet first." : "Connect your EVM wallet first.");
    }
    if (authenticatedForCurrentWallet && profile) return profile;

    const provider = privyEnabled ? getBridgedWalletState().provider : getActiveEthereumProvider();
    if (!provider?.request) {
      throw new Error(privyEnabled ? "Connect the Privy wallet first." : "Connect your EVM wallet first.");
    }

    const challenge = await createUserAuthChallenge(sessionAddress);
    const signature = await signEvmMessage(sessionAddress, challenge.messageToSign, provider);
    const session = await verifyUserAuthChallenge({
      address: sessionAddress,
      nonce: challenge.nonce,
      signature,
    });
    const next = await getUserProfile().catch(() => null);
    if (next?.authenticated && next.user?.evmAddress?.toLowerCase() === sessionAddress) {
      setProfileResponse(next);
      return next.user;
    }

    const fallbackUser = {
      evmAddress: session.evmAddress?.toLowerCase() || sessionAddress,
      fastAddress: profile?.fastAddress ?? null,
      fastPublicKey: profile?.fastPublicKey ?? null,
      fastBoundAt: profile?.fastBoundAt ?? null,
      updatedAt: new Date().toISOString(),
    };
    setProfileResponse({ authenticated: true, user: fallbackUser });
    void refreshProfile().catch(() => undefined);
    return fallbackUser;
  }, [authenticatedForCurrentWallet, privyEnabled, profile, refreshProfile, sessionAddress]);

  const bindFastWallet = React.useCallback(async () => {
    if (!sessionAddress) {
      throw new Error(privyEnabled ? "Connect the Privy wallet first." : "Connect your EVM wallet first.");
    }
    if (!authenticatedForCurrentWallet || !profile) {
      throw new Error(privyEnabled ? "Authenticate with the Privy wallet first." : "Authenticate with your EVM wallet first.");
    }

    const fastProvider = new BrowserFastProvider();
    const fastWallet = await new BrowserFastWallet().connect(fastProvider);
    const account = await fastWallet.exportKeys();
    const challenge = await createFastBindChallenge({
      address: account.address,
      publicKey: account.publicKey,
    });
    const signed = await fastWallet.sign({ message: challenge.messageToSign });
    const user = await bindFastWalletApi({
      address: challenge.address,
      publicKey: challenge.publicKey,
      nonce: challenge.nonce,
      signature: signed.signature,
      messageBytes: signed.messageBytes,
    });
    setProfileResponse({ authenticated: true, user });
    setActiveRailState("FAST");
    writeStoredRail("FAST");
    return user;
  }, [authenticatedForCurrentWallet, privyEnabled, profile, sessionAddress]);

  const setActiveRail = React.useCallback((next: InfoFiRail) => {
    setActiveRailState(next);
    writeStoredRail(next);
  }, []);

  const ensureRail = React.useCallback(
    async (next: InfoFiRail) => {
      if (next === "BASE") {
        setActiveRail("BASE");
        return "BASE";
      }
      if (!fastBound) {
        await bindFastWallet();
      } else {
        setActiveRail("FAST");
      }
      return "FAST";
    },
    [bindFastWallet, fastBound, setActiveRail]
  );

  const value = React.useMemo<UserRailContextValue>(
    () => ({
      activeRail,
      setActiveRail,
      ensureRail,
      refreshProfile,
      ensureSession,
      bindFastWallet,
      loadingProfile,
      profile,
      authenticatedForCurrentWallet,
      fastBound,
    }),
    [activeRail, authenticatedForCurrentWallet, bindFastWallet, ensureRail, ensureSession, fastBound, loadingProfile, profile, refreshProfile, setActiveRail]
  );

  return <UserRailContext.Provider value={value}>{children}</UserRailContext.Provider>;
}

export function useUserRail() {
  const value = React.useContext(UserRailContext);
  if (!value) throw new Error("useUserRail must be used inside UserRailProvider");
  return value;
}
