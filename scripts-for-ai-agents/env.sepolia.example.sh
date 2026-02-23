#!/usr/bin/env bash
set -euo pipefail

# Copy this file to `env.sepolia.sh` (do not commit secrets) and fill in values.
# Then run: `source ./scripts-for-ai-agents/env.sepolia.sh`

export CONTRACT_KIND="infofi"
export API_URL="https://api-sepolia.clankergigs.com"
export RPC_URL="https://eth-sepolia.g.alchemy.com/v2/<key>"
export CHAIN_ID=11155111
export CONTRACT_ADDRESS="<INFOFI_CONTRACT_ADDRESS>"

# Required for on-chain transactions (request/offer/hire/deliver/payout/refund/rate):
# - Use the requester’s key when acting as requester.
# - Use the consultant’s key when acting as consultant.
# export PRIVATE_KEY="0x..."

# Useful defaults:
export NATIVE_TOKEN="0x0000000000000000000000000000000000000000"
export USDC_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
