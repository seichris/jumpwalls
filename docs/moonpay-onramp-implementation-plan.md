# MoonPay Onramp Implementation Plan (InfoFi)

## Goal
Add a credit/debit card onramp using MoonPay so users can buy `ETH` or `USDC` to their wallet, then continue the existing InfoFi on-chain flow without changing contract logic.

## Critical Constraint
MoonPay onramp funds production assets/networks; InfoFi web currently defaults to Sepolia (`11155111`).

Plan implication:
- Mainnet UX: enable MoonPay onramp.
- Sepolia UX: keep faucet/dev instructions and show "onramp not available for Sepolia funding" when appropriate.

## Integration Choice
Phase 1 should use **MoonPay URL integration with server-side URL signing**:
- Frontend requests a signed onramp URL from `apps/api`.
- Backend builds and signs the URL with MoonPay secret key.
- Frontend opens MoonPay hosted flow (new tab or overlay).
- MoonPay redirects back to InfoFi success page with transaction query params.

Why this path first:
- Minimal integration surface.
- Keeps signing key server-side.
- No dependency on additional frontend SDKs to ship MVP.

## Scope
- In scope: signed buy URL creation, hosted flow launch, redirect/success handling, basic transaction status lookup, chain gating.
- Out of scope (initial): off-ramp, swaps, mobile SDK integrations, advanced theming, auto-bridge to Sepolia.

## Phase 0: Product + Technical Decisions
1. Confirm launch network (`ethereum` mainnet recommended).
2. Confirm token mapping in MoonPay:
   - ETH: `eth`
   - USDC: MoonPay currency code configured for your target network in your dashboard
3. Confirm default fiat config:
   - `baseCurrencyCode=usd`
   - default amount (for example `50`)
4. Confirm whether to preselect payment method:
   - `paymentMethod=credit_debit_card` (fallback to MoonPay selection if unavailable)
5. Confirm redirect paths:
   - `success`: `/onramp/moonpay/success`
   - `cancel/fallback`: same page with failure status messaging

Deliverable:
- Signed-off config decisions for asset codes, amount defaults, and redirect behavior.

## Phase 1: API URL Signing + Session Bootstrap
Implement MoonPay backend integration in `apps/api`.

### 1) Environment variables
Add to env schema and deployment:
- `MOONPAY_ENABLED` (default `false`)
- `MOONPAY_ENVIRONMENT` (`sandbox` or `production`)
- `MOONPAY_PUBLISHABLE_KEY` (`pk_test_*` / `pk_live_*`)
- `MOONPAY_SECRET_KEY` (`sk_test_*` / `sk_live_*`)
- `MOONPAY_WEBHOOK_KEY` (webhook signature key; Phase 3)
- `MOONPAY_BASE_URL` (optional override; defaults by environment)

Files:
- `/apps/api/src/env.ts`
- `.env.example` and app-level env examples in use by this repo

### 2) MoonPay integration module
Create a small server module with:
- `buildMoonPayBuyUrl(params)` for deterministic query construction.
- `signMoonPayUrl(url)` using HMAC SHA-256 + base64.
- `createSignedMoonPayBuyUrl(input)` returning full signed URL.
- `verifyMoonPayWebhookSignature(header, payload)` (Phase 3).

Implementation notes:
- Keep query param order stable before signing.
- URL-encode param values before signature generation.
- Append `signature` as the final query parameter.

File:
- `/apps/api/src/moonpay/onramp.ts` (new)

### 3) API routes
Add:
1. `POST /moonpay/onramp-url`
2. `GET /moonpay/transaction/ext/:externalTransactionId` (optional but recommended)

`POST /moonpay/onramp-url` request body:
- `walletAddress` (required)
- `asset` (`ETH` or `USDC`)
- `baseCurrencyAmount` (optional)
- `baseCurrencyCode` (optional, default `usd`)
- `context` (optional object for request/job references)

Response:
- `url` (signed URL)
- `externalTransactionId`
- `expiresAt` (if you enforce local TTL)

URL params to include:
- `apiKey`
- `currencyCode`
- `walletAddress`
- `baseCurrencyCode`
- `baseCurrencyAmount`
- `redirectURL`
- `externalTransactionId`
- `externalCustomerId` (wallet or internal user id)
- `paymentMethod=credit_debit_card` (optional)

Files:
- `/apps/api/src/server.ts`
- `/apps/api/src/index.ts` only if route wiring requires it

### 4) Security controls
1. Fail closed when `MOONPAY_ENABLED=false`.
2. Never expose `MOONPAY_SECRET_KEY` to client logs or responses.
3. Rate-limit `POST /moonpay/onramp-url` by IP and wallet.
4. Validate `walletAddress` with EVM address checks.

Deliverable:
- Backend returns a valid signed MoonPay buy URL in sandbox.

## Phase 2: Web Integration (Hosted Redirect)
Implement MoonPay UX in `apps/web`.

### 1) Frontend API client methods
Add:
- `createMoonPayOnrampUrl(input)`
- `getMoonPayTransactionByExternalId(externalTransactionId)` (optional)

File:
- `/apps/web/src/lib/api.ts`

### 2) Reusable onramp component
Create:
- `MoonPayOnrampDialog` with:
  - Asset selector (`ETH`/`USDC`)
  - Fiat amount input
  - "Buy with card" action
- On submit:
  - call `POST /moonpay/onramp-url`
  - open returned URL

File:
- `/apps/web/src/components/infofi/moonpay-onramp-dialog.tsx` (new)

### 3) Placement
Add CTA where users need funding:
1. `/request/new`
2. `/request/[requestId]` near hire/funding actions

Files:
- `/apps/web/src/app/request/new/page.tsx`
- `/apps/web/src/app/request/[requestId]/page.tsx`

### 4) Success/return page
Add route:
- `/onramp/moonpay/success`

Behavior:
- Read `transactionId` + `transactionStatus` from query params.
- Show status-aware next steps:
  - `pending`: wait and retry check
  - completed states: continue with posting/hiring
  - failed/canceled: show fallback guidance

File:
- `/apps/web/src/app/onramp/moonpay/success/page.tsx` (new)

### 5) Chain gating
When wallet chain is Sepolia:
- Disable/annotate onramp CTA with explicit reason.
- Provide faucet/dev path for Sepolia testing.

Deliverable:
- User can launch MoonPay from InfoFi and return to a usable success screen.

## Phase 3: Webhooks + Persistence (Recommended)
Add reliable asynchronous status updates in `apps/api`.

### 1) Prisma models
Add:
- `MoonpayOnrampSession` (one row per generated external transaction id)
- `MoonpayWebhookEvent` (idempotency ledger)

Fields:
- external transaction id, wallet, asset, amount, status, raw payload, timestamps

File:
- `/apps/api/prisma/schema.prisma`

### 2) Webhook route
Add:
- `POST /webhooks/moonpay`

Behavior:
1. Verify `Moonpay-Signature-V2` using `MOONPAY_WEBHOOK_KEY`.
2. Parse event and upsert session status.
3. Store webhook event idempotently.

File:
- `/apps/api/src/server.ts`

Deliverable:
- Status updates continue even if user closes the browser.

## Phase 4: Hardening + Rollout
1. Feature flag rollout (`MOONPAY_ENABLED` plus optional allowlist).
2. Observability:
   - URL creation success rate
   - redirect-start rate
   - completion rate
   - failure/unsupported-region rate
3. Alert on webhook signature failures and status processing errors.

Deliverable:
- Controlled production launch with monitoring.

## Testing Plan
1. Unit tests:
   - URL parameter normalization
   - deterministic signature generation
   - webhook signature verification
2. Integration tests:
   - `POST /moonpay/onramp-url` validation and response shape
   - webhook idempotency handling
3. Manual sandbox QA:
   - ETH flow
   - USDC flow
   - unsupported geography
   - canceled payment flow
   - Sepolia chain-gated behavior
4. Regression:
   - existing InfoFi post/hire/deliver/payout flow remains unchanged

## Acceptance Criteria (MVP)
1. Connected user can click "Buy with card" and launch MoonPay via signed URL.
2. Wallet address is prefilled and protected by signature.
3. User returns to `/onramp/moonpay/success` with transaction status feedback.
4. No secret keys are exposed in frontend code or logs.
5. Sepolia UX clearly explains onramp limitation for testnet funding.

## File-Level Change Map
- `/apps/api/src/env.ts`
- `/apps/api/src/server.ts`
- `/apps/api/src/moonpay/onramp.ts` (new)
- `/apps/api/prisma/schema.prisma` (Phase 3)
- `/apps/web/src/lib/api.ts`
- `/apps/web/src/components/infofi/moonpay-onramp-dialog.tsx` (new)
- `/apps/web/src/app/request/new/page.tsx`
- `/apps/web/src/app/request/[requestId]/page.tsx`
- `/apps/web/src/app/onramp/moonpay/success/page.tsx` (new)

## Risks and Mitigations
1. Wrong currency code selection for USDC/network.
   - Mitigation: source currency codes from MoonPay dashboard config and test both sandbox/live.
2. Signature failures from query reordering/encoding.
   - Mitigation: deterministic param builder and signature tests.
3. Drop-off after redirect.
   - Mitigation: webhook-based status persistence.
4. Mainnet/testnet expectation mismatch.
   - Mitigation: explicit chain gating and copy in funding UI.

## Reference Docs
- https://dev.moonpay.com/docs/on-ramp-architecture
- https://dev.moonpay.com/docs/on-ramp-web-sdk
- https://dev.moonpay.com/docs/ramps-sdk-buy-params
- https://dev.moonpay.com/docs/on-ramp-enhance-security-using-signed-urls
- https://dev.moonpay.com/reference/reference-webhooks-overview
- https://dev.moonpay.com/reference/reference-webhooks-signature
- https://dev.moonpay.com/reference/getbuytransactionbyexternalid-1
