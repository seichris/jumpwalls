# InfoFi Chrome Extension

This extension provides:

- requester flow from popup (`postRequest`)
- offerer discovery from open requests + local browser-history domain matches
- manual subscription overrides in settings (domain-level match without browser history)
- extension badge count for matched opportunities
- packaged toolbar/store icons (`16`, `32`, `48`, `128`)

## Build

```bash
pnpm -C apps/chrome-extension build
```

Then load `apps/chrome-extension/dist` via `chrome://extensions` -> **Load unpacked**.

## Tests

```bash
pnpm -C apps/chrome-extension test
```

## Configure

1. Open extension options.
2. Set `API URL` (e.g. `http://localhost:8787`).
3. Set `History lookback (days)` and save (grants `history` permission).
4. In `My Subscriptions`, mark domains where you have access via app/account so requests still match without browsing history.

The popup uses the active tab's injected wallet provider (`window.ethereum`) to sign transactions.
