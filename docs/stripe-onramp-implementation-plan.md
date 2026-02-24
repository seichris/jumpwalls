# Stripe Onramp Implementation Plan (InfoFi)

## Goal
Add a card-based fiat onramp so users can buy `ETH` or `USDC` into their wallet, then continue the existing InfoFi on-chain flow (`postRequest`, `hireOffer`, payouts, ratings) without changing contract logic.

## Critical Constraint
Stripe onramp destination networks are production networks (for example `ethereum`, `base`). The current InfoFi web default chain is Sepolia (`11155111`), so onramped funds are not directly usable on Sepolia.

Plan implication:
- Mainnet UX: enable Stripe onramp.
- Sepolia UX: keep faucet/dev instructions and show an explicit "onramp not available for Sepolia" message.

## Integration Choice
Phase 1 should use the **Stripe-hosted onramp** (redirect flow) because it is the fastest and lowest-risk path:
- Server mints onramp session.
- Server returns `redirect_url`.
- Frontend redirects user to Stripe-hosted checkout.
- User returns to a success page in the app.

Embedded onramp can be a later phase once hosted flow is stable.

## Scope
- In scope: onramp session creation, redirect flow, return page, chain gating, basic status checks.
- Out of scope (initial): off-ramp, recurring purchases, native mobile SDK, automatic bridge/swap across networks.

## Prerequisites
1. Stripe onramp application approved for your account.
2. Sandbox and live keys available.
3. Product decision on launch chain:
   - `ethereum` mainnet only, or
   - `base` (and whether contracts also deploy there).

## Phase 0: Product + Technical Decisions
1. Confirm initial supported network for funding destination (`ethereum` recommended first).
2. Confirm whether to lock user wallet address in session (`lock_wallet_address=true` recommended).
3. Confirm amount model:
   - `source_amount` (USD input) recommended for user clarity.
4. Confirm initial CTA placement:
   - `/request/new` and `/request/[requestId]` near budget/hire actions.
5. Confirm feature flag name and rollout policy.

Deliverable:
- Signed-off decision log for network, amount model, wallet lock, and rollout flag.

## Phase 1: API Session Minting
Implement server-side Stripe session minting in `apps/api`.

### 1) Environment variables
Add to env schema and deployment config:
- `STRIPE_SECRET_KEY`
- `STRIPE_ONRAMP_ENABLED` (boolean-ish string, default `false`)
- `STRIPE_ONRAMP_DEFAULT_NETWORK` (for example `ethereum`)
- `STRIPE_WEBHOOK_SECRET` (used in later phase)

Files:
- `/apps/api/src/env.ts`
- `.env.example` (root and/or app-level examples used by team)

### 2) Stripe API client module
Create a small typed wrapper that calls Stripe via `fetch`:
- `createOnrampSession(...)` -> `POST /v1/crypto/onramp_sessions`
- `retrieveOnrampSession(sessionId)` -> `GET /v1/crypto/onramp_sessions/:id`

Notes:
- Keep Stripe secret key server-side only.
- Map InfoFi asset enum to Stripe currency enum:
  - `ETH` -> `eth`
  - `USDC` -> `usdc`
- Map selected app network to Stripe `destination_network`.
- Include `wallet_addresses[...]` and `customer_ip_address`.

File:
- `/apps/api/src/stripe/onramp.ts` (new)

### 3) API routes
Add:
1. `POST /onramp/session`
2. `GET /onramp/session/:id`

Request validation for `POST /onramp/session`:
- `walletAddress` (required, EVM address)
- `asset` (`ETH` or `USDC`)
- `sourceAmountUsd` (optional, numeric string)
- `network` (optional override, else default)

Response:
- `sessionId`
- `redirectUrl`
- `status`
- normalized session metadata used by frontend

Files:
- `/apps/api/src/server.ts`
- `/apps/api/src/index.ts` only if route registration pattern requires it

### 4) Security and abuse controls
1. Fail closed when `STRIPE_ONRAMP_ENABLED=false`.
2. Add per-IP/per-wallet rate limiting at endpoint boundary.
3. Redact secrets and avoid logging full Stripe payloads.
4. Validate CORS expectations with existing `WEB_ORIGIN` handling.

Deliverable:
- API can mint hosted onramp sessions and return redirect URLs in sandbox mode.

## Phase 2: Web App Integration (Hosted Redirect)
Implement onramp entry and return UX in `apps/web`.

### 1) Frontend API client methods
Add:
- `createOnrampSession(input)`
- `getOnrampSession(sessionId)`

File:
- `/apps/web/src/lib/api.ts`

### 2) Onramp CTA component
Create reusable component:
- `OnrampDialog` (asset select + optional USD amount)
- Calls `POST /onramp/session`
- Redirects to `redirectUrl`

File:
- `/apps/web/src/components/infofi/onramp-dialog.tsx` (new)

### 3) Placement
Add CTA where users hit funding friction:
1. `/request/new` when wallet connected and balance likely low.
2. `/request/[requestId]` near hire action.

Files:
- `/apps/web/src/app/request/new/page.tsx`
- `/apps/web/src/app/request/[requestId]/page.tsx`

### 4) Return/success page
Add route to handle post-onramp return:
- `/onramp/success` with query/session id
- fetch status from API and render next-step CTA:
  - `fulfillment_complete`: continue to posting/hiring
  - `fulfillment_processing`: show pending state and refresh
  - `rejected`: show fallback guidance

File:
- `/apps/web/src/app/onramp/success/page.tsx` (new)

### 5) Chain gating UX
If wallet is on Sepolia:
- Disable onramp button.
- Show explicit reason and faucet/dev alternative.

Deliverable:
- User can start onramp from app and return to app after checkout.

## Phase 3: Webhooks + Persistence (Recommended After MVP)
Add reliable asynchronous status tracking.

### 1) Prisma models
Add tables:
- `StripeOnrampSession`
- `StripeOnrampEvent` (idempotency by event id)

Fields include:
- session id, wallet address, asset/network, status, timestamps
- raw event JSON (optional, bounded)

File:
- `/apps/api/prisma/schema.prisma`

### 2) Webhook endpoint
Add:
- `POST /webhooks/stripe`

Behavior:
1. Verify Stripe signature using `STRIPE_WEBHOOK_SECRET`.
2. Handle `crypto.onramp_session_updated`.
3. Upsert session status and store event idempotently.

File:
- `/apps/api/src/server.ts`

### 3) Optional UI history
Show recent onramp attempts/status in account area or success page.

Deliverable:
- Backoffice-grade status reliability even if user closes browser before returning.

## Phase 4: Hardening + Rollout
1. Feature flag by environment and/or allowlist.
2. Metrics:
   - session created
   - redirect started
   - fulfillment complete rate
   - rejection rate
3. Alerting on webhook failures and high rejection spikes.
4. Production rollout:
   - internal users
   - small percentage
   - full rollout

Deliverable:
- Controlled and observable production launch.

## Testing Plan
1. Unit tests (API):
   - payload mapping `ETH/USDC` -> Stripe params
   - validation and error mapping
2. Integration tests (API):
   - mocked Stripe responses for create/retrieve
3. Manual sandbox QA:
   - ETH happy path
   - USDC happy path
   - unsupported geography handling
   - rejected KYC path
   - Sepolia chain-gated UX
4. Regression checks:
   - existing InfoFi request/offer/hire/deliver/payout flow unchanged

## Acceptance Criteria (MVP)
1. Connected user can click "Buy with card", choose `ETH` or `USDC`, and be redirected to Stripe-hosted onramp.
2. User returns to `/onramp/success` and sees session status.
3. On supported production network, purchased asset appears in wallet and user can continue InfoFi action.
4. On Sepolia, app clearly explains that card onramp is unavailable for testnet funding.
5. No Stripe secret keys exposed client-side or in logs.

## File-Level Change Map
- `/apps/api/src/env.ts`
- `/apps/api/src/server.ts`
- `/apps/api/src/stripe/onramp.ts` (new)
- `/apps/api/prisma/schema.prisma` (Phase 3)
- `/apps/web/src/lib/api.ts`
- `/apps/web/src/components/infofi/onramp-dialog.tsx` (new)
- `/apps/web/src/app/request/new/page.tsx`
- `/apps/web/src/app/request/[requestId]/page.tsx`
- `/apps/web/src/app/onramp/success/page.tsx` (new)

## Risks and Mitigations
1. Network mismatch (mainnet onramp vs Sepolia app).
   - Mitigation: explicit chain gating + mainnet deployment plan.
2. Geography/payment method variability.
   - Mitigation: handle unsupported/rejected states gracefully; do not hardcode method claims in UI.
3. API abuse on session mint endpoint.
   - Mitigation: rate limiting and request validation.
4. Lost status updates if user drops off.
   - Mitigation: add webhook ingestion and persisted session tracking.
