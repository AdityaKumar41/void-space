#!/usr/bin/env bash
#
# Deploy AssetLicenseRegistry.sol to the local Anvil chain and publish the
# resulting address + ABI where api and worker can read them (SRS §9.3).
#
# Runs inside the deploy-contracts container (foundry image), but is equally
# usable from a host with a native Foundry install:
#   CONTRACT_STATE_PATH=/tmp/contracts.json ANVIL_RPC_URL=http://localhost:8545 \
#     bash packages/contracts/scripts/docker-deploy.sh
set -euo pipefail

RPC_URL="${ANVIL_RPC_URL:-http://localhost:8545}"
STATE_PATH="${CONTRACT_STATE_PATH:-/shared/contracts.json}"

echo "[deploy] waiting for anvil at ${RPC_URL}"
for _ in $(seq 1 60); do
  if cast block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1; then
    echo "[deploy] anvil is ready"
    break
  fi
  sleep 1
done
cast block-number --rpc-url "${RPC_URL}" >/dev/null

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Anvil's first deterministic test account is used as the platform signer for
# local development (§3.9.3) — never for anything of value.
DEPLOYER_KEY="${PLATFORM_SIGNER_SEED:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
PLATFORM_SIGNER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_KEY}")"

echo "[deploy] forge build"
forge build

echo "[deploy] deploying AssetLicenseRegistry (publisher=${PLATFORM_SIGNER_ADDRESS})"
DEPLOYER_PRIVATE_KEY="${DEPLOYER_KEY}" \
PUBLISHER_ADDRESS="${PLATFORM_SIGNER_ADDRESS}" \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "${RPC_URL}" \
  --broadcast \
  --slow

CONTRACT_ADDRESS="$(jq -r '.transactions[0].contractAddress // empty' \
  broadcast/Deploy.s.sol/*/run-latest.json 2>/dev/null || true)"

if [ -z "${CONTRACT_ADDRESS}" ] || [ "${CONTRACT_ADDRESS}" = "null" ]; then
  echo "[deploy] ERROR: could not read the deployed address from the broadcast log" >&2
  exit 1
fi

mkdir -p "$(dirname "${STATE_PATH}")"
forge inspect src/AssetLicenseRegistry.sol:AssetLicenseRegistry abi --json > "$(dirname "${STATE_PATH}")/AssetLicenseRegistry.abi.json"

# The contract address travels to api/worker via the shared volume (compose) and
# via .env.contracts for native dev (§9.3 step 3).
node -e '
const fs = require("fs");
const state = {
  contractAddress: process.argv[1],
  chainId: Number(process.env.ANVIL_CHAIN_ID || 31337),
  rpcUrl: process.argv[2],
  publisherAddress: process.argv[3],
  deployedAt: new Date().toISOString(),
};
fs.writeFileSync(process.argv[4], JSON.stringify(state, null, 2) + "\n");
' "${CONTRACT_ADDRESS}" "${RPC_URL}" "${PLATFORM_SIGNER_ADDRESS}" "${STATE_PATH}"

echo "[deploy] CONTRACT_ADDRESS=${CONTRACT_ADDRESS}"
echo "[deploy] wrote ${STATE_PATH}"
