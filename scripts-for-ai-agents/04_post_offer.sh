#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 4 ]; then
  echo "Usage: $0 <request_id> <amount_wei> <eta_seconds> <proof_type> [offer_salt]" >&2
  exit 1
fi

request_id="$1"
amount_wei="$2"
eta_seconds="$3"
proof_type="$4"
salt_raw="${5:-infofi-offer-$(date +%s)}"
salt="$(to_bytes32_salt "$salt_raw")"

consultant="$(cast wallet address --private-key "$PRIVATE_KEY")"
offer_id="$(
  cast call \
    "$CONTRACT_ADDRESS" \
    "computeOfferId(bytes32,address,uint256,uint64,bytes32)(bytes32)" \
    "$request_id" \
    "$consultant" \
    "$amount_wei" \
    "$eta_seconds" \
    "$salt" \
    --rpc-url "$RPC_URL" | awk '{print $1}'
)"

requester="$(
  cast call \
    "$CONTRACT_ADDRESS" \
    "requests(bytes32)(address,address,uint256,uint64,uint8,bytes32,string,string)" \
    "$request_id" \
    --rpc-url "$RPC_URL" | sed -n '1p' | awk '{print $1}'
)"

job_id=""
if [ -n "$requester" ] && [ "$requester" != "0x0000000000000000000000000000000000000000" ]; then
  job_id="$(
    cast call \
      "$CONTRACT_ADDRESS" \
      "computeJobId(bytes32,address)(bytes32)" \
      "$offer_id" \
      "$requester" \
      --rpc-url "$RPC_URL" | awk '{print $1}'
  )"
fi

echo "consultant=$consultant"
echo "offerSalt=$salt"
echo "offerId=$offer_id"
if [ -n "$job_id" ]; then
  echo "jobId=$job_id"
fi

cast send \
  "$CONTRACT_ADDRESS" \
  "postOffer(bytes32,uint256,uint64,string,bytes32)" \
  "$request_id" \
  "$amount_wei" \
  "$eta_seconds" \
  "$proof_type" \
  "$salt" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

