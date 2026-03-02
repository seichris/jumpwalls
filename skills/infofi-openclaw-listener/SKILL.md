---
name: infofi-openclaw-listener
description: Use when asked to listen, watch, monitor, or poll incoming InfoFi requests for OpenClaw. Reads open requests from the InfoFi API (GET /requests?status=OPEN), deduplicates by requestId, and reports new opportunities safely without on-chain writes unless explicitly requested.
---

# InfoFi OpenClaw Listener

Run an idempotent incoming-request listener for OpenClaw on InfoFi.

## Use This Skill When

- User asks to listen, watch, monitor, or poll incoming requests.
- User wants continuous intake of newly opened requests.
- User asks for opportunity triage from fresh open requests.

## Do Not Use This Skill When

- User asks for a one-off manual request lookup.
- User asks to execute posting, hiring, or settlement transactions (use the InfoFi CLI flow).

## Guardrails

- Never print secrets: `PRIVATE_KEY`, `AUTH_TOKEN`, `GITHUB_TOKEN`.
- Default to read-only operations.
- Before any on-chain write (`cast send`), confirm:
  - network (`mainnet` vs `sepolia` vs local)
  - `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`
  - `requestId` / `offerId` / `jobId`
  - token and amount

## Data Sources

- Chain events are indexed by the API indexer.
- Listener consumes API `GET /requests` (not raw chain RPC unless explicitly requested).

## Preflight Checks

1. Run `./scripts-for-ai-agents/01_health.sh`.
2. Run `curl -sS "$API_URL/contract" | jq .`.
3. Verify `contractKind=infofi` and expected chain/address.

## Notification Channel Policy

1. Before starting continuous polling, determine whether a notification channel is already available.
2. If an established channel exists, use it for unseen-request alerts.
3. If no channel is open, ask the user to open or choose one before monitoring.
4. If the user does not open an external channel, continue with terminal-only alerts and make that explicit.

Suggested channels:

- Current terminal/session stream
- Slack webhook
- Telegram bot/chat
- Email relay/webhook endpoint

## Listener Loop

1. Fetch `GET /requests?status=OPEN&take=500`.
2. Normalize IDs to lowercase (`requestId`).
3. Compare with persisted seen IDs and emit only unseen requests.
4. Send alert through the selected notification channel for each unseen request.
5. Persist the seen set and last poll timestamp.
6. Sleep fixed interval (for example 15-60 seconds), then repeat.

## Reliability Rules

- Idempotency key: `requestId`.
- Retry with backoff on API failures.
- Never emit duplicate alerts for seen `requestId`.
- Resume from persisted state after restart.

## Output Shape For New Requests

Include:

- `requestId`
- `sourceURI`
- `question`
- `maxAmountWei`
- `paymentToken`
- `requester`
- `updatedAt` (or `createdAt` when relevant)
- poll-level total new count

## References

- Repo guardrails: `AGENTS.md`
- API requests endpoint: `apps/api/src/server.ts`
- Chain indexer ingestion: `apps/api/src/indexer/indexer.ts`
