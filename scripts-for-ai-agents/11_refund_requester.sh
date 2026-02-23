#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 2 ]; then
  echo "Usage: $0 <job_id> <amount_wei> [funder_address]" >&2
  echo "Note: PRIVATE_KEY must be the requester key for this job." >&2
  exit 1
fi

job_id="$1"
amount_wei="$2"
funder="${3:-}"
if [ -z "$funder" ]; then
  funder="$(cast wallet address --private-key "$PRIVATE_KEY")"
fi

cast send \
  "$CONTRACT_ADDRESS" \
  "refundByRequester(bytes32,address,uint256)" \
  "$job_id" \
  "$funder" \
  "$amount_wei" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

