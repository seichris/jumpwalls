"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import type { Address, Hex } from "viem";

import { PostOfferDialog } from "@/components/infofi/post-offer-dialog";
import { PrivyConnectWalletButton } from "@/components/infofi/privy-connect-wallet-button";
import { PrivyFundWalletDialog } from "@/components/infofi/privy-fund-wallet-dialog";
import { UpdateRequestMaxDialog } from "@/components/infofi/update-request-max-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRequestById } from "@/lib/api";
import { assertSupportedToken, deriveJobId, formatAmount, hireOfferEthTx, hireOfferTokenTx, isEthToken, readRequestOnchain, tokenSymbol } from "@/lib/infofi-contract";
import { copyText, logUiAction } from "@/lib/infofi-ux";
import type { InfoFiOffer, InfoFiRequestWithDetails } from "@/lib/infofi-types";
import { useWallet } from "@/lib/hooks/useWallet";
import { isPrivyFeatureEnabled, isPrivyFundingSupportedChain, privyFundingSupportedChainIds } from "@/lib/privy";
import { errorMessage, friendlyTxError } from "@/lib/utils";
import { canHireOfferWithBalance, formatWalletFundingSummary } from "@/lib/wallet-balance";

function shortHash(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function statusVariant(status: string): "default" | "secondary" | "warning" | "success" {
  const upper = status.toUpperCase();
  if (upper === "OPEN") return "success";
  if (upper === "HIRED") return "warning";
  if (upper === "CLOSED") return "default";
  return "secondary";
}

function offeredTokensForRequest(request: InfoFiRequestWithDetails): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value || !value.trim()) return;
    const token = value.toLowerCase();
    if (seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  push(request.paymentToken);
  const withOptional = request as InfoFiRequestWithDetails & {
    offeredTokens?: unknown;
    paymentTokens?: unknown;
  };
  const pushFromMaybeList = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === "string") push(item);
    }
  };
  pushFromMaybeList(withOptional.offeredTokens);
  pushFromMaybeList(withOptional.paymentTokens);

  for (const offer of request.offers as Array<InfoFiOffer & { token?: string }>) {
    if (typeof offer.token === "string") push(offer.token);
  }

  return out;
}

function maxAmountWeiByTokenForRequest(request: InfoFiRequestWithDetails): Record<string, string> {
  const out: Record<string, string> = {
    [request.paymentToken.toLowerCase()]: request.maxAmountWei,
  };
  const withOptional = request as InfoFiRequestWithDetails & {
    maxAmountWeiByToken?: unknown;
    maxAmountsWeiByToken?: unknown;
  };
  const setFromMaybeMap = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [token, amountWei] of Object.entries(value)) {
      if (!token || typeof amountWei !== "string") continue;
      out[token.toLowerCase()] = amountWei;
    }
  };
  setFromMaybeMap(withOptional.maxAmountWeiByToken);
  setFromMaybeMap(withOptional.maxAmountsWeiByToken);
  return out;
}

export default function RequestDetailPage() {
  const params = useParams<{ requestId: string }>();
  const router = useRouter();
  const requestId = (params?.requestId || "").toLowerCase();
  const expectedChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "11155111");
  const {
    address,
    chainId,
    hasProvider,
    hasInjectedProvider,
    injectedAddress,
    bridgedAddress,
    activeWalletSource,
    providerPreference,
    setProviderPreference,
    connect,
    switchChain,
  } = useWallet();

  const [data, setData] = React.useState<InfoFiRequestWithDetails | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [lagWarning, setLagWarning] = React.useState<string | null>(null);
  const [copyState, setCopyState] = React.useState<string | null>(null);
  const [hiringOfferId, setHiringOfferId] = React.useState<string | null>(null);
  const [openPostOffer, setOpenPostOffer] = React.useState(false);
  const [openUpdateMax, setOpenUpdateMax] = React.useState(false);
  const [suggestedNewMaxWei, setSuggestedNewMaxWei] = React.useState<string | null>(null);
  const [fundingFeedback, setFundingFeedback] = React.useState<{
    status: "completed" | "cancelled" | "error";
    summary: string;
    canHire: boolean;
    lowestOpenOfferLabel: string | null;
    tokenSymbolLabel: string | null;
    errorCode?: string;
  } | null>(null);
  const offersSectionRef = React.useRef<HTMLElement | null>(null);

  const wrongChain = chainId !== null && chainId !== expectedChainId;
  const privyEnabled = isPrivyFeatureEnabled();
  const privyChainSupported = isPrivyFundingSupportedChain(expectedChainId);
  const privySupportedChainsLabel = Array.from(privyFundingSupportedChainIds()).join(", ");
  const hasBothWalletSources = Boolean(injectedAddress && bridgedAddress);

  const fetchRequest = React.useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const request = await getRequestById(requestId);
      setData(request);
      if (!request) setError("Request not found.");
      setLagWarning(null);
      if (request) {
        try {
          const onchain = await readRequestOnchain(request.requestId as Hex);
          if (!onchain) {
            setLagWarning("API has this request but contract read returned empty. Indexing may be stale.");
          } else {
            const statusLabel = ["OPEN", "HIRED", "CLOSED"][onchain.status] || "UNKNOWN";
            const statusMismatch = statusLabel !== request.status.toUpperCase();
            const amountMismatch = onchain.maxAmount !== BigInt(request.maxAmountWei);
            const hiredMismatch =
              (request.hiredOfferId || "").toLowerCase() !==
              (onchain.hiredOfferId === "0x0000000000000000000000000000000000000000000000000000000000000000" ? "" : onchain.hiredOfferId.toLowerCase());
            if (statusMismatch || amountMismatch || hiredMismatch) {
              setLagWarning("Indexed request data differs from on-chain state. Refresh again in a few seconds.");
            }
          }
        } catch {
          // Keep UI functional if contract read fails.
        }
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  React.useEffect(() => {
    fetchRequest().catch(() => {});
  }, [fetchRequest]);

  const isRequester = Boolean(
    address &&
      data &&
      address.toLowerCase() === data.requester.toLowerCase()
  );

  async function hireOffer(offer: InfoFiOffer) {
    if (!data) return;
    setActionError(null);
    setHiringOfferId(offer.offerId);
    try {
      const overBudget = BigInt(offer.amountWei) > BigInt(data.maxAmountWei);
      if (overBudget) {
        setSuggestedNewMaxWei(offer.amountWei);
        setOpenUpdateMax(true);
        throw new Error("Offer exceeds request max. Increase budget first.");
      }
      assertSupportedToken(data.paymentToken);
      if (isEthToken(data.paymentToken)) {
        await hireOfferEthTx(offer.offerId as Hex, BigInt(offer.amountWei));
      } else {
        await hireOfferTokenTx({
          offerId: offer.offerId as Hex,
          token: data.paymentToken as Address,
          amountWei: BigInt(offer.amountWei),
        });
      }
      const jobId = deriveJobId(offer.offerId as Hex, data.requester as Address);
      logUiAction("hire_offer", { requestId: data.requestId, offerId: offer.offerId, jobId });
      router.push(`/job/${jobId}`);
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setActionError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
      setHiringOfferId(null);
      await fetchRequest();
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/">Back</Link>
          </Button>
          <h1 className="text-2xl font-semibold">Request</h1>
        </div>
        <div className="flex items-center gap-2">
          {!hasProvider ? <Badge variant="warning">No Wallet Provider</Badge> : null}
          {privyEnabled ? <PrivyConnectWalletButton /> : null}
          {!injectedAddress && hasInjectedProvider ? <Button onClick={() => connect()}>Connect Injected</Button> : null}
          {hasBothWalletSources ? (
            <Select
              value={providerPreference}
              onValueChange={(value) => {
                setProviderPreference(value as "injected" | "bridged");
                logUiAction("wallet_source_selected", { source: value });
              }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="injected">Injected ({shortHash(injectedAddress as string)})</SelectItem>
                <SelectItem value="bridged">Privy ({shortHash(bridgedAddress as string)})</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          {address ? (
            <Badge variant="secondary" className="font-mono">
              {activeWalletSource === "bridged" ? "Privy" : "Injected"} {shortHash(address)}
            </Badge>
          ) : null}
          {wrongChain ? <Button variant="destructive" onClick={() => switchChain(expectedChainId)}>Switch Chain</Button> : null}
          {privyEnabled ? (
            <PrivyFundWalletDialog
              walletAddress={address}
              walletChainId={chainId}
              expectedChainId={expectedChainId}
              onFundingOutcome={(outcome) => {
                if (!data) return;
                if (outcome.status === "error") {
                  setFundingFeedback({
                    status: "error",
                    summary: "Balance check unavailable",
                    canHire: false,
                    lowestOpenOfferLabel: null,
                    tokenSymbolLabel: null,
                    errorCode: outcome.errorCode,
                  });
                  return;
                }

                const openOffers = data.offers
                  .filter((offer) => offer.status.toUpperCase() === "OPEN")
                  .map((offer) => ({ ...offer, amountWeiBigInt: BigInt(offer.amountWei) }));
                const affordable = openOffers.some((offer) =>
                  canHireOfferWithBalance({
                    snapshot: outcome.balancesAfter,
                    paymentToken: data.paymentToken,
                    offerAmountWei: offer.amountWeiBigInt,
                  })
                );
                const lowestOpenOffer = openOffers.reduce<bigint | null>((current, next) => {
                  if (current === null) return next.amountWeiBigInt;
                  return next.amountWeiBigInt < current ? next.amountWeiBigInt : current;
                }, null);

                setFundingFeedback({
                  status: outcome.status,
                  summary: formatWalletFundingSummary(outcome.balancesAfter),
                  canHire: affordable,
                  lowestOpenOfferLabel: lowestOpenOffer === null ? null : formatAmount(data.paymentToken, lowestOpenOffer),
                  tokenSymbolLabel: tokenSymbol(data.paymentToken),
                });
              }}
            />
          ) : null}
          <Button variant="outline" onClick={() => fetchRequest()}>Refresh</Button>
          {data && data.status.toUpperCase() === "OPEN" ? (
            <Button onClick={() => setOpenPostOffer(true)} disabled={!address || wrongChain}>
              Post Offer
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading request...</p> : null}
      {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {lagWarning ? <p className="mb-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{lagWarning}</p> : null}
      {copyState ? <p className="mb-3 text-xs text-muted-foreground">{copyState}</p> : null}
      {fundingFeedback ? (
        <div className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-300">
          {fundingFeedback.status === "error" ? (
            <p>Funding flow finished with an error{fundingFeedback.errorCode ? ` (${fundingFeedback.errorCode})` : ""}.</p>
          ) : (
            <>
              <p>
                Funding flow {fundingFeedback.status}. On-chain wallet balance:{" "}
                <span className="font-mono">{fundingFeedback.summary}</span>.
              </p>
              {fundingFeedback.canHire ? (
                <div className="mt-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      offersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    You Can Now Hire
                  </Button>
                </div>
              ) : (
                <p className="mt-1">
                  Current balance cannot hire the lowest open offer
                  {fundingFeedback.lowestOpenOfferLabel ? ` (${fundingFeedback.lowestOpenOfferLabel} ${fundingFeedback.tokenSymbolLabel})` : ""}.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
      {privyEnabled && !privyChainSupported ? (
        <p className="mb-3 rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          Card funding via Privy is enabled for chain IDs {privySupportedChainsLabel}. Current app chain is{" "}
          {expectedChainId}.
        </p>
      ) : null}

      {data ? (
        <>
          <section className="rounded-lg border p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(data.status)}>{data.status}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{data.requestId}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ok = await copyText(data.requestId);
                  setCopyState(ok ? "Copied request ID." : "Clipboard copy unavailable.");
                }}
              >
                Copy ID
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Source</p>
            <a
              href={data.sourceURI}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-sm text-primary underline-offset-4 hover:underline"
            >
              {data.sourceURI}
            </a>
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ok = await copyText(data.sourceURI);
                  setCopyState(ok ? "Copied source URL." : "Clipboard copy unavailable.");
                }}
              >
                Copy Source URL
              </Button>
            </div>
            <Separator className="my-3" />
            <p className="mb-2 text-sm text-muted-foreground">Question</p>
            <p className="text-sm">{data.question}</p>
            <Separator className="my-3" />
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <p>Requester: <span className="font-mono text-xs">{shortHash(data.requester)}</span></p>
              <p>Token: <span className="font-medium">{tokenSymbol(data.paymentToken)}</span></p>
              <p>Max: <span className="font-medium">{formatAmount(data.paymentToken, data.maxAmountWei)}</span></p>
            </div>
            {isRequester && data.status.toUpperCase() === "OPEN" ? (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSuggestedNewMaxWei(null);
                    setOpenUpdateMax(true);
                  }}
                  disabled={!address || wrongChain}
                >
                  Increase Budget
                </Button>
              </div>
            ) : null}
            {data.job ? (
              <div className="mt-4">
                <Button asChild>
                  <Link href={`/job/${deriveJobId(data.hiredOfferId as Hex, data.requester as Address)}`}>Open Job</Link>
                </Button>
              </div>
            ) : null}
          </section>

          <section ref={offersSectionRef} className="mt-6 rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Offers ({data.offers.length})</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offer</TableHead>
                  <TableHead>Consultant</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">ETA</TableHead>
                  <TableHead>Proof</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.offers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      No offers yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.offers.map((offer) => {
                    const overBudget = BigInt(offer.amountWei) > BigInt(data.maxAmountWei);
                    return (
                      <TableRow key={offer.offerId}>
                        <TableCell className="font-mono text-xs">{shortHash(offer.offerId)}</TableCell>
                        <TableCell className="font-mono text-xs">{shortHash(offer.consultant)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatAmount(data.paymentToken, offer.amountWei)}
                          {overBudget ? (
                            <span className="ml-2 inline-flex rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
                              Over max
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-xs">{Math.max(1, Math.floor(offer.etaSeconds / 60))}m</TableCell>
                        <TableCell className="text-xs">{offer.proofType || "-"}</TableCell>
                        <TableCell><Badge variant={statusVariant(offer.status)}>{offer.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {isRequester && data.status.toUpperCase() === "OPEN" && offer.status.toUpperCase() === "OPEN" ? (
                            <Button
                              size="sm"
                              onClick={() => hireOffer(offer)}
                              disabled={Boolean(hiringOfferId) || wrongChain}
                            >
                              {hiringOfferId === offer.offerId ? "Hiring..." : "Hire"}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </section>

          {actionError ? <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

          <PostOfferDialog
            open={openPostOffer}
            onOpenChange={setOpenPostOffer}
            walletAddress={address}
            request={data}
            offeredTokens={offeredTokensForRequest(data)}
            maxAmountWeiByToken={maxAmountWeiByTokenForRequest(data)}
            onCreated={() => fetchRequest()}
          />

          <UpdateRequestMaxDialog
            open={openUpdateMax}
            onOpenChange={setOpenUpdateMax}
            request={data}
            suggestedNewMaxWei={suggestedNewMaxWei}
            onUpdated={() => fetchRequest()}
          />
        </>
      ) : null}
    </main>
  );
}
