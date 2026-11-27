#!/usr/bin/env bash
# Deploy one of the demo's own contracts (not a circuit verifier) to GIWA Sepolia.
#
#   scripts/deploy-demo-contract.sh <giwa-vault|ssiat-drop> [--broadcast]
#
# Without --broadcast it only simulates. The deployer key is read from the
# circuits checkout's .env.development (PRIVATE_KEY), exported into this
# process only, never on a command line. Before broadcasting it records the
# deployer's nonce; GIWA Sepolia's RPC lags between nodes, so a retry after an
# RPC error must not send a second deployment: if the nonce moved, it stops.
# After broadcasting it prints the new address from the broadcast record and
# reads the contract's pinned values back over RPC.
#
# Needs: forge 1.4.3 and cast on PATH ($HOME/.foundry/bin), jq.
set -euo pipefail

REPO=$(git rev-parse --show-superproject-working-tree)
REPO=${REPO:-$(git rev-parse --show-toplevel)}
DEMO="$REPO/proofport-app-demo"
[[ -d "$DEMO/contracts" ]] || DEMO="$REPO"
CONTRACTS="$DEMO/contracts"
ENV_FILE="$REPO/circuits/.env.development"
RPC=https://sepolia-rpc.giwa.io
CHAIN=91342

target=${1:-}
broadcast=${2:-}
case "$target" in
  giwa-vault)
    script=script/DeployGiwaDemoVault.s.sol:DeployGiwaDemoVault
    record=DeployGiwaDemoVault.s.sol
    # The existing dKRW test token the vault holds (contracts/README.md).
    export GIWA_VAULT_ASSET=0x417573024528f3c9daD782eF5316E992F3029e81
    reads=("VERIFIER_STANDARD()(address)" "VERIFIER_ANDROID()(address)" "VERIFIER_ANDROID_FACTORY()(address)" "PUBLIC_INPUT_COUNT()(uint256)" "OPRF_KEY_HASH()(bytes32)" "OPRF_DOMAIN()(string)" "asset()(address)" "domainSeparator()(bytes32)")
    ;;
  ssiat-drop)
    script=script/DeploySsiatDrop.s.sol:DeploySsiatDrop
    record=DeploySsiatDrop.s.sol
    reads=("VERIFIER_STANDARD()(address)" "VERIFIER_ANDROID()(address)" "VERIFIER_ANDROID_FACTORY()(address)" "PUBLIC_INPUT_COUNT()(uint256)" "OPRF_KEY_HASH()(bytes32)" "OPRF_DOMAIN()(string)" "token()(address)" "remaining()(uint256)")
    ;;
  *)
    echo "Unknown contract '$target'. Known: giwa-vault, ssiat-drop." >&2
    exit 2
    ;;
esac
if [[ -n "$broadcast" && "$broadcast" != "--broadcast" ]]; then
  echo "Unknown option '$broadcast'. Known: --broadcast." >&2
  exit 2
fi

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE (deployer key)." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[[ -n "${PRIVATE_KEY:-}" ]] || { echo "PRIVATE_KEY is not set in $ENV_FILE." >&2; exit 1; }

forge --version | head -1
deployer=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "deployer $deployer"

cd "$CONTRACTS"
if [[ -z "$broadcast" ]]; then
  forge script "$script" --rpc-url "$RPC"
  echo "simulated only; nothing was sent"
  exit 0
fi

nonce_before=$(cast nonce "$deployer" --rpc-url "$RPC")
echo "nonce before $nonce_before"
if ! forge script "$script" --rpc-url "$RPC" --broadcast; then
  nonce_after=$(cast nonce "$deployer" --rpc-url "$RPC")
  echo "forge script failed; nonce now $nonce_after (was $nonce_before)." >&2
  if [[ "$nonce_after" != "$nonce_before" ]]; then
    echo "The nonce moved: a transaction was sent. Inspect broadcast/$record/$CHAIN before any retry." >&2
  fi
  exit 1
fi

run="broadcast/$record/$CHAIN/run-latest.json"
[[ -f "$run" ]] || { echo "No broadcast record at $run." >&2; exit 1; }
jq -r '.transactions[] | select(.transactionType=="CREATE") | "\(.contractName) \(.contractAddress) \(.hash)"' "$run"
address=$(jq -r --arg n "$(basename "${script%%:*}" .s.sol | sed 's/^Deploy//')" \
  '[.transactions[] | select(.transactionType=="CREATE" and .contractName==$n)][0].contractAddress' "$run")
[[ "$address" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Could not read the deployed address from $run." >&2; exit 1; }
# GIWA Sepolia's RPC nodes lag each other: the node answering may not have the
# block yet. Wait up to two minutes for the bytecode before reading anything.
code=0x
for _ in $(seq 1 24); do
  code=$(cast code "$address" --rpc-url "$RPC")
  [[ "$code" != "0x" ]] && break
  sleep 5
done
[[ "$code" != "0x" ]] || { echo "No bytecode at $address after 2 minutes. Re-read before trusting it." >&2; exit 1; }
echo "deployed $address"
for sig in "${reads[@]}"; do
  echo "  $sig = $(cast call "$address" "$sig" --rpc-url "$RPC")"
done
