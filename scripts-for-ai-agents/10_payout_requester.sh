#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 3 ]; then
  echo "Usage: $0 <job_id> <recipient> <amount_wei>" >&2
  echo "Note: PRIVATE_KEY must be the requester key for this job." >&2
  exit 1
fi

job_id="$1"
recipient="$2"
amount_wei="$3"

cast send \
  "$CONTRACT_ADDRESS" \
  "payoutByRequester(bytes32,address,uint256)" \
  "$job_id" \
  "$recipient" \
  "$amount_wei" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

