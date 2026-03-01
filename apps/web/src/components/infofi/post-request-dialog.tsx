"use client";

import * as React from "react";
import type { Address } from "viem";
import { parseEther, parseUnits } from "viem";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deriveRequestId, ETH_TOKEN, postRequestTx, randomSalt, usdcForChain } from "@/lib/infofi-contract";
import { fullTextRisk, logUiAction, lowBudgetWarning } from "@/lib/infofi-ux";
import { friendlyTxError } from "@/lib/utils";

export function PostRequestDialog({
  open,
  onOpenChange,
  walletAddress,
  initialSourceURI,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  initialSourceURI?: string;
  onCreated?: (requestId: string) => void;
}) {
  const [sourceURI, setSourceURI] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const [tokenMode, setTokenMode] = React.useState<"ETH" | "USDC">("USDC");
  const [maxAmount, setMaxAmount] = React.useState("1");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const usdc = usdcForChain();
  const paymentToken = tokenMode === "ETH" ? ETH_TOKEN : usdc || ETH_TOKEN;
  const budgetWarning = lowBudgetWarning(paymentToken, maxAmount);
  const questionRisk = fullTextRisk(question);

  React.useEffect(() => {
    if (!open) return;
    setSourceURI(initialSourceURI?.trim() || "");
    setQuestion("");
    setTokenMode("USDC");
    setMaxAmount("1");
    setSubmitting(false);
    setError(null);
  }, [open, initialSourceURI]);

  const canSubmit = Boolean(walletAddress && sourceURI.trim() && question.trim() && Number(maxAmount) > 0);

  async function submit() {
    if (!walletAddress) {
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

    setSubmitting(true);
    setError(null);
    try {
      const paymentToken = tokenMode === "ETH" ? ETH_TOKEN : usdc;
      if (!paymentToken) throw new Error("USDC is not configured for this chain.");
      const maxAmountWei =
        tokenMode === "ETH"
          ? parseEther(maxAmount)
          : parseUnits(maxAmount, 6);
      const salt = randomSalt();

      const expectedRequestId = deriveRequestId({
        requester: walletAddress,
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
      logUiAction("post_request", { token: tokenMode, maxAmount });

      onOpenChange(false);
      onCreated?.(expectedRequestId);
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post Request</DialogTitle>
          <DialogDescription>Create an on-chain InfoFi request.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="source-uri">Source URL</Label>
            <Input
              id="source-uri"
              value={sourceURI}
              onChange={(event) => setSourceURI(event.target.value)}
              placeholder="https://doi.org/..."
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="question">Question</Label>
            <Input
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Summarize this source in 8 bullets"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          <p className="text-xs text-muted-foreground">
            Fair-use guardrail: submit requests for digests and answers, not full-text redistribution.
          </p>
          {questionRisk ? (
            <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Your question appears to request full text. Rephrase toward summaries or targeted Q&A.
            </p>
          ) : null}
          {budgetWarning ? (
            <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {budgetWarning}
            </p>
          ) : null}

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Posting..." : "Post Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
