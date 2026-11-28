/**
 * Browser SIWE helper (EIP-4361). Uses window.ethereum when present — no wallet-adapter bundle.
 */
import { apiFetch } from './api';
import type { Membership } from './session-types';

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

function getEthereum(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return eth ?? null;
}

export interface SiweLoginResult {
  readonly user?: { readonly tenants: readonly Membership[] };
  readonly requiresTenantSelection?: boolean;
  readonly tenants?: readonly Membership[];
}

export async function signInWithEthereum(): Promise<SiweLoginResult> {
  const ethereum = getEthereum();
  if (!ethereum) {
    throw new Error('No browser wallet found. Install MetaMask or another EIP-1193 wallet.');
  }

  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];
  if (!address) throw new Error('Wallet did not return an account.');

  const challenge = await apiFetch<{ message: string; nonce: string }>('/auth/siwe/nonce', {
    method: 'POST',
    body: { address },
    skipRefresh: true,
  });

  const signature = (await ethereum.request({
    method: 'personal_sign',
    params: [challenge.message, address],
  })) as string;

  return apiFetch<SiweLoginResult>('/auth/siwe/verify', {
    method: 'POST',
    body: { message: challenge.message, signature },
    skipRefresh: true,
  });
}
