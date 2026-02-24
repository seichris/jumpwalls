# InfoFi x402 Source Payments + Optional Creator Revenue Share — Implementation Plan

Goal: let a requester pay once (InfoFi escrow), while enabling consultants to optionally use x402-enabled sources and have those content creators get paid per access. If a source is x402-enabled, we record proof-of-payment and reimburse the payer from the requester’s escrow during settlement.

This plan is intentionally “non-custodial” for InfoFi: no platform private keys for source purchases, and no attempt to pay creators without an explicit payout address.

## Terms

- **Job payment**: what the requester escrows in `InfoFi` (`contracts/src/InfoFi.sol`) when hiring an offer.
- **Source payment**: an x402 payment to a creator/publisher to access a source URL (article/video/data/API).
- **Reimbursement**: paying the consultant (or other payer) back from job escrow for source payments they fronted.

## Design Constraints / Assumptions

- Requester wants to pay; consultant + content creator should be paid.
- Content creators are often unaware of InfoFi, so paying them requires an explicit on-chain payout address. For MVP, that address comes from x402 terms (`payTo`), otherwise “creator share” is not available.
- For MVP, only support reimbursements where **job escrow token/network matches source payment token/network** (e.g., USDC on Base for both). If they differ, treat the source payment as “out of band” and do not auto-reimburse.
- For MVP, InfoFi does not attempt to enforce licensing/redistribution rights; it only pays for access and stores citations/receipts.

## MVP User Flows

### A) Consultant uses x402 sources (creator gets paid immediately)

1. Consultant fetches an x402-enabled source URL while researching.
2. Their client/tool pays the x402 `payTo` address for the required amount and receives the paid response.
3. Consultant records an **x402 payment receipt** (chain, token, amount, payTo, tx hash / receipt blob) and attaches it to the digest citations when they submit the digest to the InfoFi API (`POST /digests`).

Outcome:
- Creator gets paid per access (from the consultant at research time).
- Requester later reimburses the consultant from escrow as part of settlement (so “requester pays” economically).

### B) Requester settles escrow with splits (consultant + reimbursements)

1. Requester views the job.
2. UI proposes a payout plan:
   - **Reimbursement total**: sum of verified x402 source payments (optionally capped).
   - **Consultant payout**: remaining escrow after reimbursements (and optional platform fee).
3. Requester executes payouts on-chain as multiple calls to `payoutByRequester(jobId, recipient, amount)` (or a single batched call if added later).

Outcome:
- Consultant is compensated for work + reimbursed for source costs.
- Creator payment is already done via x402; InfoFi does not need to send funds to creators again.

## Data Model (API + Digest Metadata)

### Citation schema addition (store in `infoFiDigest.citationsJson`)

Add a normalized citation shape that can represent x402 purchases:

```ts
type InfoFiCitation =
  | { type: "url"; url: string; note?: string }
  | {
      type: "x402";
      url: string;
      chainId: number;
      token: "USDC" | string; // token address if applicable
      amount: string; // atomic units as string
      payTo: string; // recipient address
      txHash?: string; // preferred if EVM payment is on-chain
      receipt?: unknown; // fallback for non-EVM / facilitator receipts
      purchasedAt?: string; // ISO timestamp
    };
```

Notes:
- Keep this purely additive and backward-compatible; existing digests can have `citationsJson = null`.
- `token` should be normalized to an on-chain address when possible (preferred) to enable verification.

### Verification rule (MVP)

To include a citation in reimbursement calculations:
- `type === "x402"` and `txHash` is present
- `chainId` matches the job chain
- `token` matches the job payment token
- on-chain transfer is verifiable: `payTo` received `amount` in `token` (exact match or “at least” depending on x402 facilitator behavior)

If not verifiable, show it to the requester as “unverified source cost” and exclude from automatic reimbursement.

## Backend Changes (apps/api)

1. **Expose citations clearly**
   - `GET /digests/:id` already returns the digest row; ensure consumers can parse `citationsJson`.

2. **Optional: add a reimbursement preview endpoint**
   - `GET /jobs/:jobId/reimbursement-preview`
   - returns:
     - verified x402 citations (normalized)
     - totals by `payTo` and totals overall
     - any errors (wrong chain/token, missing txHash, etc.)

3. **Optional: verification helper**
   - Implement EVM receipt validation via RPC (`RPC_URL`) without storing secrets.
   - Cache validation results in DB to avoid repeated RPC calls.

## Web Changes (apps/web)

1. **Display x402 citations on job page**
   - Show each x402 source with: URL, creator payTo, token, amount, tx hash link, verification status.

2. **Settlement UI: “Payout with reimbursements”**
   - Generate a payout plan:
     - reimburse consultant (or whoever paid) for verified source costs
     - pay consultant for labor (remaining amount)
   - Execute sequential `payoutByRequester` calls.
   - Guardrails:
     - totals must be `<= remainingAmount`
     - all recipients must be checksummed/valid addresses

3. **Future UX: batched payouts**
   - If sequential payouts are too clunky, add a contract helper (see below) and update UI to use it.

## Contract Changes (optional, not required for MVP)

`InfoFi.sol` already supports multiple payouts via repeated calls while `remainingAmount > 0`.

Optional improvements:
- `payoutManyByRequester(bytes32 jobId, address payable[] recipients, uint256[] amounts)` to reduce tx count.
- `payoutManyWithAuthorization(...)` variant if you want a relayer/submission service later.

## CLI / Agent Tooling (consultant workflow)

Add a small helper to make it easy to attach x402 receipts:
- a script or CLI command that outputs a JSON citation entry given:
  - `url`, `chainId`, `token`, `amount`, `payTo`, `txHash`
- consultants paste/attach this into the digest citations when calling `POST /digests` (or when using `scripts-for-ai-agents/07_store_digest.sh`).

Non-goal (MVP): implementing the x402 payment itself inside InfoFi tooling. Consultants can use any x402-compatible client; InfoFi only needs the receipt to reimburse.

## Security / Abuse Considerations

- **Fake receipts**: only reimburse verifiable on-chain payments that match job chain/token.
- **Overbilling**: cap reimbursable total (e.g., `<= job.amount * 0.5` or configurable per request).
- **Double-pay creators**: do not pay creators again during settlement if the citation indicates they were already paid via x402.
- **Secrets**: do not introduce any server-side private key for paying sources in MVP.

## Phase Breakdown

### Phase 1 (MVP): record + display + reimburse

- Define citation schema for x402 in `citationsJson`.
- Update web job view to show x402 citations.
- Add reimbursement preview logic (web-only or API endpoint).
- Add “settle with reimbursements” UI that executes multiple payouts.

### Phase 2: verification endpoint + caching

- Add API endpoint to validate x402 citations against RPC.
- Cache results to reduce RPC calls.

### Phase 3: batched payout contract helper

- Add `payoutManyByRequester` and update UI.

## Open Questions

- Which chain/token are we standardizing on for MVP (recommended: a single USDC deployment on one chain)?
- What is the reimbursable cap, and who sets it (request-level vs platform default)?
- Do we support reimbursing a payer other than the consultant (e.g., “research budget wallet”)?

