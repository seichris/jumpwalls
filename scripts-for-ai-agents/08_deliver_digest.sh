#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd cast
require_env RPC_URL
require_env CONTRACT_ADDRESS
require_env PRIVATE_KEY

if [ $# -lt 3 ]; then
  echo "Usage: $0 <job_id> <digest_hash> <metadata_uri> [proof_type_or_uri]" >&2
  exit 1
fi

job_id="$1"
digest_hash="$2"
metadata_uri="$3"
proof_type_or_uri="${4:-reputation-only}"

cast send \
  "$CONTRACT_ADDRESS" \
  "deliverDigest(bytes32,bytes32,string,string)" \
  "$job_id" \
  "$digest_hash" \
  "$metadata_uri" \
  "$proof_type_or_uri" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"

