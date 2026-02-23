#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 4 ]; then
  echo "Usage: $0 <source_uri> <question> <payment_token|ETH> <max_amount_wei> [request_salt]" >&2
  exit 1
fi

source_uri="$1"
question="$2"
payment_token="$3"
max_amount_wei="$4"
salt_raw="${5:-infofi-request-$(date +%s)}"
salt="$(to_bytes32_salt "$salt_raw")"

token="$payment_token"
payment_token_upper="$(echo "$payment_token" | tr '[:lower:]' '[:upper:]')"
if [[ "$payment_token_upper" == "ETH" ]]; then
  token="$(native_token_address)"
fi

requester="$(cast wallet address --private-key "$PRIVATE_KEY")"
request_id="$(
  cast call \
    "$CONTRACT_ADDRESS" \
    "computeRequestId(address,string,string,bytes32)(bytes32)" \
    "$requester" \
    "$source_uri" \
    "$question" \
    "$salt" \
    --rpc-url "$RPC_URL" | awk '{print $1}'
)"

echo "requester=$requester"
echo "requestSalt=$salt"
echo "requestId=$request_id"

cast send \
  "$CONTRACT_ADDRESS" \
  "postRequest(string,string,address,uint256,bytes32)" \
  "$source_uri" \
  "$question" \
  "$token" \
  "$max_amount_wei" \
  "$salt" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

