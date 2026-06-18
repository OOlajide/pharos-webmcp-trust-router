#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
ENV_FILE="${ENV_FILE:-$SKILL_DIR/.env}"

load_env_file() {
  local file="$1"
  local line key value first last

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      first="${value:0:1}"
      last="${value: -1}"
      if { [[ "$first" == '"' ]] && [[ "$last" == '"' ]]; } || { [[ "$first" == "'" ]] && [[ "$last" == "'" ]]; }; then
        value="${value:1:${#value}-2}"
      fi

      case "$key" in
        PRIVATE_KEY|RPC|EXPECTED_CHAIN_ID)
          export "$key=$value"
          ;;
      esac
    fi
  done < "$file"
}

if [[ -f "$ENV_FILE" ]]; then
  load_env_file "$ENV_FILE"
fi

RECEIPT_HASH="${1:-}"
RPC="${RPC:-https://atlantic.dplabs-internal.com}"
EXPECTED_CHAIN_ID="${EXPECTED_CHAIN_ID:-688689}"

if [[ ! "$RECEIPT_HASH" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Usage: ./assets/pharos-anchor-receipt.sh 0x<64-hex-receipt-hash>" >&2
  exit 2
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "cast is required. Install Foundry first: https://book.getfoundry.sh/getting-started/installation" >&2
  exit 2
fi

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "PRIVATE_KEY is not set. Add it to $ENV_FILE or export it before running." >&2
  exit 2
fi

DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"

if [[ "$CHAIN_ID" != "$EXPECTED_CHAIN_ID" ]]; then
  echo "Unexpected chain ID $CHAIN_ID for RPC $RPC. Expected $EXPECTED_CHAIN_ID." >&2
  exit 2
fi

echo "Network: Pharos Atlantic Testnet"
echo "Env file: $ENV_FILE"
echo "RPC: $RPC"
echo "Sender: $DEPLOYER"
echo "Receipt hash: $RECEIPT_HASH"
echo "Balance:"
cast balance "$DEPLOYER" --rpc-url "$RPC" --ether

echo
echo "Sending zero-value memo transaction with receipt hash as calldata..."
cast send "$DEPLOYER" \
  --value 0 \
  --data "$RECEIPT_HASH" \
  --private-key "$PRIVATE_KEY" \
  --rpc-url "$RPC"
