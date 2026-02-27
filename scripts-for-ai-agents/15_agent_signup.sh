#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_cmd cast
require_env API_URL
require_env PRIVATE_KEY

if [ $# -lt 1 ]; then
  echo "Usage: $0 <capabilities_json_file> [display_name] [status_ACTIVE_or_PAUSED]" >&2
  exit 1
fi

capabilities_file="$1"
display_name="${2:-}"
status="${3:-ACTIVE}"

if [ ! -f "$capabilities_file" ]; then
  echo "Capabilities file not found: $capabilities_file" >&2
  exit 1
fi

capabilities_json="$(jq -c '.' "$capabilities_file")"
if [ -z "$capabilities_json" ] || [ "$capabilities_json" = "null" ]; then
  echo "Invalid capabilities JSON file: $capabilities_file" >&2
  exit 1
fi

agent_address="$(cast wallet address --private-key "$PRIVATE_KEY" | tr '[:upper:]' '[:lower:]')"

challenge_payload="$(
  jq -nc \
    --arg agentAddress "$agent_address" \
    --arg purpose "signup" \
    '{agentAddress:$agentAddress,purpose:$purpose}'
)"

challenge_response="$(
  curl -sS \
    -X POST "$API_URL/agents/challenge" \
    -H 'content-type: application/json' \
    --data "$challenge_payload"
)"

message_to_sign="$(echo "$challenge_response" | jq -r '.challenge.messageToSign // empty')"
nonce="$(echo "$challenge_response" | jq -r '.challenge.nonce // empty')"

if [ -z "$message_to_sign" ] || [ -z "$nonce" ]; then
  echo "Challenge request failed:" >&2
  echo "$challenge_response" | jq . >&2
  exit 1
fi

signature="$(cast wallet sign --private-key "$PRIVATE_KEY" "$message_to_sign")"

signup_payload="$(
  jq -nc \
    --arg agentAddress "$agent_address" \
    --arg nonce "$nonce" \
    --arg signature "$signature" \
    --arg displayName "$display_name" \
    --arg status "$status" \
    --argjson capabilities "$capabilities_json" \
    '{
      agentAddress:$agentAddress,
      nonce:$nonce,
      signature:$signature,
      capabilities:$capabilities
    }
    + (if $displayName == "" then {} else {displayName:$displayName} end)
    + (if $status == "" then {} else {status:$status} end)'
)"

echo "agentAddress=$agent_address"
echo "capabilitiesFile=$capabilities_file"
if [ -n "$display_name" ]; then
  echo "displayName=$display_name"
fi
echo "status=$status"

curl -sS \
  -X POST "$API_URL/agents/signup" \
  -H 'content-type: application/json' \
  --data "$signup_payload" | jq .

