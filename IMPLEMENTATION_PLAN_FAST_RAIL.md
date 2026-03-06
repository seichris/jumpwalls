# FAST Rail v1

## Summary
- Branch: `c/fast-rail-v1`
- Auth stays on Privy/EVM.
- FAST is implemented as an API-backed rail with a bound FastSet browser wallet.
- Base/EVM contract flows remain intact.

## Implemented Changes
- Added end-user EVM challenge auth with cookie-backed API sessions.
- Added FAST bind challenge/verify flow storing canonical `fast1...` addresses and FAST public keys on the user profile.
- Added FAST request, offer, hire, deliver, accept, and refund endpoints.
- Added FAST treasury transfer verification and treasury payout/refund submission helpers against `https://api.fast.xyz/proxy`.
- Added FAST Prisma models for user/session state, FAST requests/offers/jobs, and FAST transfer ledger rows.
- Extended `/requests`, `/offers`, and `/jobs` to return mixed `BASE` and `FAST` rows with a `rail` field.
- Added web-side FAST wallet integration for `window.fastset`, FAST bind, FAST mode selection, and FAST request funding.
- Added rail badges and FAST/Base-aware request, offer, and job actions in the web UI.

## Public Interfaces
- `POST /auth/challenge`
- `POST /auth/verify`
- `GET /auth/session`
- `GET /user/profile`
- `POST /user/fast/challenge`
- `POST /user/fast/bind`
- `GET /fast/config`
- `POST /fast/requests`
- `POST /fast/offers`
- `POST /fast/offers/:offerId/hire`
- `POST /fast/jobs/:jobId/deliver`
- `POST /fast/jobs/:jobId/accept`
- `POST /fast/jobs/:jobId/refund`

## Verification
- API: typecheck and tests pass.
- Web: typecheck and tests pass.

## Defaults
- User-facing settlement asset label is `SETUSDC`.
- FAST addresses are stored/displayed as `fast1...`.
- Legacy `set1...` input is normalized on the backend for bind verification.
- FAST v1 settles in SETUSDC only.
- FAST ratings remain out of scope.
