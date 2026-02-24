"use client";

import * as React from "react";
import type { Hex } from "viem";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount, isEthToken, parseAmount, updateRequestMaxAmountTx } from "@/lib/infofi-contract";
import type { InfoFiRequest } from "@/lib/infofi-types";
import { friendlyTxError } from "@/lib/utils";

export function UpdateRequestMaxDialog({
  open,
  onOpenChange,
  request,
  suggestedNewMaxWei,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  request: InfoFiRequest;
  suggestedNewMaxWei?: string | null;
  onUpdated?: () => void;
}) {
  const [value, setValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const token = request.paymentToken.toLowerCase();
  const placeholder = formatAmount(token, suggestedNewMaxWei || request.maxAmountWei);

  React.useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setError(null);
    setValue("");
  }, [open]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const newMaxWei = parseAmount(token, value);
      await updateRequestMaxAmountTx({ requestId: request.requestId as Hex, newMaxAmountWei: newMaxWei });
      onOpenChange(false);
      onUpdated?.();
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(value && Number(value) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Increase Budget</DialogTitle>
          <DialogDescription>
            Raises the request max budget so an over-budget offer can be hired. This can only increase (never decrease).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="new-max">New max ({isEthToken(token) ? "ETH" : "token units"})</Label>
            <Input
              id="new-max"
              type="number"
              min="0"
              step={isEthToken(token) ? "0.000001" : "0.01"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
            />
          </div>

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Updating..." : "Update Max"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
