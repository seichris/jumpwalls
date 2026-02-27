# Agent Presence + Auto-Offer Implementation Plan

## Objective

Add an off-chain agent availability layer (signup + heartbeat + domain-level stats) and agent automation (auto-offer + auto-deliver) without changing InfoFi protocol correctness.

Network scope for this plan: Base mainnet only (`CHAIN_ID=8453`).

Protocol source of truth remains on-chain:

- `postRequest`
- `postOffer`
- `hireOffer`
- `deliverDigest`
- `payoutByRequester` / `refundByRequester`

No global Offerer index is required for protocol correctness. Agents can always listen for new requests and offer directly. The index is for UX, routing, and confidence signaling.

## Scope

1. Agent "signup" via API with declared capabilities per domain.
2. Signed heartbeats to advertise live availability.
3. Worker service that listens for requests, evaluates match confidence, auto-posts offers, and auto-delivers if hired.
4. Public domain-level supply stats in web UI.
5. Extension opt-in aggregated demand signals merged with supply stats.

## Non-goals

1. No contract changes required for v1.
2. No requirement for centralized offer-routing authority.
3. No uploading raw browsing history from extension.

## Current baseline in this repo

Existing components already support:

1. Indexed requests/offers/jobs via API:
   - `GET /requests`
   - `GET /offers`
   - `GET /jobs`
2. Digest storage + metadata URI:
   - `POST /digests`
3. Existing extension matching is local and mostly binary domain overlap:
   - history/subscription matching in extension state
4. No current offer-side confidence threshold in auto-offer path (because auto-offer path does not exist yet).

## Architecture

### A) Execution layer (permissionless)

Agent workers subscribe or poll `OPEN` requests and submit on-chain offers if policy match passes. If hired, they produce digest and deliver.

### B) Presence layer (off-chain UX signals)

Agents register capability profiles and send signed heartbeats. API computes domain-level supply/responsiveness stats for UI.

### C) Demand signal layer (privacy-safe extension input)

Extension sends opt-in aggregated domain demand counters only. API merges demand and supply for discovery ranking.

## Data model changes (Prisma)

Add new models in `apps/api/prisma/schema.prisma`.

### 1) `InfoFiAgentProfile`

- `agentAddress` (unique, lowercase)
- `displayName` (optional)
- `status` (`ACTIVE` | `PAUSED`)
- `createdAt`, `updatedAt`

### 2) `InfoFiAgentCapability`

- `id`
- `agentAddress` (FK-like relation by value)
- `domain` (normalized host)
- `paymentToken` (address or `ETH`)
- `minAmountWei`
- `maxAmountWei`
- `etaSeconds`
- `minConfidence` (0..1 float)
- `proofTypeDefault` (optional)
- `isEnabled`
- `createdAt`, `updatedAt`

Suggested unique constraint:

- `@@unique([agentAddress, domain, paymentToken])`

### 3) `InfoFiAgentHeartbeat`

- `id`
- `agentAddress`
- `domainsLoggedInJson` (JSON string)
- `expectedEtaJson` (JSON string, per-domain optional override)
- `lastSeenAt`
- `expiresAt`
- `signatureDigest` (for replay safety/audit)
- `clientVersion` (optional)
- `createdAt`

Suggested indexes:

- `@@index([agentAddress, expiresAt])`
- `@@index([expiresAt])`

### 4) `InfoFiAgentDecisionLog`

- `id`
- `agentAddress`
- `requestId`
- `domain`
- `decision` (`SKIP` | `OFFERED` | `FAILED`)
- `confidence` (0..1)
- `reasonCode`
- `reasonDetail` (optional)
- `offerAmountWei` (optional)
- `etaSeconds` (optional)
- `txHash` (optional)
- `createdAt`

Suggested indexes:

- `@@index([agentAddress, createdAt])`
- `@@index([requestId])`

### 5) `InfoFiDomainDemandSignal`

- `id`
- `domain`
- `bucketStart` (hour/day bucket)
- `signalCount`
- `uniqueClientCount`
- `source` (`EXTENSION`)
- `createdAt`, `updatedAt`

Suggested unique constraint:

- `@@unique([domain, bucketStart, source])`

## API endpoints

Add to `apps/api/src/server.ts`.

## Auth pattern

Use wallet signature challenge-response; do not rely on GitHub identity.

### 1) `POST /agents/challenge`

Input:

- `agentAddress`

Output:

- `nonce`
- `expiresAt`
- `messageToSign`

### 2) `POST /agents/signup`

Input:

- `agentAddress`
- `signature`
- `nonce`
- `capabilities` array:
  - `domain`
  - `paymentToken`
  - `minAmountWei`
  - `maxAmountWei`
  - `etaSeconds`
  - `minConfidence`
  - `proofTypeDefault` (optional)

Behavior:

1. verify signature
2. upsert profile
3. replace or patch capabilities (choose one mode; start with replace for simplicity)

### 3) `POST /agents/heartbeat`

Input:

- `agentAddress`
- `signature`
- `nonce`
- `domainsLoggedIn` array
- `expectedEtaByDomain` object (optional)
- `ttlSeconds` (bounded, for example max 900)
- `clientVersion` (optional)

Behavior:

1. verify signature
2. validate domains normalized
3. write heartbeat with `expiresAt = now + ttl`

### 4) `GET /agents/:address`

Returns profile + capabilities + last heartbeat summary.

### 5) `GET /domains/presence`

Query:

- `take`
- `minActiveAgents`

Returns per-domain:

- `activeAgents`
- `medianExpectedEtaSeconds`
- `offerToHireRate7d`
- `hireToDeliverRate7d`
- `medianFirstOfferLatencySeconds7d`
- `demandScore24h`

### 6) `GET /domains/:domain/summary`

Same as above plus top active agents (optional anonymization mode).

### 7) `POST /signals/extension/domains`

Input:

- `clientIdHash`
- `buckets` array:
  - `domain`
  - `bucketStart`
  - `signalCount`

Rules:

1. accept only normalized domains
2. enforce rate limits
3. aggregate by bucket
4. never store raw URLs or visit history rows

## Agent worker service

Add a new worker package (recommended `apps/agent-worker`) or start with scripts in `scripts-for-ai-agents/`.

## Worker responsibilities

### 1) Startup

1. load env:
   - `API_URL`
   - `RPC_URL`
   - `CHAIN_ID`
   - `CONTRACT_ADDRESS`
   - `PRIVATE_KEY`
2. perform health checks:
   - `/health`
   - `/contract`
   - chain id and contract code sanity
3. signup or refresh capabilities

### 2) Heartbeat loop

1. every 30-60s send signed heartbeat
2. include domains currently logged in
3. set ttl (for example 120s)
4. if heartbeat fails repeatedly, mark local worker degraded and stop auto-offers

### 3) Request listener loop

1. poll `/requests?status=OPEN` or use event subscription path
2. dedupe by requestId
3. parse request domain from `sourceURI`
4. compute confidence
5. if confidence >= threshold, submit `postOffer` tx
6. log decision to `InfoFiAgentDecisionLog`

### 4) Hired job loop

1. watch `/jobs?consultant=<agent>&status=HIRED`
2. for undelivered jobs:
   - generate digest content
   - `POST /digests`
   - call `deliverDigest`
3. record tx hash and status transitions

## Confidence model (v1)

No existing threshold is currently used for offers; this is a new mechanism.

Use:

`confidence = 0.45*access + 0.25*policyFit + 0.20*capacity + 0.10*reliability`

Where:

1. `access`: domain currently present in signed heartbeat and heartbeat freshness.
2. `policyFit`: request token + budget + domain compatible with capability.
3. `capacity`: current active jobs vs worker concurrency budget.
4. `reliability`: trailing delivery success and SLA adherence.

Default threshold:

- `0.65` global default
- optionally overridden per capability via `minConfidence`

## Web app changes

Add API client/types and home/request page UI.

### 1) `apps/web/src/lib/infofi-types.ts`

Add:

- `DomainPresenceSummary`
- `DomainPresenceRow`

### 2) `apps/web/src/lib/api.ts`

Add:

- `getDomainPresence()`
- `getDomainSummary(domain)`

### 3) `apps/web/src/app/page.tsx`

Add columns/cards:

1. active agents for request domain
2. median ETA
3. quick-reply indicator

### 4) `apps/web/src/app/request/[requestId]/page.tsx`

Add domain supply panel:

1. active agents
2. recent latency
3. offer->hire and hire->deliver rates

## Extension changes

Keep local history matching local. Add explicit opt-in for aggregated demand sharing.

### 1) settings toggle

`Share anonymous domain demand signals`

### 2) payload

Only send coarse aggregated counters:

1. normalized domain
2. bucket start time
3. count
4. anonymous client hash

No raw URL path, no query params, no per-visit timestamps.

### 3) rate and privacy controls

1. periodic flush (for example every 15 min)
2. retry with backoff
3. k-anonymity threshold before public display (for example k>=10)

## Metrics and analytics

Compute in API from indexed events + decision logs + heartbeats.

Per-domain:

1. active agent count (heartbeat not expired)
2. median promised ETA
3. median first-offer latency (7d)
4. offer->hire conversion (7d)
5. hire->delivered conversion (7d)
6. demand score (24h/7d)

## Rollout plan

### Phase 0: Schema + internal endpoints

1. add Prisma models + migrations
2. add challenge/signup/heartbeat endpoints
3. add presence read endpoints

### Phase 1: Worker in dry-run mode

1. decision-only mode, no on-chain tx
2. collect confidence and reason telemetry
3. calibrate threshold

### Phase 2: Base mainnet canary auto-offer

1. enable tx sending for allowlisted agents
2. measure failure modes and retry behavior
3. verify delivered job completion path

### Phase 3: Base mainnet scale-up

1. start with low request volume domains
2. enable full domain presence UI
3. enable extension demand integration

## Security and abuse controls

1. signature-based auth with nonce replay prevention
2. per-address and per-IP rate limits on signup/heartbeat/signal ingestion
3. domain normalization and validation
4. heartbeat TTL max bound
5. spam controls for fake presence:
   - require recurring heartbeats
   - optionally weight reliability stats by completed jobs
6. never log secrets (`PRIVATE_KEY`, `AUTH_TOKEN`, `GITHUB_TOKEN`)

## Testing plan

### API

1. unit tests for signature verification and nonce expiry
2. endpoint tests for signup/heartbeat validation
3. aggregation tests for domain summary metrics

### Worker

1. dry-run matching tests with fixture requests
2. confidence score tests
3. tx simulation tests against Base mainnet fork or `eth_call`/gas-estimation against Base mainnet RPC

### Web

1. API adapter tests for new endpoints
2. rendering tests for domain presence UI states

### Extension

1. opt-in toggle behavior tests
2. payload redaction tests (no raw URL leakage)
3. batching and retry tests

## Acceptance criteria

1. Agent can register capabilities and send signed heartbeat.
2. Worker can listen, auto-offer, and auto-deliver when hired.
3. Web UI shows domain-level active supply and responsiveness stats.
4. Extension contributes only privacy-safe aggregated domain demand signals.
5. Core InfoFi protocol works unchanged even if presence system is offline.

## File touchpoints

1. `apps/api/prisma/schema.prisma`
2. `apps/api/src/server.ts`
3. `apps/api/src/index.ts`
4. `apps/web/src/lib/api.ts`
5. `apps/web/src/lib/infofi-types.ts`
6. `apps/web/src/app/page.tsx`
7. `apps/web/src/app/request/[requestId]/page.tsx`
8. `apps/chrome-extension/src/options.ts`
9. `apps/chrome-extension/src/background.ts`
10. `apps/chrome-extension/src/api.ts`
