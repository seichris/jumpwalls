#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL

echo "GET $API_URL/health"
curl -sS "$API_URL/health" | jq .

echo

echo "GET $API_URL/contract (may be 404)"
curl -sS "$API_URL/contract" | jq .
