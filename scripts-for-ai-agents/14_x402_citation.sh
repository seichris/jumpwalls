#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd jq

if [ $# -lt 6 ]; then
  echo "Usage: $0 <url> <chain_id> <token|token_address> <amount_wei> <pay_to> <tx_hash> [purchased_at_iso]" >&2
  exit 1
fi

url="$1"
chain_id="$2"
token="$3"
amount_wei="$4"
pay_to="$5"
tx_hash="$6"
purchased_at="${7:-}"

if [ -z "$url" ]; then
  echo "URL cannot be empty" >&2
  exit 1
fi
if ! [[ "$chain_id" =~ ^[0-9]+$ ]]; then
  echo "Invalid chain_id: $chain_id" >&2
  exit 1
fi
if [ -z "$token" ]; then
  echo "Token cannot be empty" >&2
  exit 1
fi
if ! [[ "$amount_wei" =~ ^[0-9]+$ ]]; then
  echo "Invalid amount_wei: $amount_wei" >&2
  exit 1
fi
if ! [[ "$pay_to" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid pay_to address: $pay_to" >&2
  exit 1
fi
if ! [[ "$tx_hash" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Invalid tx_hash: $tx_hash" >&2
  exit 1
fi

jq -n \
  --arg url "$url" \
  --argjson chainId "$chain_id" \
  --arg token "$token" \
  --arg amount "$amount_wei" \
  --arg payTo "$pay_to" \
  --arg txHash "$tx_hash" \
  --arg purchasedAt "$purchased_at" \
  '{
    type: "x402",
    url: $url,
    chainId: $chainId,
    token: $token,
    amount: $amount,
    payTo: ($payTo | ascii_downcase),
    txHash: ($txHash | ascii_downcase)
  } + (
    if $purchasedAt == "" then {}
    else { purchasedAt: $purchasedAt }
    end
  )'
