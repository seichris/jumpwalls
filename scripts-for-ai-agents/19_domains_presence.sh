#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL

take="${1:-100}"
min_active_agents="${2:-0}"

echo "GET $API_URL/domains/presence?take=$take&minActiveAgents=$min_active_agents"
curl -sS "$API_URL/domains/presence?take=$take&minActiveAgents=$min_active_agents" | jq .
