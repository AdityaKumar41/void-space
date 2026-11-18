import { describe, expect, it } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  toHex,
  type TransactionReceipt,
} from 'viem';
import { mintedCredentialTokenId } from '../src/processors/skill-credential';

const address = '0x1111111111111111111111111111111111111111';
const abi = parseAbi([
  'event CredentialMinted(uint256 indexed tokenId, string credentialId, string verificationHash, string lessonId, uint64 timestamp)',
]);
function mintLog(
  tokenId: bigint,
  credentialId = 'credential-42',
): TransactionReceipt['logs'][number] {
  return {
    address,
    topics: [
      encodeEventTopics({ abi, eventName: 'CredentialMinted' })[0],
      toHex(tokenId, { size: 32 }),
    ],
    data: encodeAbiParameters(
      [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'uint64' }],
      [credentialId, 'hash', 'lesson', 42n],
    ),
    blockHash: '0x01',
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: '0x02',
    transactionIndex: 0,
    removed: false,
  };
}
describe('credential mint evidence', () => {
  it('reads the token id from the matching contract event, not transaction order', () => {
    expect(
      mintedCredentialTokenId(
        { status: 'success', logs: [mintLog(7n, 'other'), mintLog(42n)] },
        address,
        'credential-42',
      ),
    ).toBe(42n);
  });
  it('rejects reverted receipts', () => {
    expect(() =>
      mintedCredentialTokenId({ status: 'reverted', logs: [] }, address, 'credential-42'),
    ).toThrow('reverted');
  });
  it('rejects logs emitted by another contract', () => {
    expect(() =>
      mintedCredentialTokenId(
        { status: 'success', logs: [mintLog(42n)] },
        '0x2222222222222222222222222222222222222222',
        'credential-42',
      ),
    ).toThrow('no matching');
  });
});
