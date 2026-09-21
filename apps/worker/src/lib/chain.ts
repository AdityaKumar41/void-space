/**
 * Chain client for the licensing contract (SRS §3.9.2, §3.9.3).
 *
 * Wraps viem so the processors stay about business rules: this module knows how to sign a
 * `mintLicense` / `revokeLicense` transaction and how to read a licence back, and nothing
 * about assets or review.
 *
 * The signing key is the platform publisher account (Anvil account #0 locally, supplied as
 * PLATFORM_SIGNER_SEED). It is only ever read here, never logged, and never sent to the API
 * process — minting is a worker responsibility.
 */
import { ASSET_LICENSE_REGISTRY_ABI } from '@void-space/types';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

/** The contract's `LicenseRecord` struct as returned by `getLicense`. */
export interface OnChainLicense {
  readonly assetId: string;
  readonly ipfsCid: string;
  readonly licenseTermsHash: `0x${string}`;
  readonly mintedAt: bigint;
  readonly revoked: boolean;
  readonly revokedReason: string;
}

export interface MintParams {
  readonly assetId: string;
  readonly ipfsCid: string;
  readonly licenseTermsHash: `0x${string}`;
  /** §3.9.3 — defaults to the publisher when no external recipient was requested. */
  readonly recipient?: string | undefined;
}

export interface MintResult {
  readonly tokenId: bigint;
  readonly txHash: Hash;
  readonly blockNumber: bigint;
  readonly gasUsed: bigint;
  readonly recipient: Address;
}

export interface ChainClient {
  readonly contractAddress: Address;
  readonly publisher: Address;
  mint(params: MintParams): Promise<MintResult>;
  revoke(tokenId: bigint, reason: string): Promise<{ txHash: Hash; blockNumber: bigint; gasUsed: bigint }>;
  setMetadataCid(tokenId: bigint, cid: string): Promise<{ txHash: Hash }>;
  getLicense(tokenId: bigint): Promise<OnChainLicense | null>;
  totalMinted(): Promise<bigint>;
  /**
   * Finds an existing token for an asset id by scanning the most recent tokens.
   *
   * The chain is the only place that knows a mint succeeded, so a retry after a crash
   * between the transaction and the database write must ask it — otherwise the asset ends
   * up with two licence tokens, and a duplicate licence is worse than a slow one.
   */
  findTokenForAsset(assetId: string, lookback?: number): Promise<bigint | null>;
}

export interface ChainClientOptions {
  readonly rpcUrl: string;
  readonly contractAddress: string;
  readonly privateKey: string;
}

const ABI = ASSET_LICENSE_REGISTRY_ABI as never;

export function createChainClient(options: ChainClientOptions): ChainClient {
  const account = privateKeyToAccount(
    (options.privateKey.startsWith('0x') ? options.privateKey : `0x${options.privateKey}`) as `0x${string}`,
  );
  const contractAddress = options.contractAddress as Address;

  const publicClient = createPublicClient({ chain: foundry, transport: http(options.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(options.rpcUrl),
  });

  async function totalMinted(): Promise<bigint> {
    return (await publicClient.readContract({
      address: contractAddress,
      abi: ABI,
      functionName: 'totalMinted',
    })) as bigint;
  }

  return {
    contractAddress,
    publisher: account.address,

    async mint(params) {
      const recipient = (params.recipient ?? account.address) as Address;

      // `simulateContract` runs the call against current state first, so a revert (e.g. a
      // duplicate asset id) surfaces as a clear error instead of a burned transaction.
      const { request } = await publicClient.simulateContract({
        account,
        address: contractAddress,
        abi: ABI,
        functionName: 'mintLicense',
        // Contract order is (to, assetId, ipfsCid, licenseTermsHash) — the recipient comes
        // first. Passing the UUID asset id into `to` is how the worker surfaced this.
        args: [recipient, params.assetId, params.ipfsCid, params.licenseTermsHash],
      });

      const txHash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== 'success') {
        throw new Error(`mintLicense reverted in block ${receipt.blockNumber} (tx ${txHash})`);
      }

      // The contract's token counter is 1-based, so the total after the transaction is the
      // id that was just minted — cheaper than decoding event topics by hand.
      const tokenId = await totalMinted();

      return {
        tokenId,
        txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        recipient,
      };
    },

    async revoke(tokenId, reason) {
      const { request } = await publicClient.simulateContract({
        account,
        address: contractAddress,
        abi: ABI,
        functionName: 'revokeLicense',
        args: [tokenId, reason],
      });

      const txHash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        throw new Error(`revokeLicense reverted in block ${receipt.blockNumber} (tx ${txHash})`);
      }

      return { txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
    },

    async setMetadataCid(tokenId, cid) {
      const { request } = await publicClient.simulateContract({
        account,
        address: contractAddress,
        abi: ABI,
        functionName: 'setLicenseMetadataCid',
        args: [tokenId, cid],
      });
      const txHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return { txHash };
    },

    async getLicense(tokenId) {
      try {
        const record = (await publicClient.readContract({
          address: contractAddress,
          abi: ABI,
          functionName: 'getLicense',
          args: [tokenId],
        })) as OnChainLicense;
        return record;
      } catch {
        return null;
      }
    },

    totalMinted,

    async findTokenForAsset(assetId, lookback = 250) {
      const total = await totalMinted();
      if (total === 0n) return null;

      const oldest = total - BigInt(lookback) + 1n > 1n ? total - BigInt(lookback) + 1n : 1n;
      for (let tokenId = total; tokenId >= oldest; tokenId -= 1n) {
        const record = await this.getLicense(tokenId);
        if (record && record.assetId === assetId) return tokenId;
      }
      return null;
    },
  };
}
