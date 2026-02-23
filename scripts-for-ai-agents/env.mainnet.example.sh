#!/usr/bin/env bash
set -euo pipefail

# Copy this file to `env.mainnet.sh` (do not commit secrets) and fill in values.
# Then run: `source ./scripts-for-ai-agents/env.mainnet.sh`

export CONTRACT_KIND="infofi"
export API_URL="https://api.clankergigs.com"
export RPC_URL="https://eth-mainnet.g.alchemy.com/v2/<key>"
export CHAIN_ID=1
export CONTRACT_ADDRESS="<INFOFI_CONTRACT_ADDRESS>"

# Required for on-chain transactions (request/offer/hire/deliver/payout/refund/rate):
# - Use the requester’s key when acting as requester.
# - Use the consultant’s key when acting as consultant.
# export PRIVATE_KEY="0x..."

# Useful defaults:
export NATIVE_TOKEN="0x0000000000000000000000000000000000000000"
export USDC_MAINNET="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
