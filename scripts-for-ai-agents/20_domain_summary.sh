#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL

if [ $# -lt 1 ]; then
  echo "Usage: $0 <domain>" >&2
  exit 1
fi

domain="$1"

echo "GET $API_URL/domains/$domain/summary"
curl -sS "$API_URL/domains/$domain/summary" | jq .
