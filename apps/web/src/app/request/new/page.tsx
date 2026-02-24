"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { Address } from "viem";
import { parseEther, parseUnits } from "viem";

import { PrivyFundWalletDialog } from "@/components/infofi/privy-fund-wallet-dialog";
import { PrivyConnectWalletButton } from "@/components/infofi/privy-connect-wallet-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deriveRequestId, ETH_TOKEN, postRequestTx, randomSalt, usdcForChain } from "@/lib/infofi-contract";
import { fullTextRisk, logUiAction, lowBudgetWarning } from "@/lib/infofi-ux";
import { useWallet } from "@/lib/hooks/useWallet";
import { isPrivyFeatureEnabled, isPrivyFundingSupportedChain, privyFundingSupportedChainIds } from "@/lib/privy";
import { friendlyTxError } from "@/lib/utils";
import { canPostRequestWithBalance, formatWalletFundingSummary } from "@/lib/wallet-balance";

export default function NewRequestPage() {
  const router = useRouter();
  const expectedChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "11155111");
  const {
    address,
    chainId,
    hasProvider,
    setProviderPreference,
    switchChain,
  } = useWallet();

  const [sourceURI, setSourceURI] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const [tokenMode, setTokenMode] = React.useState<"ETH" | "USDC">("ETH");
  const [maxAmount, setMaxAmount] = React.useState("0.0001");
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [saltInput, setSaltInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fundingFeedback, setFundingFeedback] = React.useState<{
    status: "completed" | "cancelled" | "error";
    summary: string;
    canPost: boolean;
    errorCode?: string;
  } | null>(null);

  const wrongChain = chainId !== null && chainId !== expectedChainId;
  const privyEnabled = isPrivyFeatureEnabled();
  const privyChainSupported = isPrivyFundingSupportedChain(expectedChainId);
  const privySupportedChainsLabel = Array.from(privyFundingSupportedChainIds()).join(", ");
  const usdc = usdcForChain();
  const paymentToken = tokenMode === "ETH" ? ETH_TOKEN : usdc || ETH_TOKEN;
  const questionRisk = fullTextRisk(question);
  const budgetWarning = lowBudgetWarning(paymentToken, maxAmount);

  const canSubmit = Boolean(address && sourceURI.trim() && question.trim() && Number(maxAmount) > 0 && !wrongChain);

  React.useEffect(() => {
    if (!privyEnabled) return;
    setProviderPreference("bridged");
  }, [privyEnabled, setProviderPreference]);

  async function submit() {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!sourceURI.trim()) {
      setError("Source URL is required.");
      return;
    }
    if (!question.trim()) {
      setError("Question is required.");
      return;
    }
    if (!paymentToken) {
      setError("USDC is not configured for this chain.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const salt = saltInput.trim() || randomSalt();
      const maxAmountWei = tokenMode === "ETH" ? parseEther(maxAmount) : parseUnits(maxAmount, 6);

      const requestId = deriveRequestId({
        requester: address as Address,
        sourceURI: sourceURI.trim(),
        question: question.trim(),
        salt,
      });

      await postRequestTx({
        sourceURI: sourceURI.trim(),
        question: question.trim(),
        paymentToken: paymentToken as Address,
        maxAmountWei,
        salt,
      });

      logUiAction("post_request_page", { requestId, tokenMode, maxAmount });
      router.push(`/request/${requestId}`);
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b pb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/">Back</Link>
          </Button>
          <h1 className="text-2xl font-semibold">New Request</h1>
        </div>
        <div className="flex items-center gap-2">
          {privyEnabled ? <PrivyConnectWalletButton /> : null}
          {!privyEnabled && !hasProvider ? <Badge variant="warning">No Wallet Provider</Badge> : null}
          {wrongChain ? <Button variant="destructive" onClick={() => switchChain(expectedChainId)}>Switch Chain</Button> : null}
          {privyEnabled ? (
            <PrivyFundWalletDialog
              walletAddress={address}
              walletChainId={chainId}
              expectedChainId={expectedChainId}
              onFundingOutcome={(outcome) => {
                if (outcome.status === "error") {
                  setFundingFeedback({
                    status: "error",
                    summary: "Balance check unavailable",
                    canPost: false,
                    errorCode: outcome.errorCode,
                  });
                  return;
                }
                const canPost = canPostRequestWithBalance(outcome.balancesAfter);
                setFundingFeedback({
                  status: outcome.status,
                  summary: formatWalletFundingSummary(outcome.balancesAfter),
                  canPost,
                });
              }}
            />
          ) : null}
        </div>
      </header>

      <section className="rounded-lg border p-4">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="source-uri">Source URL</Label>
            <Input
              id="source-uri"
              placeholder="https://doi.org/... or https://www.wsj.com/..."
              value={sourceURI}
              onChange={(event) => setSourceURI(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="question">Question</Label>
            <Input
              id="question"
              placeholder="Summarize key findings in 8 bullets and list 3 caveats"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Payment Token</Label>
              <Select value={tokenMode} onValueChange={(value) => setTokenMode(value as "ETH" | "USDC")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETH">ETH</SelectItem>
                  <SelectItem value="USDC">USDC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="max-amount">Max Amount</Label>
              <Input
                id="max-amount"
                type="number"
                min="0"
                step={tokenMode === "ETH" ? "0.000001" : "0.01"}
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Fair-use guardrail: requests are for digests, summaries, and iterative Q&A only. Do not request full-text redistribution.
          </div>
          {questionRisk ? (
            <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Your question appears to request full text. Rephrase it toward summaries or targeted Q&A.
            </p>
          ) : null}
          {budgetWarning ? (
            <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {budgetWarning}
            </p>
          ) : null}
          {fundingFeedback ? (
            <div className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-300">
              {fundingFeedback.status === "error" ? (
                <p>Funding flow finished with an error{fundingFeedback.errorCode ? ` (${fundingFeedback.errorCode})` : ""}.</p>
              ) : (
                <>
                  <p>
                    Funding flow {fundingFeedback.status}. On-chain wallet balance: <span className="font-mono">{fundingFeedback.summary}</span>.
                  </p>
                  {fundingFeedback.canPost ? (
                    <div className="mt-2">
                      <Button size="sm" onClick={submit} disabled={!canSubmit || submitting}>
                        You Can Now Post Request
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-1">Balance is still low for gas on this chain. You may need to fund more before posting.</p>
                  )}
                </>
              )}
            </div>
          ) : null}
          {privyEnabled && !privyChainSupported ? (
            <p className="rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
              Card funding via Privy is enabled for chain IDs {privySupportedChainsLabel}. Current app chain is{" "}
              {expectedChainId}.
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdvanced((prev) => !prev)}>
              {showAdvanced ? "Hide Advanced" : "Show Advanced"}
            </Button>
          </div>
          {showAdvanced ? (
            <div className="grid gap-2">
              <Label htmlFor="salt">Salt (optional)</Label>
              <Input
                id="salt"
                placeholder="Auto-generated if empty"
                value={saltInput}
                onChange={(event) => setSaltInput(event.target.value)}
              />
            </div>
          ) : null}

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <div>
            <Button onClick={submit} disabled={!canSubmit || submitting}>
              {submitting ? "Posting..." : "Post Request"}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
