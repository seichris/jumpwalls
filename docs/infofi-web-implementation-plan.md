# InfoFi Web Rebuild (apps/web) - Feature Implementation Plan

Goal: rebuild `apps/web` into the InfoFi product UI. No backward compatibility with gh-bounties/GitHub concepts. Reuse only generic UI plumbing (Next.js, Tailwind, dialogs, wallet hooks patterns) and replace domain logic end-to-end.

Assumptions (current backend/chain):
- API runs in InfoFi mode (`CONTRACT_KIND=infofi`) and exposes:
  - `GET /requests`, `GET /offers`, `GET /jobs`, `GET/POST /digests`, `GET /digests/:id`, `GET /infofi/id`.
- Contract is `InfoFi` (`contracts/src/InfoFi.sol`) deployed on Sepolia.
- Payment tokens: ETH and USDC (and generic ERC-20).

Non-goals (v0 web):
- Any GitHub OAuth, issue parsing, PR linking, or label syncing.
- A full on-chain orderbook explorer beyond the API-indexed read models.
- ZK proof UX (proof is a string field for now).

## Phase 0: Cleanup And Rename
- Delete gh-bounties routes and components:
  - `apps/web/src/app/bounty/[bountyId]/page.tsx`
  - `apps/web/src/components/*bounty*`, `fund-issue-dialog`, `claim-bounty-dialog`, `admin-payout-dialog`, issues table.
- Remove GitHub helpers:
  - `apps/web/src/lib/gh.ts`
  - `apps/web/src/lib/hooks/useGithubUser.ts`
- Rename UI copy and titles to InfoFi.
- Optional (recommended): rename package metadata from `@gh-bounties/web` to `@infofi/web` and update workspace filters later.

Deliverable:
- `apps/web` builds and boots with a new home page and no dead routes/imports.

## Phase 1: Core Frontend Architecture

### 1) API client layer
- Add `apps/web/src/lib/api.ts`:
  - `getRequests({ take, requester, status })`
  - `getRequestById(requestId)`
  - `getOffers({ requestId, consultant, status, take })`
  - `getJob(jobId)` and `getJobs({ requester, consultant, status, take })`
  - `createDigest({ jobId, digest, consultantAddress, sourceURI?, question?, proof? })`
  - `getDigestById(id)` (and `getDigestByMetadataURI(metadataURI)` helper that parses `/digests/:id`)
- Use `NEXT_PUBLIC_API_URL` only.
- Centralize `fetch` error handling:
  - network errors
  - non-2xx with `{ error }` payload

### 2) Types
- Add `apps/web/src/lib/infofi-types.ts` mirroring API responses:
  - `InfoFiRequestRow`, `InfoFiOfferRow`, `InfoFiJobRow`, `InfoFiDigestRow`
  - token strings always lowercased, wei stored as string.

### 3) Contract interaction layer
- Replace the existing ABI export with InfoFi ABI:
  - Update `apps/web/src/lib/abi.ts` to export `infoFiAbi` (viem `parseAbi`).
- Add `apps/web/src/lib/infofi-contract.ts`:
  - write helpers for:
    - `postRequest`
    - `postOffer`
    - `hireOfferETH`
    - `hireOfferToken` (requires `approve`)
    - `deliverDigest`
    - `payoutByRequester`
    - `refundByRequester`
    - `rateJob`
  - read helpers for:
    - `requests(requestId)`, `offers(offerId)`, `jobs(jobId)`
    - `payoutNonces`, `refundNonces` (for delegated EIP-712 path later)
- For v0, prefer direct requester settlement (`payoutByRequester`/`refundByRequester`) and hide EIP-712 delegated submit.

### 4) Wallet UX baseline
- Reuse existing `apps/web/src/lib/hooks/useWallet.ts` patterns.
- Ensure:
  - "Connect wallet" call-to-action in the header
  - Sepolia chain mismatch prompt (switch network)
  - address display + copy

Deliverable:
- Web can read from API and contract and display a basic requests list.

## Phase 2: Pages And Navigation

### 1) Home: Requests list
Route: `apps/web/src/app/page.tsx`
- Replace bounty table with an InfoFi Requests table/grid:
  - columns: source (domain + full URL), question preview, payment token, max amount, status, last update.
  - filters: status, token, requester address.
  - actions:
    - "Post request" button
    - click row -> request detail

### 2) Request detail page
Route: `apps/web/src/app/request/[requestId]/page.tsx`
- Show:
  - request metadata (sourceURI, question)
  - payment token + max amount
  - status + hired offer id (if any)
  - offers list (from API) ordered by time
- Actions:
  - "Make offer" (if connected wallet)
  - "Hire" (only requester) per offer

### 3) Create request page
Route: `apps/web/src/app/new/page.tsx` (or `/request/new`)
- Form:
  - `sourceURI` (string)
  - `question` (string)
  - `paymentToken` selector: ETH / USDC / custom address
  - `maxAmount` input (ETH or token decimals)
  - `salt` auto-generated (hidden by default, advanced toggle)
- Submit:
  - call contract `postRequest`
  - after tx confirm, compute `requestId` via:
    - parse tx logs (preferred), or
    - call API `/infofi/id` using same salt, or
    - compute client-side using shared function (later)
  - route to `/request/[requestId]`

### 4) Job detail page
Route: `apps/web/src/app/job/[jobId]/page.tsx`
- Show:
  - job participants (requester, consultant)
  - hired amount, remaining amount
  - delivery status, digest hash, metadataURI
  - payouts/refunds history
  - ratings section (if rated)
- Actions by role:
  - Consultant:
    - "Upload digest" -> stores digest via API `POST /digests`
    - "Deliver digest" -> contract `deliverDigest` with `digestHash` + `metadataURI`
  - Requester:
    - "Payout" -> contract `payoutByRequester`
    - "Refund" -> contract `refundByRequester`
  - Both:
    - "Rate" -> contract `rateJob` (once per side)

Deliverable:
- You can complete the same smoke flow from the browser.

## Phase 3: Components (Reusable Building Blocks)
- `RequestCard` / `RequestsTable`
- `OfferList` + `OfferCard`
- `PostRequestDialog` or dedicated page
- `PostOfferDialog`
- `HireOfferDialog`:
  - ETH path: send value
  - Token path: approve + hire
- `DeliverDigestDialog`:
  - textarea / markdown input
  - optional citations/proof fields
  - calls API then contract
- `PayoutDialog` + `RefundDialog`
- `RateDialog`

Implementation notes:
- Keep amounts as `bigint` in contract calls and display via `formatUnits`.
- Prefer optimistic UI with server refresh after tx receipt.

## Phase 4: UX Polish And Guardrails
- Add explicit fair-use notice near digest submission and request creation.
- Add warnings for:
  - requesting full text
  - very low budgets vs expected effort
- Add "copy metadataURI" and "view digest" actions.
- Add basic empty states and loading skeletons.
- Fix dev watcher issues (`EMFILE`):
  - set `WATCHPACK_POLLING=true` in web dev script, or document raising ulimit.

## Phase 5: Hardening
- Contract read reconciliation:
  - on request/job pages, compare API-indexed state vs on-chain reads and show "indexing lag" banner if mismatched.
- Error handling:
  - insufficient funds
  - token approval missing
  - wrong chain
  - stale nonce (if/when EIP-712 delegated path is added)
- Basic telemetry (optional):
  - log user actions client-side (console only in dev)

## Milestone Checklist (Ship v0)
- Post request (ETH) from UI
- Post offer from UI
- Hire offer (ETH) from UI
- Store digest in API DB and deliver on-chain from UI
- Payout by requester from UI
- View job closed state + digest content
- Post mutual ratings from UI

## Decisions Needed (Before Coding The UI)
- URL scheme:
  - prefer `/request/[requestId]` and `/job/[jobId]` (recommended), or a single `/r/[id]` compact route.
- Display preference:
  - table (dense) vs cards (browsing) for requests list.
- Token list:
  - fixed ETH+USDC only (simpler), or allow custom ERC-20 address input (more flexible).
