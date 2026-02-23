#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

normalize_repo() {
  local input="$1"
  local trimmed="${input#https://}"
  trimmed="${trimmed#http://}"
  trimmed="${trimmed#www.}"
  trimmed="${trimmed#github.com/}"
  trimmed="${trimmed#/}"
  if [ -z "$trimmed" ]; then
    echo "" >&2
    return 1
  fi
  echo "github.com/${trimmed}"
}

to_bytes32_salt() {
  local input="$1"
  if [[ "$input" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "$input"
    return 0
  fi
  cast keccak "$input"
}

native_token_address() {
  echo "0x0000000000000000000000000000000000000000"
}
