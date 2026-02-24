# Privy Funding QA Matrix

## Scope
Validate the remaining Privy implementation work:
- balance re-check and action CTA after funding flow closes
- wallet source visibility and selection (`Injected` vs `Privy`)
- connect/create Privy wallet path outside funding dialog
- funding observability and hardening behavior

## Environment
- Web app with `NEXT_PUBLIC_PRIVY_ENABLED=true`
- Valid `NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_PRIVY_CLIENT_ID`
- Test both `NEXT_PUBLIC_CHAIN_ID=1` and `NEXT_PUBLIC_CHAIN_ID=11155111` where applicable

## Matrix
| ID | Scenario | Steps | Expected |
|---|---|---|---|
| P1 | Wallet source selector appears | Connect injected wallet and Privy wallet, open `/request/new` or `/request/[id]` | Source selector is visible with both addresses and active source badge |
| P2 | Switch source to Privy | In source selector pick `Privy` | Active badge switches to Privy and address/chain come from Privy wallet |
| P3 | Switch source to Injected | In source selector pick `Injected` | Active badge switches to Injected and address/chain come from injected wallet |
| P4 | Privy connect path outside funding dialog | Log out/unlink Privy wallet, click `Connect/Create Privy` | Privy login/create flow opens without opening fund dialog |
| P5 | Wrong-chain safeguard in funding | Keep active wallet on wrong chain, open fund dialog | Funding action is blocked with explicit chain-mismatch message |
| P6 | Funding open/start/completed events | Open fund dialog, start and complete funding | Console logs structured events: opened, started, completed |
| P7 | Funding cancel event | Start funding and cancel in provider modal | Console logs canceled/exited events and UI shows cancellation notice |
| P8 | Balance re-check after complete | Complete funding, wait for modal close | UI shows refreshed on-chain balance summary on page |
| P9 | Post CTA from balance (`/request/new`) | Complete funding with enough ETH gas | UI shows `You Can Now Post Request` CTA; clicking it submits when form is valid |
| P10 | Hire CTA from balance (`/request/[id]`) | Complete funding with enough token+gas for an open offer | UI shows `You Can Now Hire` CTA and scrolls to offers table |
| P11 | Insufficient balance after funding | Complete/cancel flow with no effective top-up | UI shows balance summary and states that balance is still insufficient |
| P12 | Unsupported app chain message | Use app chain not in `NEXT_PUBLIC_PRIVY_FUNDING_CHAIN_IDS` | Page-level chain support warning is visible and fund button is disabled |

## Regression checks
- Posting requests still works with injected wallets.
- Hiring offers still works for ETH and USDC.
- Existing chain switch buttons still switch the active source wallet.

