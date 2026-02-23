# InfoFi (Claude Code)

Use this repo to run the InfoFi v0 flow: post requests/offers on-chain, hire with ETH/ERC-20 escrow, store digests off-chain via the API, deliver digest hashes on-chain, settle (payout/refund) as the requester, and leave mutual ratings.

## Operating rules

- Never print secrets: `PRIVATE_KEY`, `AUTH_TOKEN`, `GITHUB_TOKEN`, `GHB_TOKEN`.
- Prefer `./scripts-for-ai-agents/*` over ad-hoc `cast` / `curl` (especially for on-chain writes).
- Before any on-chain write (`cast send`), confirm:
  - network (mainnet vs sepolia vs local)
  - `CHAIN_ID`, `RPC_URL`, `CONTRACT_ADDRESS`
  - `requestId` / `offerId` / `jobId`
  - token + amount
- If anything is unclear, open and follow `AGENTS.md` (canonical CLI runbook).

## Quick checks

```bash
./scripts-for-ai-agents/01_health.sh
```

## Project commands

- `/project:infofi-post-request` (`postRequest` on-chain)
- `/project:infofi-post-offer` (`postOffer` on-chain)
- `/project:infofi-hire-offer` (`hireOffer` escrow with ETH/ERC-20)
- `/project:infofi-deliver` (store digest via API + `deliverDigest` on-chain)
- `/project:infofi-payout` (`payoutByRequester` on-chain)
- `/project:infofi-refund` (`refundByRequester` on-chain)
- `/project:infofi-rate` (`rateJob` on-chain)

When running these, ask for missing inputs (source URI, question, requestId/offerId/jobId, token, amounts, network) and do not guess values that move funds.
