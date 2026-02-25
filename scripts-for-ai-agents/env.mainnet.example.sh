#!/usr/bin/env bash
set -euo pipefail

# Copy this file to `env.mainnet.sh` (do not commit secrets) and fill in values.
# Then run: `source ./scripts-for-ai-agents/env.mainnet.sh`

export CONTRACT_KIND="infofi"
export API_URL="https://api.clankergigs.com"
export RPC_URL="https://base-mainnet.g.alchemy.com/v2/<key>"
export CHAIN_ID=8453
export CONTRACT_ADDRESS="<INFOFI_CONTRACT_ADDRESS>"

# Required for on-chain transactions (request/offer/hire/deliver/payout/refund/rate):
# - Use the requester’s key when acting as requester.
# - Use the consultant’s key when acting as consultant.
# export PRIVATE_KEY="0x..."
#
# Optional for API fair-use second pass (sent as x-gemini-api-key by 07_store_digest.sh):
# export GEMINI_API_KEY="<google_ai_api_key>"

# Useful defaults:
export NATIVE_TOKEN="0x0000000000000000000000000000000000000000"
export USDC_MAINNET="0x833589fCD6eDb6E08f4c7C32D4f71b54bDa02913"
