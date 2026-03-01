#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL

if [ $# -lt 2 ]; then
  echo "Usage: $0 <client_id_hash> <buckets_json_file>" >&2
  echo "buckets_json_file format: [{\"domain\":\"example.com\",\"bucketStart\":\"2026-03-01T00:00:00Z\",\"signalCount\":1}]" >&2
  exit 1
fi

client_id_hash="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
buckets_file="$2"

if [ ! -f "$buckets_file" ]; then
  echo "Buckets file not found: $buckets_file" >&2
  exit 1
fi

buckets_json="$(jq -c '.' "$buckets_file")"
if [ -z "$buckets_json" ] || [ "$buckets_json" = "null" ]; then
  echo "Invalid buckets JSON file: $buckets_file" >&2
  exit 1
fi

payload="$(
  jq -nc \
    --arg clientIdHash "$client_id_hash" \
    --argjson buckets "$buckets_json" \
    '{clientIdHash:$clientIdHash,buckets:$buckets}'
)"

echo "clientIdHash=$client_id_hash"
echo "bucketsFile=$buckets_file"

curl -sS \
  -X POST "$API_URL/signals/extension/domains" \
  -H 'content-type: application/json' \
  --data "$payload" | jq .
