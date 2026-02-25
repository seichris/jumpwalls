"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { isAddress, type Address, type Hex } from "viem";

import { BrandLockIcon } from "@/components/infofi/brand-lock-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createDigest, getDigestByMetadataURI, getJobById, getJobReimbursementPreview } from "@/lib/api";
import {
  deliverDigestTx,
  formatAmount,
  parseAmount,
  payoutByRequesterTx,
  readJobOnchain,
  readPayoutNonceOnchain,
  readRefundNonceOnchain,
  rateJobTx,
  refundByRequesterTx,
  tokenSymbol,
} from "@/lib/infofi-contract";
import { copyText, logUiAction } from "@/lib/infofi-ux";
import type { InfoFiJobWithDetails, InfoFiReimbursementPreview } from "@/lib/infofi-types";
import { useWallet } from "@/lib/hooks/useWallet";
import { errorMessage, friendlyTxError } from "@/lib/utils";

function shortHash(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function payoutReasonLabel(reason: "x402_reimbursement" | "consultant_labor") {
  return reason === "x402_reimbursement" ? "Source reimbursement" : "Consultant labor";
}

function txExplorerUrl(chainId: number, txHash: string) {
  if (chainId === 1) return `https://etherscan.io/tx/${txHash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  return "";
}

function statusVariant(status: string): "default" | "secondary" | "warning" | "success" {
  const upper = status.toUpperCase();
  if (upper === "HIRED") return "warning";
  if (upper === "DELIVERED") return "default";
  if (upper === "CLOSED") return "default";
  return "secondary";
}

function fairUseVariant(verdict: string | null | undefined): "success" | "warning" | "secondary" {
  const normalized = String(verdict || "").trim().toLowerCase();
  if (normalized === "allow") return "success";
  if (normalized === "warn") return "warning";
  if (normalized === "block") return "secondary";
  return "secondary";
}

function fairUseLabel(verdict: string | null | undefined) {
  const normalized = String(verdict || "").trim().toLowerCase();
  if (normalized === "allow") return "Fair-Use: Allow";
  if (normalized === "warn") return "Fair-Use: Review";
  if (normalized === "block") return "Fair-Use: Blocked";
  return "Fair-Use: Unavailable";
}

function parseFairUseSummary(reportJson: string | null | undefined): string | null {
  if (!reportJson) return null;
  try {
    const parsed = JSON.parse(reportJson) as { summary?: unknown; reasons?: unknown };
    if (typeof parsed.summary === "string" && parsed.summary.trim()) return parsed.summary.trim();
    if (Array.isArray(parsed.reasons)) {
      const first = parsed.reasons.find((entry) => typeof entry === "string" && entry.trim().length > 0);
      return typeof first === "string" ? first.trim() : null;
    }
    return null;
  } catch {
    return null;
  }
}

function prettyJsonText(jsonText: string | null | undefined): string {
  if (!jsonText) return "";
  try {
    return JSON.stringify(JSON.parse(jsonText), null, 2);
  } catch {
    return jsonText;
  }
}

export default function JobDetailPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = (params?.jobId || "").toLowerCase();
  const expectedChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "8453");
  const { address, chainId, connect, switchChain } = useWallet();

  const [data, setData] = React.useState<InfoFiJobWithDetails | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [lagWarning, setLagWarning] = React.useState<string | null>(null);
  const [copyState, setCopyState] = React.useState<string | null>(null);
  const [reimbursementPreview, setReimbursementPreview] = React.useState<InfoFiReimbursementPreview | null>(null);
  const [reimbursementError, setReimbursementError] = React.useState<string | null>(null);
  const [payoutNonce, setPayoutNonce] = React.useState<string>("-");
  const [refundNonce, setRefundNonce] = React.useState<string>("-");

  const [digestText, setDigestText] = React.useState("");
  const [proofText, setProofText] = React.useState("");
  const [citationsText, setCitationsText] = React.useState("");
  const [submittingDigest, setSubmittingDigest] = React.useState(false);

  const [payoutRecipient, setPayoutRecipient] = React.useState("");
  const [payoutAmount, setPayoutAmount] = React.useState("");
  const [submittingPayout, setSubmittingPayout] = React.useState(false);

  const [refundAmount, setRefundAmount] = React.useState("");
  const [submittingRefund, setSubmittingRefund] = React.useState(false);
  const [submittingSuggestedPayouts, setSubmittingSuggestedPayouts] = React.useState(false);

  const [stars, setStars] = React.useState("5");
  const [ratingUri, setRatingUri] = React.useState("ui://infofi/web");
  const [submittingRating, setSubmittingRating] = React.useState(false);

  const wrongChain = chainId !== null && chainId !== expectedChainId;

  const fetchJob = React.useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    setReimbursementError(null);
    try {
      const [job, preview] = await Promise.all([
        getJobById(jobId),
        getJobReimbursementPreview(jobId).catch((err: unknown) => {
          setReimbursementError(errorMessage(err));
          return null;
        }),
      ]);
      if (!job) {
        setData(null);
        setReimbursementPreview(null);
        setError("Job not found.");
        return;
      }
      setReimbursementPreview(preview);
      if (!job.digest && job.metadataURI) {
        const digest = await getDigestByMetadataURI(job.metadataURI);
        setData({ ...job, digest: digest || null });
      } else {
        setData(job);
      }
      setLagWarning(null);
      try {
        const onchain = await readJobOnchain(jobId as Hex);
        if (!onchain) {
          setLagWarning("API has this job but contract read returned empty. Indexing may be stale.");
        } else {
          const remainingMismatch = onchain.remainingAmount !== BigInt(job.remainingWei);
          const deliveredMismatch = (onchain.deliveredAt > 0n) !== Boolean(job.deliveredAt);
          const digestMismatch =
            (job.digestHash || "").toLowerCase() !==
            (onchain.digestHash === "0x0000000000000000000000000000000000000000000000000000000000000000" ? "" : onchain.digestHash.toLowerCase());
          if (remainingMismatch || deliveredMismatch || digestMismatch) {
            setLagWarning("Indexed job data differs from on-chain state. Refresh again in a few seconds.");
          }
        }
        const [pn, rn] = await Promise.all([
          readPayoutNonceOnchain(jobId as Hex),
          readRefundNonceOnchain(jobId as Hex),
        ]);
        setPayoutNonce(pn.toString());
        setRefundNonce(rn.toString());
      } catch {
        // keep UI functional if chain reads fail
      }
    } catch (err: unknown) {
      setReimbursementPreview(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  React.useEffect(() => {
    fetchJob().catch(() => {});
  }, [fetchJob]);

  React.useEffect(() => {
    if (!data) return;
    setPayoutRecipient(data.consultant);
    setPayoutAmount("");
    setRefundAmount("");
    setDigestText(data.digest?.digest ?? "");
    setProofText(data.digest?.proof ?? data.proofTypeOrURI ?? "");
    setCitationsText(prettyJsonText(data.digest?.citationsJson));
  }, [data]);

  const isRequester = Boolean(address && data && address.toLowerCase() === data.requester.toLowerCase());
  const isConsultant = Boolean(address && data && address.toLowerCase() === data.consultant.toLowerCase());

  const hasDelivered = Boolean(data?.deliveredAt);
  const remainingWei = data ? BigInt(data.remainingWei) : 0n;
  const isClosed = remainingWei === 0n;
  const fairUseSummary = parseFairUseSummary(data?.digest?.fairUseReportJson);
  const canRunSuggestedPayouts = Boolean(
    isRequester &&
      hasDelivered &&
      !isClosed &&
      reimbursementPreview &&
      reimbursementPreview.canAutoSettle &&
      reimbursementPreview.suggestedPayouts.length > 0
  );

  const alreadyRated = Boolean(
    address &&
      data?.ratings.some((rating) => rating.rater.toLowerCase() === address.toLowerCase())
  );

  async function onSaveAndDeliver() {
    if (!data || !address) return;
    setActionError(null);
    setSubmittingDigest(true);
    try {
      if (!digestText.trim()) throw new Error("Digest text is required.");
      const citationsValue = citationsText.trim();
      let parsedCitations: unknown = undefined;
      if (citationsValue) {
        try {
          parsedCitations = JSON.parse(citationsValue);
        } catch {
          throw new Error("Citations JSON is invalid.");
        }
      }
      const created = await createDigest({
        jobId: data.jobId,
        digest: digestText.trim(),
        consultantAddress: address,
        sourceURI: data.digest?.sourceURI ?? null,
        question: data.digest?.question ?? null,
        proof: proofText.trim() || null,
        citations: parsedCitations,
      });
      await deliverDigestTx({
        jobId: data.jobId as Hex,
        digestHash: created.digestHash as Hex,
        metadataURI: created.metadataURI,
        proofTypeOrURI: proofText.trim() || "reputation-only",
      });
      logUiAction("deliver_digest", { jobId: data.jobId, metadataURI: created.metadataURI });
      await fetchJob();
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setActionError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmittingDigest(false);
    }
  }

  async function onPayout() {
    if (!data || !address) return;
    setActionError(null);
    setSubmittingPayout(true);
    try {
      if (!isAddress(payoutRecipient as Address)) throw new Error("Recipient must be a valid address.");
      const amountWei = parseAmount(data.paymentToken, payoutAmount);
      await payoutByRequesterTx({
        jobId: data.jobId as Hex,
        recipient: payoutRecipient as Address,
        amountWei,
      });
      logUiAction("payout", { jobId: data.jobId, recipient: payoutRecipient, amount: payoutAmount });
      await fetchJob();
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setActionError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmittingPayout(false);
    }
  }

  async function onRunSuggestedPayouts() {
    if (!data || !reimbursementPreview || !address) return;
    setActionError(null);
    setSubmittingSuggestedPayouts(true);
    try {
      if (!reimbursementPreview.canAutoSettle) {
        throw new Error("Suggested payouts are unavailable because reimbursements exceed remaining escrow.");
      }
      if (reimbursementPreview.suggestedPayouts.length === 0) {
        throw new Error("No suggested payouts are available for this job.");
      }

      let totalPlannedWei = 0n;
      for (const payout of reimbursementPreview.suggestedPayouts) {
        if (!isAddress(payout.recipient as Address)) {
          throw new Error(`Invalid payout recipient: ${payout.recipient}`);
        }
        const amountWei = BigInt(payout.amountWei);
        if (amountWei <= 0n) continue;
        totalPlannedWei += amountWei;
      }
      if (totalPlannedWei > BigInt(data.remainingWei)) {
        throw new Error("Suggested payouts exceed remaining escrow. Refresh and retry.");
      }

      for (const payout of reimbursementPreview.suggestedPayouts) {
        const amountWei = BigInt(payout.amountWei);
        if (amountWei <= 0n) continue;
        await payoutByRequesterTx({
          jobId: data.jobId as Hex,
          recipient: payout.recipient as Address,
          amountWei,
        });
      }
      logUiAction("payout_with_reimbursements", {
        jobId: data.jobId,
        reimbursementTotalWei: reimbursementPreview.reimbursementTotalWei,
        payoutCount: reimbursementPreview.suggestedPayouts.length,
      });
      await fetchJob();
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setActionError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmittingSuggestedPayouts(false);
    }
  }

  async function onRefund() {
    if (!data) return;
    setActionError(null);
    setSubmittingRefund(true);
    try {
      const amountWei = parseAmount(data.paymentToken, refundAmount);
      await refundByRequesterTx({
        jobId: data.jobId as Hex,
        funder: data.requester as Address,
        amountWei,
      });
      logUiAction("refund", { jobId: data.jobId, amount: refundAmount });
      await fetchJob();
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setActionError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmittingRefund(false);
    }
  }

  async function onRate() {
    if (!data) return;
    setActionError(null);
    setSubmittingRating(true);
    try {
      const parsedStars = Number(stars);
      if (!Number.isInteger(parsedStars) || parsedStars < 1 || parsedStars > 5) {
        throw new Error("Stars must be an integer from 1 to 5.");
      }
      await rateJobTx({
        jobId: data.jobId as Hex,
        stars: parsedStars,
        uri: ratingUri.trim() || "ui://infofi/web",
      });
      logUiAction("rate_job", { jobId: data.jobId, stars: parsedStars });
      await fetchJob();
    } catch (err: unknown) {
      const maybeShort = err && typeof err === "object" ? (err as { shortMessage?: unknown }).shortMessage : undefined;
      setActionError(typeof maybeShort === "string" ? maybeShort : friendlyTxError(err));
    } finally {
      setSubmittingRating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/">Back</Link>
          </Button>
          <BrandLockIcon className="size-6" />
          <h1 className="text-2xl font-semibold">Job</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!address ? <Button onClick={() => connect()}>Connect Wallet</Button> : null}
          {wrongChain ? <Button variant="destructive" onClick={() => switchChain(expectedChainId)}>Switch Chain</Button> : null}
          <Button variant="outline" onClick={() => fetchJob()}>
            Refresh
          </Button>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading job...</p> : null}
      {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {lagWarning ? <p className="mb-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{lagWarning}</p> : null}
      {reimbursementError ? (
        <p className="mb-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          Reimbursement preview unavailable: {reimbursementError}
        </p>
      ) : null}
      {copyState ? <p className="mb-3 text-xs text-muted-foreground">{copyState}</p> : null}

      {data ? (
        <div className="space-y-6">
          <section className="rounded-lg border p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(data.status)}>{data.status}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{data.jobId}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const ok = await copyText(data.jobId);
                  setCopyState(ok ? "Copied job ID." : "Clipboard copy unavailable.");
                }}
              >
                Copy ID
              </Button>
            </div>
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <p>Requester: <span className="font-mono text-xs">{shortHash(data.requester)}</span></p>
              <p>Consultant: <span className="font-mono text-xs">{shortHash(data.consultant)}</span></p>
              <p>Request: <Link href={`/request/${data.requestId}`} className="font-mono text-xs text-primary hover:underline">{shortHash(data.requestId)}</Link></p>
              <p>Token: <span className="font-medium">{tokenSymbol(data.paymentToken)}</span></p>
              <p>Amount: <span className="font-medium">{formatAmount(data.paymentToken, data.amountWei)}</span></p>
              <p>Remaining: <span className="font-medium">{formatAmount(data.paymentToken, data.remainingWei)}</span></p>
              <p>Hired: {new Date(data.hiredAt).toLocaleString()}</p>
              <p>Delivered: {data.deliveredAt ? new Date(data.deliveredAt).toLocaleString() : "-"}</p>
              <p>Proof: {data.proofTypeOrURI || "-"}</p>
              <p>Payout Nonce: {payoutNonce}</p>
              <p>Refund Nonce: {refundNonce}</p>
              <p>
                Consultant:
                {" "}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await copyText(data.consultant);
                    setCopyState(ok ? "Copied consultant address." : "Clipboard copy unavailable.");
                  }}
                >
                  Copy
                </Button>
              </p>
            </div>
            {data.metadataURI ? (
              <>
                <Separator className="my-3" />
                <div className="text-xs">
                  Metadata URI:{" "}
                  <a className="break-all text-primary hover:underline" href={data.metadataURI} target="_blank" rel="noreferrer">
                    {data.metadataURI}
                  </a>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const ok = await copyText(data.metadataURI || "");
                      setCopyState(ok ? "Copied metadata URI." : "Clipboard copy unavailable.");
                    }}
                  >
                    Copy Metadata URI
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={data.metadataURI} target="_blank" rel="noreferrer">View Digest JSON</a>
                  </Button>
                </div>
              </>
            ) : null}
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Digest</h2>
            {data.digest ? (
              <div className="mb-4 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Automated review:</span>
                  <Badge variant={fairUseVariant(data.digest.fairUseVerdict)}>{fairUseLabel(data.digest.fairUseVerdict)}</Badge>
                  {typeof data.digest.fairUseScore === "number" ? (
                    <span className="text-xs text-muted-foreground">Score {data.digest.fairUseScore}/100</span>
                  ) : null}
                  {data.digest.fairUsePolicyVersion ? (
                    <span className="text-xs text-muted-foreground">{data.digest.fairUsePolicyVersion}</span>
                  ) : null}
                </div>
                {fairUseSummary ? (
                  <p className="mt-2 text-xs text-muted-foreground">{fairUseSummary}</p>
                ) : null}
              </div>
            ) : null}
            {data.digest ? (
              <div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {data.digest.digest}
              </div>
            ) : (
              <p className="mb-4 text-sm text-muted-foreground">No digest in API DB yet.</p>
            )}

            {isConsultant && !hasDelivered ? (
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="digest-text">Digest Text</Label>
                  <textarea
                    id="digest-text"
                    className="min-h-40 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    value={digestText}
                    onChange={(event) => setDigestText(event.target.value)}
                    placeholder="Write the digest/summary here..."
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="digest-proof">Proof / Notes</Label>
                  <Input
                    id="digest-proof"
                    value={proofText}
                    onChange={(event) => setProofText(event.target.value)}
                    placeholder="zkTLS included, reputation-only, or proof URI"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="digest-citations">Citations JSON (optional)</Label>
                  <textarea
                    id="digest-citations"
                    className="min-h-28 rounded-md border bg-background px-3 py-2 text-xs outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    value={citationsText}
                    onChange={(event) => setCitationsText(event.target.value)}
                    placeholder='[{"type":"x402","url":"https://...","chainId":8453,"token":"0x...","amount":"1000000","payTo":"0x...","txHash":"0x..."}]'
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Fair-use guardrail: submit summaries/answers only, not full source text.
                </p>
                <div>
                  <Button onClick={onSaveAndDeliver} disabled={wrongChain || submittingDigest}>
                    {submittingDigest ? "Saving + Delivering..." : "Save Digest + Deliver On-Chain"}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">x402 Source Payments</h2>
              {reimbursementPreview ? (
                <>
                  <Badge variant="secondary">
                    Verified: {reimbursementPreview.verifiedCitations.length}
                  </Badge>
                  <Badge variant="secondary">
                    Total: {formatAmount(data.paymentToken, reimbursementPreview.reimbursementTotalWei)} {tokenSymbol(data.paymentToken)}
                  </Badge>
                </>
              ) : null}
            </div>
            {!reimbursementPreview ? (
              <p className="text-sm text-muted-foreground">No reimbursement preview available for this job.</p>
            ) : (
              <div className="space-y-4">
                {reimbursementPreview.notes.map((note) => (
                  <p key={note} className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                    {note}
                  </p>
                ))}

                <div className="rounded-md border">
                  <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Verified citations
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>PayTo</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Payer</TableHead>
                        <TableHead>Tx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reimbursementPreview.verifiedCitations.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">
                            No verified x402 citations.
                          </TableCell>
                        </TableRow>
                      ) : (
                        reimbursementPreview.verifiedCitations.map((citation) => {
                          const explorer = txExplorerUrl(citation.chainId, citation.txHash);
                          return (
                            <TableRow key={`verified-${citation.index}-${citation.txHash}`}>
                              <TableCell className="max-w-[280px] break-all text-xs">
                                <a href={citation.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                  {citation.url}
                                </a>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{shortHash(citation.payTo)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {formatAmount(data.paymentToken, citation.amountWei)}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {shortHash(citation.payer)}
                                {citation.verificationNote ? (
                                  <p className="mt-1 max-w-[220px] whitespace-normal text-[11px] text-muted-foreground">
                                    {citation.verificationNote}
                                  </p>
                                ) : null}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {explorer ? (
                                  <a href={explorer} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                    {shortHash(citation.txHash)}
                                  </a>
                                ) : (
                                  shortHash(citation.txHash)
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="rounded-md border">
                  <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Unverified citations
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reimbursementPreview.unverifiedCitations.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-4 text-center text-muted-foreground">
                            No unverified x402 citations.
                          </TableCell>
                        </TableRow>
                      ) : (
                        reimbursementPreview.unverifiedCitations.map((entry, index) => (
                          <TableRow key={`unverified-${entry.index}-${index}`}>
                            <TableCell className="max-w-[280px] break-all text-xs">
                              {entry.citation.url ? (
                                <a href={entry.citation.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                  {entry.citation.url}
                                </a>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {entry.citation.amountWei ?? "-"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{entry.reason}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Settlement</h2>
            {isRequester && hasDelivered && !isClosed ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border p-3 md:col-span-2">
                  <h3 className="mb-2 text-sm font-medium">Payout With Reimbursements</h3>
                  {!reimbursementPreview ? (
                    <p className="text-sm text-muted-foreground">
                      Reimbursement preview unavailable. Use manual payout/refund controls below.
                    </p>
                  ) : (
                    <div className="grid gap-3">
                      <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                        <p>Verified x402 total: {formatAmount(data.paymentToken, reimbursementPreview.reimbursementTotalWei)} {tokenSymbol(data.paymentToken)}</p>
                        <p>Remaining escrow: {formatAmount(data.paymentToken, reimbursementPreview.remainingWei)} {tokenSymbol(data.paymentToken)}</p>
                      </div>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Recipient</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead>Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reimbursementPreview.suggestedPayouts.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="py-3 text-center text-muted-foreground">
                                  No suggested payouts available.
                                </TableCell>
                              </TableRow>
                            ) : (
                              reimbursementPreview.suggestedPayouts.map((payout, index) => (
                                <TableRow key={`suggested-${payout.recipient}-${payout.reason}-${index}`}>
                                  <TableCell className="font-mono text-xs">{shortHash(payout.recipient)}</TableCell>
                                  <TableCell className="text-right font-mono text-xs">
                                    {formatAmount(data.paymentToken, payout.amountWei)}
                                  </TableCell>
                                  <TableCell className="text-xs">{payoutReasonLabel(payout.reason)}</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button onClick={onRunSuggestedPayouts} disabled={wrongChain || submittingSuggestedPayouts || !canRunSuggestedPayouts}>
                          {submittingSuggestedPayouts ? "Executing Suggested Payouts..." : "Execute Suggested Payouts"}
                        </Button>
                        {!reimbursementPreview.canAutoSettle ? (
                          <p className="text-xs text-muted-foreground">
                            Suggested payouts disabled because reimbursement total exceeds remaining escrow.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-md border p-3">
                  <h3 className="mb-2 text-sm font-medium">Payout Consultant</h3>
                  <div className="grid gap-2">
                    <Label htmlFor="payout-recipient">Recipient</Label>
                    <Input
                      id="payout-recipient"
                      value={payoutRecipient}
                      onChange={(event) => setPayoutRecipient(event.target.value)}
                    />
                    <Label htmlFor="payout-amount">Amount ({tokenSymbol(data.paymentToken)})</Label>
                    <Input
                      id="payout-amount"
                      type="number"
                      min="0"
                      step={tokenSymbol(data.paymentToken) === "ETH" ? "0.000001" : "0.01"}
                      value={payoutAmount}
                      onChange={(event) => setPayoutAmount(event.target.value)}
                    />
                    <Button onClick={onPayout} disabled={wrongChain || submittingPayout}>
                      {submittingPayout ? "Paying..." : "Payout"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <h3 className="mb-2 text-sm font-medium">Refund Requester</h3>
                  <div className="grid gap-2">
                    <p className="text-xs text-muted-foreground">Refund address is fixed to requester: {shortHash(data.requester)}</p>
                    <Label htmlFor="refund-amount">Amount ({tokenSymbol(data.paymentToken)})</Label>
                    <Input
                      id="refund-amount"
                      type="number"
                      min="0"
                      step={tokenSymbol(data.paymentToken) === "ETH" ? "0.000001" : "0.01"}
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                    />
                    <Button variant="secondary" onClick={onRefund} disabled={wrongChain || submittingRefund}>
                      {submittingRefund ? "Refunding..." : "Refund"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Settlement actions are available to the requester after digest delivery and while funds remain.
              </p>
            )}
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Ratings</h2>
            {((isRequester || isConsultant) && hasDelivered && !alreadyRated) ? (
              <div className="mb-4 grid gap-2 md:max-w-xl">
                <Label htmlFor="rating-stars">Stars (1-5)</Label>
                <Input
                  id="rating-stars"
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={stars}
                  onChange={(event) => setStars(event.target.value)}
                />
                <Label htmlFor="rating-uri">Rating URI / Note</Label>
                <Input
                  id="rating-uri"
                  value={ratingUri}
                  onChange={(event) => setRatingUri(event.target.value)}
                />
                <Button onClick={onRate} disabled={wrongChain || submittingRating}>
                  {submittingRating ? "Submitting..." : "Submit Rating"}
                </Button>
              </div>
            ) : (
              <p className="mb-4 text-sm text-muted-foreground">
                {hasDelivered ? "No rating action available for this wallet." : "Ratings open after delivery."}
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rater</TableHead>
                  <TableHead>Rated</TableHead>
                  <TableHead>Stars</TableHead>
                  <TableHead>URI</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ratings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">
                      No ratings yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.ratings.map((rating) => (
                    <TableRow key={`${rating.txHash}:${rating.logIndex}`}>
                      <TableCell className="font-mono text-xs">{shortHash(rating.rater)}</TableCell>
                      <TableCell className="font-mono text-xs">{shortHash(rating.rated)}</TableCell>
                      <TableCell>{rating.stars}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs">{rating.uri || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(rating.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Payouts</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payouts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                      No payouts yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.payouts.map((payout) => (
                    <TableRow key={`${payout.txHash}:${payout.logIndex}`}>
                      <TableCell className="font-mono text-xs">{shortHash(payout.recipient)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatAmount(payout.token, payout.amountWei)}</TableCell>
                      <TableCell>{tokenSymbol(payout.token)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(payout.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Refunds</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funder</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.refunds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                      No refunds yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.refunds.map((refund) => (
                    <TableRow key={`${refund.txHash}:${refund.logIndex}`}>
                      <TableCell className="font-mono text-xs">{shortHash(refund.funder)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatAmount(refund.token, refund.amountWei)}</TableCell>
                      <TableCell>{tokenSymbol(refund.token)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(refund.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>

          {actionError ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}
        </div>
      ) : null}
    </main>
  );
}
