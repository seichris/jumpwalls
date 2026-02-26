# Jump Walls! Chrome Extension Privacy Policy

Effective date: February 26, 2026

This policy explains how the Jump Walls! Chrome Extension ("extension") handles data.

## What the extension does

The extension helps users:

- view open Jump Walls! requests from a configured API,
- match requests to browsing domains using optional browser history access,
- post on-chain requests and offers through the active tab's wallet provider.

## Data we process

### Browser history (optional permission)

- Permission: `history` (optional).
- Purpose: detect domain matches between open requests and your recent browsing activity.
- Processing location: local on your device.
- By default, matching uses domain extraction and comparison in extension code.

### Extension settings and state (local storage)

The extension stores settings and state in `chrome.storage.local`, including:

- API URL,
- history lookback days,
- subscription-by-domain toggles,
- cached open requests and computed match summaries.

This data is stored locally in your browser profile.

### API requests

The extension makes read requests to the configured API origin, including:

- `GET /contract`
- `GET /requests?status=OPEN...`

These requests are used to load contract and open-request data for the UI.

### Wallet and blockchain interactions

When you submit actions in the popup, the extension relays wallet RPC requests through the active tab's injected wallet provider (`window.ethereum`), such as:

- `eth_requestAccounts`
- `eth_chainId`
- `wallet_switchEthereumChain`
- `eth_sendTransaction`

Transaction data you approve may be written to public blockchains and become publicly visible (for example wallet address, transaction hash, and contract call inputs).

## What we do not do

- We do not sell personal data.
- We do not run third-party ad tracking inside the extension.
- We do not intentionally send raw browsing history to the configured API for matching logic.

## Data sharing

Data may be shared with:

- your configured API host (for API reads),
- your wallet provider and connected blockchain network (for approved transactions),
- public blockchain indexers/explorers as a normal consequence of blockchain publishing.

## Data retention and deletion

- Local extension data remains in `chrome.storage.local` until you clear it, reset the extension, or uninstall.
- You can disable/remove optional permissions (such as `history`) in Chrome extension settings.
- On-chain transactions and data cannot generally be deleted once published.

## Security

No software can guarantee absolute security. Keep your browser and wallet updated, and review transaction prompts before approval.

## Children's privacy

The extension is not directed to children under 13.

## Changes to this policy

We may update this policy. Material changes will be reflected by updating the effective date above.

## Contact

For privacy questions, contact the project maintainers through the repository support channel.
