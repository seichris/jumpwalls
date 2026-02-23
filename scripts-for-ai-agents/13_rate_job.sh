#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 3 ]; then
  echo "Usage: $0 <job_id> <stars_1_to_5> <uri>" >&2
  exit 1
fi

job_id="$1"
stars="$2"
uri="$3"

cast send \
  "$CONTRACT_ADDRESS" \
  "rateJob(bytes32,uint8,string)" \
  "$job_id" \
  "$stars" \
  "$uri" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

