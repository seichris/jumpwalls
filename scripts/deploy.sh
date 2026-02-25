#!/usr/bin/env bash
set -euo pipefail

dotenv_path="${DOTENV_CONFIG_PATH:-.env}"
if [[ -f "$dotenv_path" ]]; then
  rpc_url_set=0; private_key_set=0; chain_id_set=0; forge_flags_set=0

  [[ -n "${RPC_URL:-}" ]] && rpc_url_set=1
  [[ -n "${PRIVATE_KEY:-}" ]] && private_key_set=1
  [[ -n "${CHAIN_ID:-}" ]] && chain_id_set=1
  [[ -n "${FORGE_SCRIPT_FLAGS:-}" ]] && forge_flags_set=1

  rpc_url_val="${RPC_URL:-}"
  private_key_val="${PRIVATE_KEY:-}"
  chain_id_val="${CHAIN_ID:-}"
  forge_flags_val="${FORGE_SCRIPT_FLAGS:-}"

  # shellcheck disable=SC1090
  source "$dotenv_path"

  [[ "$rpc_url_set" -eq 1 ]] && RPC_URL="$rpc_url_val"
  [[ "$private_key_set" -eq 1 ]] && PRIVATE_KEY="$private_key_val"
  [[ "$chain_id_set" -eq 1 ]] && CHAIN_ID="$chain_id_val"
  [[ "$forge_flags_set" -eq 1 ]] && FORGE_SCRIPT_FLAGS="$forge_flags_val"
fi

trim() {
  local v="${1:-}"
  echo "$v" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

rpc_host() {
  local url="${1:-}"
  echo "$url" | sed -E 's#^[a-zA-Z]+://([^/@]+@)?([^/:?]+).*#\2#'
}

select_rpc_url() {
  local raw="${1:-}"
  if [[ -z "$raw" ]]; then
    if [[ "${CHAIN_ID:-}" == "1" ]]; then
      raw="${RPC_URLS_ETHEREUM_MAINNET:-}"
      [[ -z "$raw" ]] && raw="${RPC_URL_ETHEREUM_MAINNET:-}"
    elif [[ "${CHAIN_ID:-}" == "8453" ]]; then
      raw="${RPC_URLS_BASE_MAINNET:-}"
      [[ -z "$raw" ]] && raw="${RPC_URL_BASE_MAINNET:-}"
    elif [[ "${CHAIN_ID:-}" == "11155111" ]]; then
      raw="${RPC_URLS_ETHEREUM_SEPOLIA:-}"
      [[ -z "$raw" ]] && raw="${RPC_URL_ETHEREUM_SEPOLIA:-}"
    fi
  fi

  local candidates=()
  IFS=',' read -r -a candidates <<< "$raw"

  if [[ "${#candidates[@]}" -eq 0 ]]; then
    echo "Missing RPC_URL (or RPC_URLS_BASE_MAINNET/RPC_URLS_ETHEREUM_MAINNET/RPC_URLS_ETHEREUM_SEPOLIA)" >&2
    return 1
  fi

  if ! command -v cast >/dev/null 2>&1; then
    RPC_URL="$(trim "${candidates[0]}")"
    return 0
  fi

  local u=""
  for u in "${candidates[@]}"; do
    u="$(trim "$u")"
    [[ -z "$u" ]] && continue
    if cast chain-id --rpc-url "$u" >/dev/null 2>&1; then
      RPC_URL="$u"
      return 0
    fi
  done

  local hosts=()
  for u in "${candidates[@]}"; do
    u="$(trim "$u")"
    [[ -z "$u" ]] && continue
    hosts+=("$(rpc_host "$u")")
  done
  echo "No working RPC_URL found (tried: ${hosts[*]:-<none>})." >&2
  echo "If you're using a public RPC, it may be rate-limiting you; use a dedicated provider endpoint." >&2
  return 1
}

select_rpc_url "${RPC_URL:-}"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "Missing PRIVATE_KEY (deployer EOA)" >&2
  exit 1
fi

chain_id="${CHAIN_ID:-}"
if [[ -z "$chain_id" ]]; then
  if command -v cast >/dev/null 2>&1; then
    chain_id="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)"
  fi
fi

script_file="script/DeployInfoFi.s.sol"
script_target="DeployInfoFi"
contract_label="InfoFi"

echo "Deploying ${contract_label}..."
[[ -n "${chain_id:-}" ]] && echo "  chainId: $chain_id"
echo "  rpc: $(rpc_host "$RPC_URL")"
echo "  kind: infofi"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pushd "$repo_root/contracts" >/dev/null

forge script \
  "${script_file}:${script_target}" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  ${FORGE_SCRIPT_FLAGS:-}

if [[ -n "${chain_id:-}" && -f "broadcast/${script_file##*/}/$chain_id/run-latest.json" && -x "$(command -v jq)" ]]; then
  addr="$(jq -r '.receipts[0].contractAddress // empty' "broadcast/${script_file##*/}/$chain_id/run-latest.json")"
  if [[ -n "${addr:-}" && "$addr" != "null" ]]; then
    echo "Deployed at: $addr"
  fi
fi

popd >/dev/null
