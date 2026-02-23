#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 2 ]; then
  echo "Usage: $0 <offer_id> <amount_eth>" >&2
  exit 1
fi

offer_id="$1"
amount_eth="$2"
amount_wei="$(cast to-wei "$amount_eth" ether)"

requester="$(cast wallet address --private-key "$PRIVATE_KEY")"
job_id="$(
  cast call \
    "$CONTRACT_ADDRESS" \
    "computeJobId(bytes32,address)(bytes32)" \
    "$offer_id" \
    "$requester" \
    --rpc-url "$RPC_URL" | awk '{print $1}'
)"

echo "requester=$requester"
echo "jobId=$job_id"

cast send \
  "$CONTRACT_ADDRESS" \
  "hireOffer(bytes32)" \
  "$offer_id" \
  --value "$amount_wei" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

