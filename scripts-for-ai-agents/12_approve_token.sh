#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env PRIVATE_KEY
require_env CONTRACT_ADDRESS

if [ $# -lt 2 ]; then
  echo "Usage: $0 <token_address> <amount_wei> [spender]" >&2
  exit 1
fi

token="$1"
amount_wei="$2"
spender="${3:-$CONTRACT_ADDRESS}"

cast send \
  "$token" \
  "approve(address,uint256)" \
  "$spender" \
  "$amount_wei" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

