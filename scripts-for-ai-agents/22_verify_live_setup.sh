#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL

if [ $# -lt 2 ]; then
  echo "Usage: $0 <agent_address> <domains_csv> [status_file]" >&2
  exit 1
fi

agent_address="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
domains_csv="$2"
status_file="${3:-.agent-heartbeat-status.json}"

domains_encoded="$(jq -rn --arg value "$domains_csv" '$value|@uri')"
readiness_response="$(
  curl -sS "$API_URL/agents/$agent_address/readiness?domains=$domains_encoded"
)"

ready="$(echo "$readiness_response" | jq -r '.readiness.ready // false')"
if [ "$ready" != "true" ]; then
  echo "Agent readiness check failed: readiness.ready is not true" >&2
  echo "$readiness_response" | jq . >&2
  exit 1
fi

heartbeat_active="$(echo "$readiness_response" | jq -r '.readiness.heartbeat.isActive // false')"
if [ "$heartbeat_active" != "true" ]; then
  echo "Agent readiness check failed: heartbeat is missing or inactive" >&2
  echo "$readiness_response" | jq . >&2
  exit 1
fi

if [ ! -f "$status_file" ]; then
  echo "Agent readiness check failed: heartbeat status file not found: $status_file" >&2
  exit 1
fi

scheduler_status="$(jq -r '.status // empty' "$status_file")"
scheduler_last_success="$(jq -r '.lastSuccessAt // empty' "$status_file")"
scheduler_agent="$(jq -r '.agentAddress // empty' "$status_file" | tr '[:upper:]' '[:lower:]')"

if [ "$scheduler_status" != "ok" ] || [ -z "$scheduler_last_success" ]; then
  echo "Agent readiness check failed: no successful scheduled heartbeat found in $status_file" >&2
  jq . "$status_file" >&2
  exit 1
fi

if [ -n "$scheduler_agent" ] && [ "$scheduler_agent" != "$agent_address" ]; then
  echo "Agent readiness check failed: status file agent ($scheduler_agent) does not match requested agent ($agent_address)" >&2
  jq . "$status_file" >&2
  exit 1
fi

chain_id="$(echo "$readiness_response" | jq -r '.readiness.chainScope.chainId // empty')"
contract_address="$(echo "$readiness_response" | jq -r '.readiness.chainScope.contractAddress // empty')"
last_seen_at="$(echo "$readiness_response" | jq -r '.readiness.heartbeat.lastSeenAt // empty')"
expires_at="$(echo "$readiness_response" | jq -r '.readiness.heartbeat.expiresAt // empty')"
listed_domains="$(echo "$readiness_response" | jq -r '.readiness.listedDomains | join(",")')"

echo "proof.setup.ready=true"
echo "proof.chain.chainId=$chain_id"
echo "proof.chain.contractAddress=$contract_address"
echo "proof.agent.address=$agent_address"
echo "proof.agent.requestedDomains=$domains_csv"
echo "proof.agent.listedDomains=$listed_domains"
echo "proof.heartbeat.lastSeenAt=$last_seen_at"
echo "proof.heartbeat.expiresAt=$expires_at"
echo "proof.scheduler.statusFile=$status_file"
echo "proof.scheduler.lastSuccessAt=$scheduler_last_success"
echo "$readiness_response" | jq .
