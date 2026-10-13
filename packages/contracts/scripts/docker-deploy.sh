#!/usr/bin/env bash
#
# Deploy AssetLicenseRegistry.sol to Sepolia and publish the
# resulting address + ABI where api and worker can read them (SRS §9.3).
#
# Runs from a host with a native Foundry install:
#   CHAIN_RPC_URL=https://... PLATFORM_SIGNER_SEED=0x... \
#     bash packages/contracts/scripts/docker-deploy.sh
set -euo pipefail

# Host deployments load the repository environment here because pnpm does not export `.env` values
# into child shell processes. The file is intentionally optional so CI can provide explicit env vars.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT_DIR}/.env"
  set +a
fi

RPC_URL="${CHAIN_RPC_URL:-}"
STATE_PATH="${CONTRACT_STATE_PATH:-packages/contracts/.contracts-state.json}"

if [ -z "${RPC_URL}" ]; then
  echo "[deploy] ERROR: CHAIN_RPC_URL is required (expected a Sepolia RPC URL)" >&2
  exit 1
fi

if [ -z "${PLATFORM_SIGNER_SEED:-}" ]; then
  echo "[deploy] ERROR: PLATFORM_SIGNER_SEED is required for Sepolia deployment" >&2
  exit 1
fi

echo "[deploy] checking Sepolia RPC at ${RPC_URL}"
for _ in $(seq 1 60); do
  if cast block-number --rpc-url "${RPC_URL}" >/dev/null 2>&1; then
    echo "[deploy] Sepolia RPC is ready"
    break
  fi
  sleep 1
done
cast block-number --rpc-url "${RPC_URL}" >/dev/null

NETWORK_CHAIN_ID="$(cast chain-id --rpc-url "${RPC_URL}")"
if [ "${NETWORK_CHAIN_ID}" != "11155111" ]; then
  echo "[deploy] ERROR: refusing to deploy — RPC chain id is ${NETWORK_CHAIN_ID}, expected Sepolia (11155111)" >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The chain id decides which broadcast log to read. Pinning it beats globbing
# `*/run-latest.json`, which would silently pick an arbitrary chain's log once a
# developer has deployed against more than one.
CHAIN_ID=11155111
BROADCAST_LOG="broadcast/Deploy.s.sol/${CHAIN_ID}/run-latest.json"

DEPLOYER_KEY="${PLATFORM_SIGNER_SEED}"
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

CONTRACT_ADDRESS="$(node -e '
  // Parsed with node rather than jq: the foundry image does not ship jq, so the
  // original `jq -r … || true` produced an empty string on every run and the script
  // exited 1 *after* a successful deployment — a failed deploy that had actually
  // worked, which is the most confusing possible outcome.
  const fs = require("fs");
  const log = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  // The last CREATE that carries an address: a script may deploy more than one
  // contract, and the registry is not guaranteed to be first forever.
  const creates = (log.transactions || []).filter((tx) => tx.contractAddress);
  const last = creates[creates.length - 1];
  process.stdout.write(last ? last.contractAddress : "");
' "${BROADCAST_LOG}" 2>/dev/null || true)"

if [ -z "${CONTRACT_ADDRESS}" ] || [ "${CONTRACT_ADDRESS}" = "null" ]; then
  echo "[deploy] ERROR: could not read the deployed address from ${BROADCAST_LOG}" >&2
  echo "[deploy]        The transaction may still have succeeded — check ${BROADCAST_LOG}" >&2
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
  chainId: Number(process.env.CHAIN_ID || 11155111),
  rpcUrl: process.argv[2],
  publisherAddress: process.argv[3],
  deployedAt: new Date().toISOString(),
};
fs.writeFileSync(process.argv[4], JSON.stringify(state, null, 2) + "\n");
' "${CONTRACT_ADDRESS}" "${RPC_URL}" "${PLATFORM_SIGNER_ADDRESS}" "${STATE_PATH}"

if [ -f "${ROOT_DIR}/.env" ]; then
  TMP_ENV="$(mktemp)"
  awk -v address="${CONTRACT_ADDRESS}" '
    BEGIN { updated = 0 }
    /^CONTRACT_ADDRESS=/ { print "CONTRACT_ADDRESS=" address; updated = 1; next }
    { print }
    END { if (!updated) print "CONTRACT_ADDRESS=" address }
  ' "${ROOT_DIR}/.env" > "${TMP_ENV}"
  mv "${TMP_ENV}" "${ROOT_DIR}/.env"
  echo "[deploy] updated ${ROOT_DIR}/.env with CONTRACT_ADDRESS=${CONTRACT_ADDRESS}"
fi

echo "[deploy] CONTRACT_ADDRESS=${CONTRACT_ADDRESS}"
echo "[deploy] wrote ${STATE_PATH}"
