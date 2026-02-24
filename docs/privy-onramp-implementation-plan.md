# Privy Funding Implementation Plan (InfoFi)

## Goal
Add a card onramp flow via Privy so users can fund wallets with `ETH` or `USDC`, then continue the existing InfoFi on-chain flow (`postRequest`, `hireOffer`, `deliverDigest`, settlement) without changing contract behavior.

## Why Privy For This
Privy gives a single funding surface (`useFundWallet`) that can route card purchases through supported providers (for example MoonPay/Coinbase Pay), while letting you control asset, chain, and destination wallet from the app UI.

## Critical Constraint
InfoFi web defaults to Sepolia today (`11155111`). Card onramps generally fund production assets/networks.

Plan implication:
- Production chain UX: enable card funding.
- Sepolia UX: keep explicit testnet funding guidance and disable/annotate card onramp where unsupported.

## Recommended Rollout Strategy
Use a two-step rollout to reduce risk:

1. **MVP (recommended first): Privy funding + existing transaction signing path**
   - Keep existing `window.ethereum` transaction flow for InfoFi contract writes.
   - Add Privy only for funding UX.
2. **Phase 2 (optional): Full Privy wallet abstraction**
   - Support embedded wallets as first-class signers for InfoFi transactions.

This avoids a large wallet refactor in the first release.

## Phase 0: Product Decisions
1. Choose launch network for funded assets (`ethereum` recommended first).
2. Confirm supported assets (`ETH`, `USDC`) and exact USDC network variant.
3. Choose default fund amount (for example `50 USD`).
4. Decide whether to force card as initial funding method.
5. Decide whether to lock destination wallet to connected wallet (recommended).

Deliverable:
- Signed-off decisions for chain, assets, defaults, and wallet-lock behavior.

## Phase 1: Add Privy Foundation (Web)
Implement core Privy setup in `apps/web`.

### 1) Dependencies
Add:
- `@privy-io/react-auth`

File:
- `/apps/web/package.json`

### 2) Environment variables
Add:
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_CLIENT_ID`
- `NEXT_PUBLIC_PRIVY_ENABLED` (default `false`)

Files:
- `/apps/web/.env.local.example`
- root `.env.example` (if you keep shared env docs there)

### 3) Provider wiring
Add a client provider wrapper:
- `PrivyProvider` with app/client IDs and funding-friendly config.
- Wrap app content in this provider.

Files:
- `/apps/web/src/components/providers/privy-provider.tsx` (new)
- `/apps/web/src/app/layout.tsx`

Deliverable:
- App boots with Privy initialized behind feature flag.

## Phase 2: Funding UX (MVP)
Add a reusable funding component powered by `useFundWallet`.

### 1) Funding component
Create:
- `PrivyFundWalletDialog` (asset selector, amount input, fund action)

Behavior:
- Destination address defaults to connected wallet address from existing wallet hook.
- Calls `fundWallet(address, options)` with chain + asset + amount.
- Optional card preference (provider/funding method) configured in options.

File:
- `/apps/web/src/components/infofi/privy-fund-wallet-dialog.tsx` (new)

### 2) Placement
Show funding CTA at friction points:
1. `/request/new` near budget/post request submit.
2. `/request/[requestId]` near hire offer action.

Files:
- `/apps/web/src/app/request/new/page.tsx`
- `/apps/web/src/app/request/[requestId]/page.tsx`

### 3) Status and guidance UX
After funding modal closes:
- Re-check wallet balance (ETH or token) and render next-step CTA.
- Show clear unsupported-network message when on Sepolia.

Deliverable:
- User can start card funding from InfoFi and continue action flow without leaving context.

## Phase 3: Optional Signer Unification (Embedded Wallet Support)
Support Privy wallets as transaction signers (optional but valuable).

### 1) Wallet abstraction
Add an app-level wallet adapter hook that can return:
- injected provider signer (existing path), or
- Privy wallet signer/provider (embedded/external linked wallet)

Files:
- `/apps/web/src/lib/hooks/useWallet.ts` (update or split)
- `/apps/web/src/lib/wallet.ts`

### 2) Contract helper compatibility
Update wallet client creation in contract helpers to accept dynamic EIP-1193 provider instead of assuming `window.ethereum`.

Files:
- `/apps/web/src/lib/infofi-contract.ts`
- `/apps/web/src/lib/wallet.ts`

Deliverable:
- InfoFi transactions can be signed by selected Privy wallet, not just injected wallet.

## Phase 4: Hardening + Observability
1. Feature-flag rollout (`NEXT_PUBLIC_PRIVY_ENABLED`).
2. Track events:
   - funding modal opened
   - funding initiated
   - funding completed/canceled
3. Add error taxonomy in UI:
   - unsupported region/method
   - wallet mismatch
   - chain mismatch
4. Add safeguards against accidental wrong-chain user state.

Deliverable:
- Production-grade rollout controls and useful diagnostics.

## Testing Plan
1. Unit tests:
   - funding option mapping (asset/chain/amount)
   - feature-flag gating behavior
2. Component tests:
   - funding dialog validations and disabled states
3. Manual QA:
   - ETH funding happy path
   - USDC funding happy path
   - cancel flow
   - unsupported payment method/region
   - Sepolia chain-gated behavior
4. Regression QA:
   - existing InfoFi post/offer/hire/deliver/payout flow unaffected

## Acceptance Criteria (MVP)
1. Connected user can click "Fund with card", choose `ETH` or `USDC`, and complete funding via Privy flow.
2. Destination wallet is correctly prefilled and locked as configured.
3. User returns to InfoFi action context and can continue on-chain action.
4. On unsupported/testnet contexts, app shows explicit guidance instead of silent failure.
5. Privy keys are only read from public env vars intended for client SDK usage.

## File-Level Change Map
- `/apps/web/package.json`
- `/apps/web/.env.local.example`
- `/apps/web/src/components/providers/privy-provider.tsx` (new)
- `/apps/web/src/components/infofi/privy-fund-wallet-dialog.tsx` (new)
- `/apps/web/src/app/layout.tsx`
- `/apps/web/src/app/request/new/page.tsx`
- `/apps/web/src/app/request/[requestId]/page.tsx`
- `/apps/web/src/lib/hooks/useWallet.ts` (Phase 3 optional)
- `/apps/web/src/lib/wallet.ts` (Phase 3 optional)
- `/apps/web/src/lib/infofi-contract.ts` (Phase 3 optional)

## Risks and Mitigations
1. Funding network differs from active app chain.
   - Mitigation: explicit chain gating and preflight checks before opening funding flow.
2. Provider or regional payment-method variability.
   - Mitigation: graceful error states and no hardcoded assumptions in UI copy.
3. Embedded wallet signer integration complexity.
   - Mitigation: ship MVP with existing signer path first, then add signer abstraction.

## Reference Docs
- https://docs.privy.io/wallets/funding
- https://docs.privy.io/wallets/funding/prompting-users-to-fund
- https://docs.privy.io/wallets/funding/configuring-the-funding-flow
- https://docs.privy.io/guide/react/quickstart
- https://docs.privy.io/wallets/wallets/setup
