# InfoFi Implementation

## Decisions (v0)
- Network: Sepolia only.
- Market structure: requests + offers + hire recorded on-chain.
- Payout authority: requester-signed (EIP-712), no backend signer required for core payout.
- Digest storage: API DB (on-chain stores `digestHash` + `metadataURI` pointer).
- Payments: ETH + USDC (plus "any ERC-20" extensibility).

## One-line pitch
A decentralized marketplace where specialized agents act as paid "consultants" that bypass paywalls for other agents by delivering verified digests, summaries, and iterative Q&A from SaaS / academic / news sources, with instant and verifiable settlement.

## Problem
Agents are blind to paywalled, login-walled, or subscription-gated knowledge:

- X/Twitter articles (login walls)
- Academic publishers (Springer, ACM, IEEE, AAAS, etc.)
- Paywalled journalism (WSJ, WaPo, NatGeo, Economist, etc.)

This causes hallucinations, user copy/paste loops, and failure to answer.

## Core solution
Two-sided marketplace:

- Requester posts a URL + optional question(s).
- Consultant (human-backed or autonomous) with legitimate access bids or offers to fulfill.
- Consultant fetches content with their own credentials and returns a digest + answers; never forwards the raw file.
- Steps are recorded in an on-chain flow: hire -> deliver digest -> payment -> mutual ratings -> optional proof (eg zkTLS).

## Key principles / guardrails
- Fair-use: deliver summaries/answers, not full text, and never redistribute raw paywalled material.
- Composability: the marketplace should be usable by other agents via a CLI and HTTP APIs (eventually HTTP 402 / x402-native).
- Trust minimization: reputation by default; optional cryptographic proofs when feasible.
- Marketplace can survive as OSS infra (no central company dependency for core settlement).

## Current codebase
This repository is currently a straight copy of `seichris/clankergigs` (aka "gh-bounties"), which is extremely close to InfoFi: escrowed funding, claims, backend-authorized payouts (EIP-712 signatures), event indexing, agent-first CLI scripts, and a web UI.

The main adaptation is replacing "GitHub issue/PR" objects with "knowledge request / offer / digest" objects.

## Terminology mapping
- Bounty -> KnowledgeJob (or Request)
- Issue URL -> Source URL (paywalled/login-walled/etc.)
- PR URL -> Delivery URL / Digest metadata URI (could be a hosted digest page, IPFS, Arweave, etc.)
- Claim -> Delivery submission
- Repo admin payout authorization -> Requester authorization (or protocol signer authorization for safety rules)

## Reuse plan (from ClankerGigs)

### High reuse (keep almost as-is)
- `contracts/`: escrow + authorization patterns (EIP-712 authorizer, contribution accounting, payouts/refunds, time locks).
- `packages/shared/`: ID derivation patterns, shared types/helpers, address utilities.
- `scripts-for-ai-agents/`: environment templates + `cast`/`curl`/`jq` automation patterns.
- Event-driven indexer pattern in `apps/api/` (chain ingestion + local DB for fast reads).

### Medium reuse (keep pattern, swap domain logic)
- `apps/api/`:
  - Keep: Fastify + Prisma, chain indexer, device-flow auth scaffolding (if still useful), EIP-712 signing service pattern.
  - Swap: remove GitHub OAuth/webhooks/issue/PR checks; replace with request/offer/digest checks and optional proof verification endpoints.
- `apps/web/`:
  - Keep: wallet connection + contract reads/writes + list views.
  - Swap: UI surfaces (requests/offers/digests) and auth flows.

### Low reuse / delete candidates
- All GitHub-specific business logic (issues, PRs, repo admin checks, labels/comments automation).
- Any UI routes/components that are inherently "GitHub bounties" specific.

## Proposed v0 architecture (fast path to "working")
We will keep the core marketplace actions on-chain (requests, offers, hire, deliver hash, ratings) and keep the *digest content* off-chain (API DB):

- On-chain:
  - `RequestPosted`: request creation with `sourceURI` + question + constraints.
  - `OfferPosted`: consultant offers price/ETA/proof type.
  - `OfferHired`: requester escrows ETH/USDC against a chosen offer.
  - `DigestDelivered`: consultant posts `digestHash` + `metadataURI` (points into API DB).
  - `Rated`: mutual ratings (requester rates consultant; consultant rates requester).
  - `Payout` / `Refund`: settlement via requester EIP-712 signatures (either side can submit the tx, but requester must authorize).

- Off-chain (API + DB):
  - Digest payload storage keyed by `jobId` / `requestId` (the digest itself, plus a canonical hash that is posted on-chain).
  - Read models for fast querying (indexing chain events into a DB for UI/CLI).

This reuses ClankerGigs' EIP-712 authorization pattern, but swaps the signer to `requester` (stored per job) instead of GitHub-derived admins or a backend signer.

## Smart contract changes (sketch)
Starting from `contracts/src/GHBounties.sol`:

Rather than trying to mutate the existing "GitHub bounty" storage, v0 should introduce first-class InfoFi concepts (names tentative):

- Entities:
  - `Request`: `requestId`, `requester`, `sourceURI`, `question`, `paymentToken` (0 for ETH), `maxAmount`, `createdAt`, `status`.
  - `Offer`: `offerId`, `requestId`, `consultant`, `amount`, `etaSeconds`, `proofType`, `createdAt`, `status`.
  - `Job`: derived from a hired offer: `jobId`, `requestId`, `offerId`, `requester`, `consultant`, `paymentToken`, `amount`, `hiredAt`, `deliveredAt`, `digestHash`, `metadataURI`.

- ID scheme (simple, collision-resistant, deterministic):
  - `requestId = keccak256(abi.encodePacked(requester, keccak256(bytes(sourceURI)), keccak256(bytes(question)), salt))`
  - `offerId = keccak256(abi.encodePacked(requestId, consultant, amount, etaSeconds, salt))`
  - `jobId = keccak256(abi.encodePacked(offerId, requester))`

- Core flows:
  - `postRequest(...)` -> emits `RequestPosted`.
  - `postOffer(requestId, ...)` -> emits `OfferPosted`.
  - `hireOffer(offerId)` -> escrows ETH (via `msg.value`) or pulls ERC-20 (USDC) into escrow; emits `OfferHired`.
  - `deliverDigest(jobId, digestHash, metadataURI, proofTypeOrURI)` -> emits `DigestDelivered`.
  - `rate(jobId, stars, uri)` with `msg.sender` restricted to requester/consultant; emits `Rated`.

- Settlement (requester-signed, EIP-712):
  - `payoutWithAuthorization(jobId, token, recipient, amountWei, nonce, deadline, signature)`
    - `signature` must be signed by `requester` for that `jobId`.
    - Contract enforces `deliveredAt != 0` before payout (so "deliver" is part of the on-chain story).
  - `refundWithAuthorization(jobId, token, funder, amountWei, nonce, deadline, signature)`
    - Signed by `requester` (escrow owner) to return funds (eg if consultant fails to deliver).

- Token support:
  - ETH: `paymentToken = address(0)`.
  - USDC: configured in the webapp/CLI as default for Sepolia; contract supports any ERC-20 for extensibility.

This is still "instant and verifiable on-chain settlement" while keeping the actual digest content off-chain.

## API changes (sketch)
Starting from `apps/api/`:

The API becomes primarily an indexer + digest store (not the source of truth for offers/hiring):

- Indexer:
  - Ingest chain events into Prisma models so web/CLI can query without scanning RPC logs.
- Digest store:
  - `POST /digests` store `{ jobId, sourceURI, question, digest, citations?, proof?, consultantAddress }`.
  - Returns `{ digestId, digestHash, metadataURI }` where `metadataURI` is an API URL for retrieval.
  - `GET /digests/:digestId` returns digest payload (initially public; can add auth later).

No GitHub OAuth/webhooks needed for v0.

## CLI changes (sketch)
Starting from `scripts-for-ai-agents/` and `infofi-cli/`:

- New commands (examples):
  - `infofi post-request <url> --question ...`
  - `infofi list-requests`
  - `infofi post-offer <requestId> --price ... --proof zktls`
  - `infofi hire <offerId> --fund <amount>`
  - `infofi deliver-digest <jobId> --digest-file ...`
  - `infofi rate <jobId> --stars 5 --as requester|consultant`

## Initial categories (seed consultants)
- WeKnowComputerScience (ACM, IEEE, Springer, arXiv+)
- WeKnowNews (WaPo, NYT, Economist, etc.)
- Expand to community agents over time.

## Open questions (need decisions)
1) Anti-spam: do we require a minimum escrow/bond to post a request or offer?
2) Request format: should `sourceURI` be any URL, or should we store a `sourceId` type (eg DOI, URL, SaaS slug) with normalization?
3) Failure modes: do we add timeouts (eg if not delivered by `hiredAt + etaSeconds`, requester can refund unilaterally)?
4) Ratings: do we store ratings strictly on-chain, or just events + API-indexed aggregation (same UX either way)?
5) Proofs: v0 proof types should likely just be `reputation-only` vs `zktls-available` flags; the proof plumbing can land later.

## Suggested v0 milestone (weekend scope)
- Rename/rebrand surfaces (docs + CLI entrypoints) to InfoFi.
- New API objects: `requests`, `offers`, `digests`.
- Keep escrow/payout/refund pattern; swap "GitHub admin auth" to "requester auth".
- Minimal web UI: post request, view offers, hire, view delivered digest hash/URI, rate.
