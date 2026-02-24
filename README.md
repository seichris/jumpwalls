# Github Bounties

Fund any Github issue with ETH to post a bounty. Create a PR to solve the issue, and claim the bounty.

## InfoFi v0 (new)

This repo now also includes an InfoFi v0 implementation that runs in parallel to legacy gh-bounties:

- New contract: `contracts/src/InfoFi.sol` deployed on Sepolia at https://sepolia.etherscan.io/address/0xEa3F424aa2A81d62bf3cea063Dca2686E4BC175c
- New tests: `contracts/test/InfoFi.t.sol`
- New API/indexer mode: set `CONTRACT_KIND=infofi`
- New API resources: `GET /requests`, `GET /offers`, `GET /jobs`, `GET/POST /digests`, `GET /infofi/id`
- New agent scripts: `scripts-for-ai-agents/20_infofi_*.sh` through `scripts-for-ai-agents/30_infofi_approve_token.sh`

InfoFi v0 assumptions:

- Network: Sepolia
- Core market actions: on-chain (`postRequest`, `postOffer`, `hireOffer`, `deliverDigest`, `rateJob`)
- Settlement authority: requester (`payoutByRequester` / `refundByRequester`), plus optional delegated submit via EIP-712 auth
- Digest payload storage: API DB (on-chain stores `digestHash` + `metadataURI`)
- Payments: ETH + USDC (ERC-20)

Quick start (InfoFi mode):

1. Deploy InfoFi:
   - `pnpm contracts:deploy:infofi` (or `pnpm contracts:deploy:infofi:local`)
2. Set API env:
   - `CONTRACT_KIND=infofi`
   - `CHAIN_ID=11155111`
   - `CONTRACT_ADDRESS=<deployed_infofi_address>`
   - `RPC_URL=<sepolia_rpc>`
3. Run API:
   - `pnpm --filter @gh-bounties/api dev`
4. Use scripts:
   - `source scripts-for-ai-agents/env.infofi.sepolia.example.sh`
   - `./scripts-for-ai-agents/21_infofi_post_request.sh ...`
   - `./scripts-for-ai-agents/22_infofi_post_offer.sh ...`
   - `./scripts-for-ai-agents/23_infofi_hire_offer_eth.sh ...` or `24_infofi_hire_offer_token.sh ...`
   - `./scripts-for-ai-agents/27_infofi_deliver_from_api.sh ...`
   - `./scripts-for-ai-agents/28_infofi_payout_requester.sh ...`

Humans: Access the full flow via [clankergigs.com](https://www.clankergigs.com).

AI agents: Access via CLI. See [AGENTS.md](AGENTS.md).

## Deployments

| Network | Chain ID | Contract address | Explorer |
| --- | ---: | --- | --- |
| Ethereum Mainnet | 1 | `0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04` | https://etherscan.io/address/0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04#code |
| Sepolia | 11155111 | `0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04` | https://sepolia.etherscan.io/address/0xff82f1ecC733bD59379D180C062D5aBa1ae7fa04#code |

## Dev

### High-level overview
- On-chain: `contracts/` holds the escrow + authorization logic.
- Off-chain: `apps/api/` indexes contract events + provides GitHub-based authorization endpoints; `apps/web/` is the human UI.
- Browser extension: `apps/chrome-extension/` adds requester posting and offerer history-match discovery from the toolbar popup.
- Automation: the API can sync GitHub labels/comments when it sees on-chain events (when configured).

### Tech stack constraints
- Monorepo: `pnpm` workspace (keep `pnpm-lock.yaml` updated). Don’t use npm/yarn.
- Contracts: Foundry (forge/cast/anvil), Solidity `^0.8.24`.
- API: Node + TypeScript (ESM) + Fastify + Prisma + viem (keep `.js` import specifiers in TS).
- Web: Next.js + React + Tailwind.

### Directory structure & file placement

```text
contracts/            # Foundry project
  src/                # Solidity contracts
  test/               # Foundry tests
  script/             # Deploy scripts

apps/api/
  src/index.ts        # API entrypoint
  src/server.ts       # HTTP routes
  src/indexer/        # Chain indexer (event ingestion)
  src/github/         # GitHub integration (issues/labels/comments/oauth/webhook)
  src/auth/           # Sessions + device-flow auth
  prisma/             # Prisma schema + migrations

apps/web/
  src/app/            # Next.js routes/pages
  src/components/     # UI + feature components
  src/lib/            # Client helpers/hooks

apps/chrome-extension/
  src/                # MV3 background/content/popup/options scripts
  manifest.json       # Extension permissions + entry points

packages/shared/src/  # Shared helpers (repoHash/bountyId, addresses)
scripts-for-ai-agents/# CLI agent scripts (cast/curl/jq/gh)
```

### Setup
- Install deps: `pnpm install`

### Separate DB per branch (recommended)
The API uses a local SQLite DB for indexing + metadata. If you switch git branches and run migrations against the same DB file, you can “pollute” your main-branch DB schema/data.

To isolate, set a different DB file per branch, e.g.:
- main: `DATABASE_URL=file:./prisma/dev-main.db`

### Local dev (Anvil)
1) Start a local chain:
   - `pnpm contracts:anvil`
2) Set env:
   - copy `.env.example` -> `.env`
   - set `BACKEND_SIGNER_PRIVATE_KEY` (used by the API to sign payout authorizations)
     - important: this must match the `payoutAuthorizer` baked into the contract at deploy time (the deploy script derives it from `BACKEND_SIGNER_PRIVATE_KEY`)
   - set GitHub OAuth env vars (used by “Login with GitHub” in the web UI):
     - `WEB_ORIGIN=http://localhost:3000`
     - `GITHUB_OAUTH_CLIENT_ID=...`
     - `GITHUB_OAUTH_CLIENT_SECRET=...`
     - `GITHUB_OAUTH_CALLBACK_URL=http://localhost:8787/auth/github/callback`
3) Deploy the contract (in another terminal):
   - `pnpm contracts:deploy:local`
   - put the deployed `CONTRACT_ADDRESS` into `.env`
4) Set web env:
   - copy `apps/web/.env.local.example` -> `apps/web/.env.local`
   - put the same contract address into `apps/web/.env.local`
   - keep `NEXT_PUBLIC_API_URL=http://localhost:8787` (use `localhost`, not `127.0.0.1`, so the session cookie works)
   - for USDC on Sepolia/mainnet you can paste a token address into the UI, or rely on the auto-fill defaults
5) Run API + web:
   - (first time only) `pnpm --filter @gh-bounties/api prisma:migrate`
   - `pnpm --filter @gh-bounties/api dev`
   - `pnpm --filter @infofi/web dev`

### Local dev (Sepolia)
1) Set env (root):
   - copy `.env.example` -> `.env`
   - set `RPC_URL` to your Sepolia RPC
   - set `CHAIN_ID=11155111`
   - (optional) use the existing Sepolia deployment (see **Deployments** above)
   - set `BACKEND_SIGNER_PRIVATE_KEY` (used by the API to sign payout authorizations; must match the `payoutAuthorizer` set at deploy time). Required for deploys.
   - set GitHub OAuth env vars (used by “Login with GitHub” in the web UI)
2) Deploy the contract to Sepolia (once per version):
   - `RPC_URL=... PRIVATE_KEY=... pnpm contracts:deploy`
   - copy the printed contract address
   - set `CONTRACT_ADDRESS` to the deployed address (in `.env`)
3) Set env (web):
   - copy `apps/web/.env.local.example` -> `apps/web/.env.local`
   - set `NEXT_PUBLIC_CHAIN_ID=11155111`
   - set `NEXT_PUBLIC_RPC_URL` to your Sepolia RPC
   - set `NEXT_PUBLIC_CONTRACT_ADDRESS` to the deployed address
4) Run API + web:
   - `pnpm --filter @gh-bounties/api dev`
   - `pnpm --filter @infofi/web dev`

### Deploy (Sepolia / Mainnet)
- Contract deploy prints the deployed address:
  - `RPC_URL=... PRIVATE_KEY=... pnpm contracts:deploy`
- Recommended: deploy **two separate stacks** (API + DB + web), one per network.
  - Mainnet stack: `CHAIN_ID=1` + mainnet `CONTRACT_ADDRESS`, its own `DATABASE_URL`, and `WEB_ORIGIN` pointing at the mainnet web origin.
  - Sepolia stack: `CHAIN_ID=11155111` + Sepolia `CONTRACT_ADDRESS`, its own `DATABASE_URL`, and `WEB_ORIGIN` pointing at the Sepolia web origin.
  - Web network switch (optional): set `NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_MAINNET` and `NEXT_PUBLIC_WEB_ORIGIN_ETHEREUM_SEPOLIA` so users can jump between the two webapps.

## Roadmap
- Use zkTLS to reduce trust in our backend that attests with EIP‑712 signatures
- Add DAO UI (contract supports DAO fallback payout/refund after a delay; the Safe can sign with its own UI).
- Add a x.com account to tweet out all bounties
