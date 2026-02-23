"use client";

import * as React from "react";
import type { Address, Hex } from "viem";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assertSupportedToken, deriveOfferId, parseAmount, postOfferTx, randomSalt } from "@/lib/infofi-contract";
import type { InfoFiRequest } from "@/lib/infofi-types";
import { friendlyTxError } from "@/lib/utils";

export function PostOfferDialog({
  open,
  onOpenChange,
  walletAddress,
  request,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  walletAddress: Address | null;
  request: InfoFiRequest;
  onCreated?: (offerId: Hex) => void;
}) {
  const [amount, setAmount] = React.useState("");
  const [etaMinutes, setEtaMinutes] = React.useState("30");
  const [proofType, setProofType] = React.useState("reputation-only");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount("");
    setEtaMinutes("30");
    setProofType("reputation-only");
    setSubmitting(false);
    setError(null);
  }, [open]);

  const canSubmit = Boolean(walletAddress && Number(amount) > 0 && Number(etaMinutes) > 0);

  async function submit() {
    if (!walletAddress) {
      setError("Connect wallet first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      assertSupportedToken(request.paymentToken);
      const amountWei = parseAmount(request.paymentToken, amount);
      if (amountWei > BigInt(request.maxAmountWei)) {
        throw new Error("Offer amount cannot exceed request max amount.");
      }
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
              <Label htmlFor="offer-amount">Amount</Label>
              <Input
                id="offer-amount"
                type="number"
                min="0"
                step={request.paymentToken.toLowerCase() === "0x0000000000000000000000000000000000000000" ? "0.000001" : "0.01"}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
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
