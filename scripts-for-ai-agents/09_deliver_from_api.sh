#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd jq

if [ $# -lt 3 ]; then
  echo "Usage: $0 <job_id> <consultant_address> <digest_file> [source_uri] [question] [proof] [citations_json_file]" >&2
  exit 1
fi

job_id="$1"
consultant_address="$2"
digest_file="$3"
source_uri="${4:-}"
question="${5:-}"
proof="${6:-}"
citations_file="${7:-}"

store_json="$("$(dirname "$0")/07_store_digest.sh" "$job_id" "$consultant_address" "$digest_file" "$source_uri" "$question" "$proof" "$citations_file")"
digest_hash="$(echo "$store_json" | jq -r '.digest.digestHash')"
metadata_uri="$(echo "$store_json" | jq -r '.digest.metadataURI')"

if [ -z "$digest_hash" ] || [ "$digest_hash" = "null" ] || [ -z "$metadata_uri" ] || [ "$metadata_uri" = "null" ]; then
  echo "Failed to parse digestHash/metadataURI from API response" >&2
  echo "$store_json" >&2
  exit 1
fi

"$(dirname "$0")/08_deliver_digest.sh" "$job_id" "$digest_hash" "$metadata_uri" "${proof:-reputation-only}"
