#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL

if [ $# -lt 3 ]; then
  echo "Usage: $0 <job_id> <consultant_address> <digest_file> [source_uri] [question] [proof]" >&2
  exit 1
fi

job_id="$1"
consultant_address="$2"
digest_file="$3"
source_uri="${4:-}"
question="${5:-}"
proof="${6:-}"

if [ ! -f "$digest_file" ]; then
  echo "Digest file not found: $digest_file" >&2
  exit 1
fi

digest_content="$(cat "$digest_file")"

payload="$(
  jq -n \
    --arg jobId "$job_id" \
    --arg consultantAddress "$consultant_address" \
    --arg digest "$digest_content" \
    --arg sourceURI "$source_uri" \
    --arg question "$question" \
    --arg proof "$proof" \
    '{
      jobId: $jobId,
      consultantAddress: $consultantAddress,
      digest: $digest,
      sourceURI: (if $sourceURI == "" then null else $sourceURI end),
      question: (if $question == "" then null else $question end),
      proof: (if $proof == "" then null else $proof end)
    }'
)"

response="$(
  extra_headers=()
  if [ -n "${GEMINI_API_KEY:-}" ]; then
    extra_headers+=(-H "x-gemini-api-key: ${GEMINI_API_KEY}")
  fi

  curl -sS "$API_URL/digests" \
    -H "Content-Type: application/json" \
    "${extra_headers[@]}" \
    -d "$payload"
)"

echo "$response" | jq .

if echo "$response" | jq -e '.error != null' >/dev/null; then
  exit 1
fi
