#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS

if [ $# -lt 4 ]; then
  cat <<'OUT' >&2
Usage:
  02_ids.sh <requester> <source_uri> <question> <request_salt> [consultant amount_wei eta_seconds offer_salt]

Notes:
  - Salts can be either a 0x-prefixed bytes32 or any string (hashed via keccak256).
  - If offer args are provided, prints offerId and jobId too.
OUT
  exit 1
fi

requester="$1"
source_uri="$2"
question="$3"
request_salt_raw="$4"
request_salt="$(to_bytes32_salt "$request_salt_raw")"

request_id="$(
  cast call \
    "$CONTRACT_ADDRESS" \
    "computeRequestId(address,string,string,bytes32)(bytes32)" \
    "$requester" \
    "$source_uri" \
    "$question" \
    "$request_salt" \
    --rpc-url "$RPC_URL" | awk '{print $1}'
)"

cat <<OUT
requester=$requester
sourceURI=$source_uri
question=$question
requestSalt=$request_salt
requestId=$request_id
export REQUEST_ID=$request_id
OUT

if [ $# -ge 8 ]; then
  consultant="$5"
  amount_wei="$6"
  eta_seconds="$7"
  offer_salt_raw="$8"
  offer_salt="$(to_bytes32_salt "$offer_salt_raw")"

  offer_id="$(
    cast call \
      "$CONTRACT_ADDRESS" \
      "computeOfferId(bytes32,address,uint256,uint64,bytes32)(bytes32)" \
      "$request_id" \
      "$consultant" \
      "$amount_wei" \
      "$eta_seconds" \
      "$offer_salt" \
      --rpc-url "$RPC_URL" | awk '{print $1}'
  )"

  job_id="$(
    cast call \
      "$CONTRACT_ADDRESS" \
      "computeJobId(bytes32,address)(bytes32)" \
      "$offer_id" \
      "$requester" \
      --rpc-url "$RPC_URL" | awk '{print $1}'
  )"

  cat <<OUT
consultant=$consultant
amountWei=$amount_wei
etaSeconds=$eta_seconds
offerSalt=$offer_salt
offerId=$offer_id
jobId=$job_id
export OFFER_ID=$offer_id
export JOB_ID=$job_id
OUT
fi

