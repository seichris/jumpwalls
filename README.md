# InfoFi

InfoFi is an on-chain marketplace for research digests:

1. A requester posts a question and max budget.
2. A consultant posts an offer.
3. The requester hires the offer and funds escrow (ETH or ERC-20).
4. The consultant stores digest content via API and delivers `digestHash + metadataURI` on-chain.
5. The requester settles escrow (payout/refund), and both sides can rate the job.

This repository is the InfoFi v0 codebase.

## Repo layout

- `contracts/`: Solidity contracts and Foundry tests (`contracts/src/InfoFi.sol`)
- `apps/api/`: Fastify API + indexer + digest storage (`POST /digests`)
- `apps/web/`: Next.js InfoFi web app
- `apps/chrome-extension/`: InfoFi Chrome extension
- `scripts-for-ai-agents/`: terminal-first InfoFi workflow scripts

## Requirements

- `pnpm`
- Foundry (`forge`, `cast`, `anvil`)
- `jq`, `curl` (for CLI scripts)

## Quick start (local Anvil)

1. Install dependencies:

```bash
pnpm install
```

2. Create env:

```bash
cp .env.example .env
```

3. Start local chain:

```bash
pnpm contracts:anvil
```

4. In another terminal, deploy InfoFi locally:

```bash
pnpm contracts:deploy:infofi:local
```

5. Update `.env` for local usage:

- `CONTRACT_KIND=infofi`
- `CHAIN_ID=31337`
- `RPC_URL=http://127.0.0.1:8545`
- `CONTRACT_ADDRESS=<deployed_address>`

6. Run API migrations and start API:

```bash
pnpm -C apps/api prisma:migrate
pnpm -C apps/api dev
```

7. Configure and run web app:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Set:

- `NEXT_PUBLIC_CHAIN_ID=31337`
- `NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545`
- `NEXT_PUBLIC_CONTRACT_ADDRESS=<deployed_address>`
- `NEXT_PUBLIC_API_URL=http://localhost:8787`

Then run:

```bash
pnpm -C apps/web dev
```

## Deploy (Base mainnet or Sepolia)

Deploy contract:

```bash
RPC_URL=<rpc> PRIVATE_KEY=<deployer_key> pnpm contracts:deploy:infofi
```

Then set these for API/web on that network:

- `CONTRACT_KIND=infofi`
- `CHAIN_ID` (`8453` for Base mainnet, `11155111` for Sepolia)
- `RPC_URL`
- `CONTRACT_ADDRESS`

## API (InfoFi mode)

When `CONTRACT_KIND=infofi`, key endpoints are:

- `GET /health`
- `GET /contract`
- `GET /infofi/id` (compute IDs off-chain)
- `GET /requests`
- `GET /offers`
- `GET /jobs`
- `GET /jobs/:jobId/reimbursement-preview`
- `GET /digests`
- `GET /digests/:id`
- `POST /digests`

### Digest fair-use screening

`POST /digests` supports policy enforcement:

- `FAIR_USE_ENFORCEMENT_MODE=off|warn|block` (`block` recommended)
- Optional Gemini second pass:
  - `GEMINI_API_KEY`
  - `GEMINI_MODEL` (default `gemini-3-flash-preview`)
  - `GEMINI_TIMEOUT_MS`

## CLI agent flow

Scripts are in `scripts-for-ai-agents/`:

- `01_health.sh`: API health + contract check
- `02_ids.sh`: compute `requestId` / `offerId` / `jobId`
- `03_post_request.sh`: requester posts request
- `04_post_offer.sh`: consultant posts offer
- `05_hire_offer_eth.sh`: requester hires with ETH
- `06_hire_offer_token.sh`: requester hires with ERC-20
- `07_store_digest.sh`: store digest off-chain via API
- `08_deliver_digest.sh`: deliver digest hash on-chain
- `09_deliver_from_api.sh`: one-shot store + deliver
- `10_payout_requester.sh`: requester payout
- `11_refund_requester.sh`: requester refund
- `12_approve_token.sh`: approve ERC-20 for escrow
- `13_rate_job.sh`: rate job
- `14_x402_citation.sh`: generate x402 citation JSON helper

Reference guide: `AGENTS.md`

## Chrome extension

Build:

```bash
pnpm -C apps/chrome-extension build
```

Load `apps/chrome-extension/dist` in `chrome://extensions` (Developer mode -> Load unpacked).

## Test commands

- Contracts: `pnpm contracts:test`
- API typecheck: `pnpm -C apps/api typecheck`
- Web tests: `pnpm -C apps/web test`
- Extension tests: `pnpm -C apps/chrome-extension test`
