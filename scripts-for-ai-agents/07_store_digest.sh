#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd curl
require_cmd jq
require_env API_URL

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

if [ ! -f "$digest_file" ]; then
  echo "Digest file not found: $digest_file" >&2
  exit 1
fi

digest_content="$(cat "$digest_file")"
citations_json="null"
if [ -n "$citations_file" ]; then
  if [ ! -f "$citations_file" ]; then
    echo "Citations JSON file not found: $citations_file" >&2
    exit 1
  fi
  if ! jq -e . "$citations_file" >/dev/null; then
    echo "Citations JSON file is not valid JSON: $citations_file" >&2
    exit 1
  fi
  citations_json="$(cat "$citations_file")"
fi

payload="$(
  jq -n \
    --arg jobId "$job_id" \
    --arg consultantAddress "$consultant_address" \
    --arg digest "$digest_content" \
    --arg sourceURI "$source_uri" \
    --arg question "$question" \
    --arg proof "$proof" \
    --argjson citations "$citations_json" \
    '{
      jobId: $jobId,
      consultantAddress: $consultantAddress,
      digest: $digest,
      sourceURI: (if $sourceURI == "" then null else $sourceURI end),
      question: (if $question == "" then null else $question end),
      proof: (if $proof == "" then null else $proof end)
    } + (
      if $citations == null then {}
      else { citations: $citations }
      end
    )'
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
