#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_cmd cast
require_env API_URL
require_env PRIVATE_KEY

if [ $# -lt 5 ]; then
  echo "Usage: $0 <request_id_bytes32> <domain> <decision_SKIP_OR_OFFERED_OR_FAILED> <confidence_0_to_1> <reason_code> [reason_detail] [offer_amount_wei] [eta_seconds] [offer_id_bytes32] [tx_hash]" >&2
  exit 1
fi

request_id="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
domain="$2"
decision="$(echo "$3" | tr '[:lower:]' '[:upper:]')"
confidence="$4"
reason_code="$5"
reason_detail="${6:-}"
offer_amount_wei="${7:-}"
eta_seconds="${8:-}"
offer_id="$(echo "${9:-}" | tr '[:upper:]' '[:lower:]')"
tx_hash="$(echo "${10:-}" | tr '[:upper:]' '[:lower:]')"

agent_address="$(cast wallet address --private-key "$PRIVATE_KEY" | tr '[:upper:]' '[:lower:]')"

payload="$(
  jq -nc \
    --arg agentAddress "$agent_address" \
    --arg requestId "$request_id" \
    --arg domain "$domain" \
    --arg decision "$decision" \
    --arg confidence "$confidence" \
    --arg reasonCode "$reason_code" \
    --arg reasonDetail "$reason_detail" \
    --arg offerAmountWei "$offer_amount_wei" \
    --arg etaSeconds "$eta_seconds" \
    --arg offerId "$offer_id" \
    --arg txHash "$tx_hash" \
    '{
      agentAddress:$agentAddress,
      requestId:$requestId,
      domain:$domain,
      decision:$decision,
      confidence:($confidence | tonumber),
      reasonCode:$reasonCode
    }
    + (if $reasonDetail == "" then {} else {reasonDetail:$reasonDetail} end)
    + (if $offerAmountWei == "" then {} else {offerAmountWei:$offerAmountWei} end)
    + (if $etaSeconds == "" then {} else {etaSeconds:($etaSeconds | tonumber)} end)
    + (if $offerId == "" then {} else {offerId:$offerId} end)
    + (if $txHash == "" then {} else {txHash:$txHash} end)'
)"

echo "agentAddress=$agent_address"
echo "requestId=$request_id"
echo "domain=$domain"
echo "decision=$decision"
echo "reasonCode=$reason_code"

curl -sS \
  -X POST "$API_URL/agents/decisions" \
  -H 'content-type: application/json' \
  --data "$payload" | jq .
