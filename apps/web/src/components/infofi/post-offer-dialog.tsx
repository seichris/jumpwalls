"use client";

import * as React from "react";
import type { Address, Hex } from "viem";

import { useUserRail } from "@/components/providers/user-rail-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createFastOffer } from "@/lib/api";
import {
  assertSupportedToken,
  deriveOfferId,
  FAST_SETTLEMENT_TOKEN,
  formatAmount,
  isEthToken,
  parseAmount,
  postOfferTx,
  randomSalt,
  tokenSymbol,
} from "@/lib/infofi-contract";
import type { InfoFiRequest } from "@/lib/infofi-types";
import { friendlyTxError } from "@/lib/utils";

export function PostOfferDialog({
  open,
  onOpenChange,
  walletAddress,
  request,
  offeredTokens,
  maxAmountWeiByToken,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  request: InfoFiRequest;
  offeredTokens?: string[];
  maxAmountWeiByToken?: Record<string, string>;
  onCreated?: (offerId: Hex) => void;
}) {
  const { ensureRail } = useUserRail();
  const tokenOptions = React.useMemo(() => {
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
    for (const token of offeredTokens || []) push(token);
    return out;
  }, [offeredTokens, request.paymentToken]);

  const [amount, setAmount] = React.useState("");
  const [selectedToken, setSelectedToken] = React.useState(request.paymentToken.toLowerCase());
  const [etaMinutes, setEtaMinutes] = React.useState("30");
  const [proofType, setProofType] = React.useState("reputation-only");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const activeToken = selectedToken || request.paymentToken.toLowerCase();
  const maxAmountWei = maxAmountWeiByToken?.[activeToken] ?? (activeToken === request.paymentToken.toLowerCase() ? request.maxAmountWei : undefined);
  const amountPlaceholder = maxAmountWei ? formatAmount(activeToken, maxAmountWei) : "";
  const overBudget =
    Boolean(maxAmountWei) && Boolean(amount) && Number(amount) > 0
      ? (() => {
          try {
            return parseAmount(activeToken, amount) > BigInt(maxAmountWei || "0");
          } catch {
            return false;
          }
        })()
      : false;

  React.useEffect(() => {
    if (!open) return;
    setAmount("");
    setSelectedToken(tokenOptions[0] || request.paymentToken.toLowerCase());
    setEtaMinutes("30");
    setProofType("reputation-only");
    setSubmitting(false);
    setError(null);
  }, [open, request.paymentToken, tokenOptions]);

  const canSubmit = Boolean(walletAddress && Number(amount) > 0 && Number(etaMinutes) > 0);

  async function submit() {
    if (!walletAddress) {
      setError("Connect wallet first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (request.rail === "FAST") {
        await ensureRail("FAST");
        const offer = await createFastOffer({
          requestId: request.requestId,
          amountWei: parseAmount(FAST_SETTLEMENT_TOKEN, amount).toString(),
          etaSeconds: Math.max(60, Math.floor(Number(etaMinutes) * 60)),
          proofType: proofType.trim() || "reputation-only",
        });
        onOpenChange(false);
        onCreated?.(offer.offerId as Hex);
        return;
      }

      assertSupportedToken(activeToken);
      const amountWei = parseAmount(activeToken, amount);
      const etaSeconds = Math.max(60, Math.floor(Number(etaMinutes) * 60));
      const salt = randomSalt();
      const offerId = deriveOfferId({
        requestId: request.requestId as Hex,
        consultant: walletAddress,
        amountWei,
        etaSeconds,
        salt,
      });

      await postOfferTx({
        requestId: request.requestId as Hex,
        amountWei,
        etaSeconds,
        proofType: proofType.trim() || "reputation-only",
        salt,
      });

      onOpenChange(false);
      onCreated?.(offerId);
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
          <DialogTitle>Post Offer</DialogTitle>
          <DialogDescription>Submit consultant pricing and ETA for this request.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Token</Label>
              <Select value={activeToken} onValueChange={setSelectedToken}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tokenOptions.map((token) => (
                    <SelectItem key={token} value={token}>
                      {tokenSymbol(token)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="offer-amount">Amount</Label>
              <Input
                id="offer-amount"
                type="number"
                min="0"
                step={request.rail === "FAST" ? "0.01" : isEthToken(activeToken) ? "0.000001" : "0.01"}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={amountPlaceholder}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="offer-eta">ETA (minutes)</Label>
            <Input
              id="offer-eta"
              type="number"
              min="1"
              step="1"
              value={etaMinutes}
              onChange={(event) => setEtaMinutes(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="proof-type">Proof Type</Label>
            <Input
              id="proof-type"
              value={proofType}
              onChange={(event) => setProofType(event.target.value)}
              placeholder="reputation-only"
            />
          </div>

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
          {overBudget ? (
            <p className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Counter-offer: amount exceeds the request max. The requester must increase budget before they can hire.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Posting..." : "Post Offer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
