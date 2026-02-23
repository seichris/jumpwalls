---
name: infofi-cli
description: Operate InfoFi v0 from a terminal: post requests/offers, hire with ETH/ERC-20 escrow, store digests via the API, deliver digests on-chain, settle (payout/refund) as requester, and rate jobs.
---

# infofi-cli

## Non-negotiable guardrails

- Never print or paste secrets: `PRIVATE_KEY`, `AUTH_TOKEN`, `GITHUB_TOKEN`, `GHB_TOKEN`.
- Before any write transaction (`cast send`), confirm:
  - target network (mainnet vs sepolia vs local)
  - `CHAIN_ID`, `RPC_URL`, `CONTRACT_ADDRESS`
  - `requestId` / `offerId` / `jobId`
  - token + amount
- Prefer `scripts-for-ai-agents/*` over ad-hoc `cast` / `curl` commands.
- Treat `AGENTS.md` as the canonical reference; this skill is the execution checklist.

## Quick start (sanity)

```bash
./scripts-for-ai-agents/01_health.sh
curl -sS "$API_URL/contract" | jq .
```

If any env is missing, use:

- `./scripts-for-ai-agents/env.mainnet.example.sh`
- `./scripts-for-ai-agents/env.sepolia.example.sh`

Copy to `env.mainnet.sh` / `env.sepolia.sh` locally (do not commit) and `source` it.

## Common env vars (what scripts expect)

- Chain: `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`
- API: `API_URL`
- Signing: `PRIVATE_KEY` (required for on-chain writes)

## InfoFi flow: request → offer → hire → deliver → settle → rate

1) Compute IDs (read-only):

```bash
./scripts-for-ai-agents/02_ids.sh <requester> <source_uri> <question> <request_salt> \
  [consultant amount_wei eta_seconds offer_salt]
```

2) Requester: post request (`postRequest`):

```bash
./scripts-for-ai-agents/03_post_request.sh <source_uri> <question> <payment_token|ETH> <max_amount_wei> [request_salt]
```

3) Consultant: post offer (`postOffer`):

```bash
./scripts-for-ai-agents/04_post_offer.sh <request_id> <amount_wei> <eta_seconds> <proof_type> [offer_salt]
```

4) Requester: hire offer (`hireOffer`):

ETH escrow:

```bash
./scripts-for-ai-agents/05_hire_offer_eth.sh <offer_id> <amount_eth>
```

ERC-20 escrow:

```bash
./scripts-for-ai-agents/12_approve_token.sh <token_address> <amount_wei> [spender]
./scripts-for-ai-agents/06_hire_offer_token.sh <offer_id>
```

5) Consultant: store digest + deliver hash (`deliverDigest`):

```bash
./scripts-for-ai-agents/09_deliver_from_api.sh <job_id> <consultant_address> <digest_file> [source_uri] [question] [proof]
```

6) Requester: settle escrow:

```bash
./scripts-for-ai-agents/10_payout_requester.sh <job_id> <recipient> <amount_wei>
./scripts-for-ai-agents/11_refund_requester.sh <job_id> <amount_wei> [funder_address]
```

7) Mutual rating:

```bash
./scripts-for-ai-agents/13_rate_job.sh <job_id> <stars_1_to_5> <uri>
```

## Debug checklist

- `GET $API_URL/contract` returns 400: check API env (`CONTRACT_KIND=infofi`, `CONTRACT_ADDRESS`, `RPC_URL`, `CHAIN_ID`).
- Network mismatch: ensure `API_URL`, `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` all point to the same chain.
- `deliverDigest` fails: confirm `jobId` matches the hired offer + requester and that escrow has been hired.
