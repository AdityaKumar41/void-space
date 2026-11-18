/**
 * Anchors a SkillCredential verification hash on-chain when CREDENTIAL_CONTRACT_ADDRESS is set.
 * Without a contract, marks the credential `skipped` so the DB hash remains the authority.
 */
import { recordAudit, withTenant } from '@void-space/db';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Hex,
  type Abi,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil, avalancheFuji } from 'viem/chains';

import {
  attemptOf,
  createJobContext,
  isTerminalFailure,
  type JobPayload,
} from '../lib/job-tracking';

const MINT_ABI = [
  {
    type: 'event',
    name: 'CredentialMinted',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'credentialId', type: 'string', indexed: false },
      { name: 'verificationHash', type: 'string', indexed: false },
      { name: 'lessonId', type: 'string', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'mintCredential',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'credentialId', type: 'string' },
      { name: 'verificationHash', type: 'string' },
      { name: 'lessonId', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const satisfies Abi;

export function mintedCredentialTokenId(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
  contractAddress: string,
  credentialId: string,
): bigint {
  if (receipt.status !== 'success') throw new Error('Credential mint transaction reverted');
  const events = parseEventLogs({
    abi: MINT_ABI,
    eventName: 'CredentialMinted',
    logs: receipt.logs,
  });
  const event = events.find(
    (entry) =>
      entry.address.toLowerCase() === contractAddress.toLowerCase() &&
      entry.args.credentialId === credentialId,
  );
  if (!event) throw new Error('Mint receipt has no matching CredentialMinted event');
  return event.args.tokenId;
}

export interface SkillCredentialDeps {
  readonly logger: Logger;
  readonly rpcUrl: string;
  readonly chainId?: number;
  readonly contractAddress?: string;
  readonly privateKey?: string;
}

interface Payload extends JobPayload {
  readonly credentialId?: string;
  readonly lessonId?: string;
}

export function createSkillCredentialProcessor(deps: SkillCredentialDeps) {
  return async function processSkillCredential(
    job: Job<Payload>,
  ): Promise<Record<string, unknown>> {
    const tenantId = String(job.data.tenantId ?? '');
    const credentialId = String(job.data.credentialId ?? '');
    const ctx = createJobContext({
      jobId: String(job.id),
      tenantId,
      queue: 'skill-credential',
      payload: job.data,
      attempt: attemptOf(job),
      maxAttempts: job.opts.attempts ?? 1,
    });

    await ctx.markActive();
    try {
      if (!credentialId) throw new Error('skill-credential job missing credentialId');
      if (!deps.contractAddress || !deps.privateKey) {
        await withTenant(tenantId, async (db) => {
          await db.skillCredential.updateMany({
            where: { id: credentialId, tenantId },
            data: {
              mintStatus: 'skipped',
              mintError: 'CREDENTIAL_CONTRACT_ADDRESS / signer not configured',
            },
          });
        });
        const result = { skipped: true as const };
        await ctx.succeed(result);
        return result;
      }

      const credential = await withTenant(tenantId, (db) =>
        db.skillCredential.findFirst({
          where: { id: credentialId, tenantId },
          include: {
            learner: { select: { walletAddress: true, id: true } },
            attempt: { select: { lessonId: true } },
          },
        }),
      );
      if (!credential) throw new Error('Credential not found');
      if (credential.mintStatus === 'minted' && credential.tokenId !== null && credential.txHash) {
        const result = { txHash: credential.txHash, tokenId: credential.tokenId.toString() };
        await ctx.succeed(result);
        return result;
      }
      if (!credential.learner.walletAddress)
        throw new Error('The learner must link a wallet before this credential can be minted');

      const account = privateKeyToAccount(deps.privateKey as Hex);
      const recipient = credential.learner.walletAddress as Hex;
      const chain = deps.chainId === 43113 ? avalancheFuji : anvil;
      const transport = http(deps.rpcUrl);
      const wallet = createWalletClient({ account, chain, transport });
      const publicClient = createPublicClient({ chain, transport });

      const hash = await wallet.writeContract({
        address: deps.contractAddress as Hex,
        abi: MINT_ABI,
        functionName: 'mintCredential',
        args: [recipient, credentialId, credential.verificationHash, credential.attempt.lessonId],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const tokenId = mintedCredentialTokenId(receipt, deps.contractAddress, credentialId);

      await withTenant(tenantId, async (db) => {
        await db.skillCredential.update({
          where: { id: credentialId },
          data: {
            mintStatus: 'minted',
            tokenId,
            contractAddress: deps.contractAddress,
            txHash: hash,
            mintedAt: new Date(),
            mintError: null,
          },
        });
        await recordAudit(
          {
            action: 'learning.credential_minted',
            entityType: 'skill_credential',
            entityId: credentialId,
            afterState: { txHash: hash, tokenId: tokenId.toString() },
          },
          db,
        );
      });

      const result = { txHash: hash, tokenId: tokenId.toString() };
      await ctx.succeed(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'mint failed';
      deps.logger.error({ err: error, credentialId }, 'skill-credential mint failed');
      try {
        await withTenant(tenantId, async (db) => {
          await db.skillCredential.updateMany({
            where: { id: credentialId, tenantId },
            data: { mintStatus: 'failed', mintError: message.slice(0, 500) },
          });
        });
      } catch (bookkeepingError) {
        deps.logger.error(
          { err: bookkeepingError, credentialId },
          'could not record credential failure',
        );
      }
      await ctx.fail(error, isTerminalFailure(error, ctx));
      throw error;
    }
  };
}
