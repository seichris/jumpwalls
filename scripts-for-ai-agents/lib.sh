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

resolve_private_key() {
  if [ -n "${PRIVATE_KEY:-}" ]; then
    if [[ ! "${PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
      echo "Invalid PRIVATE_KEY format. Expected 0x-prefixed 32-byte hex value." >&2
      exit 1
    fi
    return 0
  fi

  local key_file="${PRIVATE_KEY_FILE:-}"
  if [ -z "$key_file" ]; then
    echo "Missing required env var: PRIVATE_KEY or PRIVATE_KEY_FILE" >&2
    exit 1
  fi
  if [ ! -f "$key_file" ]; then
    echo "Private key file not found: $key_file" >&2
    exit 1
  fi

  local extracted
  extracted="$(awk 'match($0, /0x[0-9a-fA-F]{64}/) { print substr($0, RSTART, RLENGTH); exit }' "$key_file")"
  if [ -z "$extracted" ]; then
    echo "Could not find a 0x-prefixed 32-byte hex private key in: $key_file" >&2
    exit 1
  fi

  PRIVATE_KEY="$extracted"
  export PRIVATE_KEY
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
