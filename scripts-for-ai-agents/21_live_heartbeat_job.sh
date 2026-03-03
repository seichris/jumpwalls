#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd jq
require_env API_URL
resolve_private_key

if [ $# -lt 1 ]; then
  echo "Usage: $0 <domains_logged_in_json_file> [expected_eta_by_domain_json_file] [ttl_seconds] [client_version] [status_file]" >&2
  exit 1
fi

domains_file="$1"
expected_eta_file="${2:-}"
ttl_seconds="${3:-180}"
client_version="${4:-agent-cli-heartbeat-job-v1}"
status_file="${5:-.agent-heartbeat-status.json}"

script_dir="$(cd "$(dirname "$0")" && pwd)"
checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

set +e
heartbeat_response="$(
  AGENT_HEARTBEAT_QUIET=1 AGENT_HEARTBEAT_OUTPUT=raw \
    "$script_dir/16_agent_heartbeat.sh" "$domains_file" "$expected_eta_file" "$ttl_seconds" "$client_version" 2>&1
)"
heartbeat_rc=$?
set -e

if [ "$heartbeat_rc" -ne 0 ]; then
  jq -nc \
    --arg checkedAt "$checked_at" \
    --arg error "$heartbeat_response" \
    '{
      status:"error",
      checkedAt:$checkedAt,
      error:$error
    }' > "$status_file"
  echo "$heartbeat_response" >&2
  exit "$heartbeat_rc"
fi

agent_address="$(echo "$heartbeat_response" | jq -r '.heartbeat.agentAddress // empty')"
last_seen_at="$(echo "$heartbeat_response" | jq -r '.heartbeat.lastSeenAt // empty')"
expires_at="$(echo "$heartbeat_response" | jq -r '.heartbeat.expiresAt // empty')"
domains_logged_in_json="$(echo "$heartbeat_response" | jq -c '.heartbeat.domainsLoggedIn // []')"

if [ -z "$agent_address" ] || [ -z "$last_seen_at" ] || [ -z "$expires_at" ]; then
  jq -nc \
    --arg checkedAt "$checked_at" \
    --arg error "Unexpected heartbeat response shape" \
    --arg response "$heartbeat_response" \
    '{
      status:"error",
      checkedAt:$checkedAt,
      error:$error,
      response:$response
    }' > "$status_file"
  echo "Unexpected heartbeat response shape" >&2
  echo "$heartbeat_response" | jq . >&2 || true
  exit 1
fi

jq -nc \
  --arg checkedAt "$checked_at" \
  --arg lastSuccessAt "$checked_at" \
  --arg agentAddress "$agent_address" \
  --arg lastSeenAt "$last_seen_at" \
  --arg expiresAt "$expires_at" \
  --arg ttlSeconds "$ttl_seconds" \
  --argjson domainsLoggedIn "$domains_logged_in_json" \
  '{
    status:"ok",
    checkedAt:$checkedAt,
    lastSuccessAt:$lastSuccessAt,
    agentAddress:$agentAddress,
    heartbeat:{
      lastSeenAt:$lastSeenAt,
      expiresAt:$expiresAt,
      ttlSeconds:($ttlSeconds | tonumber),
      domainsLoggedIn:$domainsLoggedIn
    }
  }' > "$status_file"

echo "$heartbeat_response" | jq .
echo "proof.scheduler.statusFile=$status_file"
echo "proof.scheduler.lastSuccessAt=$checked_at"
echo "proof.heartbeat.agentAddress=$agent_address"
echo "proof.heartbeat.expiresAt=$expires_at"
