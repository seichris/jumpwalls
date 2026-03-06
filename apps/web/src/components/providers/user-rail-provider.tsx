"use client";

import * as React from "react";

import {
  bindFastWallet as bindFastWalletApi,
  createFastBindChallenge,
  createUserAuthChallenge,
  getUserProfile,
  verifyUserAuthChallenge,
} from "@/lib/api";
import { connectFastWallet, signFastMessage } from "@/lib/fast-wallet";
import { useWallet } from "@/lib/hooks/useWallet";
import type { InfoFiRail, InfoFiUserProfile, InfoFiUserProfileResponse } from "@/lib/infofi-types";
import { getActiveEthereumProvider } from "@/lib/wallet";

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

async function signEvmMessage(address: string, message: string) {
  const provider = getActiveEthereumProvider();
  if (!provider?.request) throw new Error("Connect your EVM wallet first.");
  try {
    const result = await provider.request({
      method: "personal_sign",
      params: [message, address],
    });
    if (typeof result === "string" && result) return result;
  } catch {
    const fallback = await provider.request({
      method: "eth_sign",
      params: [address, message],
    });
    if (typeof fallback === "string" && fallback) return fallback;
  }
  throw new Error("Wallet did not return a signature.");
}

export function UserRailProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWallet();
  const normalizedAddress = address?.toLowerCase() ?? null;
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
    if (activeRail === "FAST" && (!normalizedAddress || !profileResponse.user?.fastAddress || profileResponse.user.evmAddress !== normalizedAddress)) {
      setActiveRailState("BASE");
      writeStoredRail("BASE");
    }
  }, [activeRail, normalizedAddress, profileResponse.user]);

  const authenticatedForCurrentWallet = Boolean(
    normalizedAddress &&
      profileResponse.authenticated &&
      profileResponse.user?.evmAddress?.toLowerCase() === normalizedAddress
  );
  const profile = authenticatedForCurrentWallet ? profileResponse.user : null;
  const fastBound = Boolean(profile?.fastAddress);

  const ensureSession = React.useCallback(async () => {
    if (!normalizedAddress) throw new Error("Connect your EVM wallet first.");
    if (authenticatedForCurrentWallet && profile) return profile;

    const challenge = await createUserAuthChallenge(normalizedAddress);
    const signature = await signEvmMessage(normalizedAddress, challenge.messageToSign);
    await verifyUserAuthChallenge({
      address: normalizedAddress,
      nonce: challenge.nonce,
      signature,
    });
    const next = await getUserProfile();
    setProfileResponse(next);
    return next.user;
  }, [authenticatedForCurrentWallet, normalizedAddress, profile]);

  const bindFastWallet = React.useCallback(async () => {
    await ensureSession();
    const { wallet, account } = await connectFastWallet();
    const challenge = await createFastBindChallenge({
      address: account.address,
      publicKey: account.publicKey,
    });
    const signed = await signFastMessage({
      wallet,
      account,
      message: challenge.messageToSign,
    });
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
  }, [ensureSession]);

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
