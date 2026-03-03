#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_cmd cast
require_env API_URL
resolve_private_key

if [ $# -lt 1 ]; then
  echo "Usage: $0 <domains_logged_in_json_file> [expected_eta_by_domain_json_file] [ttl_seconds] [client_version]" >&2
  exit 1
fi

domains_file="$1"
expected_eta_file="${2:-}"
ttl_seconds="${3:-120}"
client_version="${4:-agent-cli-v1}"

if [ ! -f "$domains_file" ]; then
  echo "Domains file not found: $domains_file" >&2
  exit 1
fi

domains_json="$(jq -c '.' "$domains_file")"
if [ -z "$domains_json" ] || [ "$domains_json" = "null" ]; then
  echo "Invalid domains JSON file: $domains_file" >&2
  exit 1
fi

expected_eta_json="{}"
if [ -n "$expected_eta_file" ]; then
  if [ ! -f "$expected_eta_file" ]; then
    echo "Expected ETA file not found: $expected_eta_file" >&2
    exit 1
  fi
  expected_eta_json="$(jq -c '.' "$expected_eta_file")"
  if [ -z "$expected_eta_json" ] || [ "$expected_eta_json" = "null" ]; then
    echo "Invalid expected ETA JSON file: $expected_eta_file" >&2
    exit 1
  fi
fi

agent_address="$(cast wallet address --private-key "$PRIVATE_KEY" | tr '[:upper:]' '[:lower:]')"

challenge_payload="$(
  jq -nc \
    --arg agentAddress "$agent_address" \
    --arg purpose "heartbeat" \
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

heartbeat_payload="$(
  jq -nc \
    --arg agentAddress "$agent_address" \
    --arg nonce "$nonce" \
    --arg signature "$signature" \
    --arg clientVersion "$client_version" \
    --argjson domainsLoggedIn "$domains_json" \
    --argjson expectedEtaByDomain "$expected_eta_json" \
    --arg ttlSeconds "$ttl_seconds" \
    '{
      agentAddress:$agentAddress,
      nonce:$nonce,
      signature:$signature,
      domainsLoggedIn:$domainsLoggedIn,
      expectedEtaByDomain:$expectedEtaByDomain,
      ttlSeconds:($ttlSeconds | tonumber),
      clientVersion:$clientVersion
    }'
)"

quiet="${AGENT_HEARTBEAT_QUIET:-0}"
if [ "$quiet" != "1" ]; then
  echo "agentAddress=$agent_address"
  echo "domainsFile=$domains_file"
  if [ -n "$expected_eta_file" ]; then
    echo "expectedEtaFile=$expected_eta_file"
  fi
  echo "ttlSeconds=$ttl_seconds"
fi
heartbeat_response="$(
  curl -sS \
    -X POST "$API_URL/agents/heartbeat" \
    -H 'content-type: application/json' \
    --data "$heartbeat_payload"
)"

if [ "$(echo "$heartbeat_response" | jq -r '.heartbeat.agentAddress // empty')" = "" ]; then
  echo "Heartbeat request failed:" >&2
  echo "$heartbeat_response" | jq . >&2
  exit 1
fi

output_mode="${AGENT_HEARTBEAT_OUTPUT:-pretty}"
if [ "$output_mode" = "raw" ]; then
  echo "$heartbeat_response"
else
  echo "$heartbeat_response" | jq .
fi
