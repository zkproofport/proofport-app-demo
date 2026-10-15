'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, TypedDataEncoder, isAddress, type Eip1193Provider } from 'ethers';
import { ProofportSDK, type RelayProofResult } from '@zkproofport-app/sdk';
import { GIWA_CHAIN_ID } from './giwa-membership';
import { createSDK } from './sdk';
import { EXPLORER, GIWA_RPC, guardGiwaWalletProvider, waitForVaultReceipt } from './giwa-vault';
import { DEMO_PROOF_WAIT_MS, describeFailure, isPendingRelayStatus, settleRelayResult } from './relay-outcome';
import {
  SSIAT_CIRCUIT, SSIAT_DROP_ABI, SSIAT_PROOF_ERRORS, SSIAT_SCOPE_PATTERN, buildSsiatClaimAction, expectedSsiatScope,
  prepareSsiatClaimProof, ssiatDropAddress, ssiatErrorMessage, ssiatErrorName, type SsiatClaimProof,
} from './ssiat-drop';

type WalletProvider = Eip1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void };

/**
 * Where a claim stands.
 *
 * `ended` is a request the app declined or let expire: neutral, with Try again.
 * `already-claimed` and `exhausted` are answers from the contract, not errors.
 */
export type SsiatPhase =
  | 'idle' | 'requesting' | 'waiting' | 'verifying' | 'ready' | 'claiming'
  | 'claimed' | 'already-claimed' | 'exhausted' | 'ended' | 'blocked';
/** A checked proof, with the claim amount read when it was requested (immutable in the contract). */
export type BoundClaim = SsiatClaimProof & { amount: bigint };
export type SsiatDropInfo = { token: string; claimAmount: bigint; remaining: bigint; totalClaims: bigint; recipientBalance: bigint | null };

const REFRESH_AFTER_CLAIM_ATTEMPTS = 15;
const REFRESH_AFTER_CLAIM_DELAY_MS = 1000;
const STALE_WALLET = 'Wallet or network changed. Reconnect the recipient wallet and generate a new proof.';
const BUSY: readonly SsiatPhase[] = ['requesting', 'waiting', 'verifying', 'claiming'];
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)'];
const injected = () => (window as Window & { ethereum?: WalletProvider }).ethereum;
const timeout = async <T,>(promise: Promise<T>, ms = 30000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The request timed out. Please try again.')), ms); })]); }
  finally { clearTimeout(timer); }
};

/** The configured drop, or null with the reason; the tab renders a notice instead of guessing an address. */
function configuredDrop(): { address: string; error: '' } | { address: null; error: string } {
  try { return { address: ssiatDropAddress(), error: '' }; }
  catch (cause) { return { address: null, error: (cause as Error).message }; }
}

export function useSsiatDrop() {
  const [account, setAccount] = useState('');
  const [phase, setPhase] = useState<SsiatPhase>('idle');
  const [info, setInfo] = useState<SsiatDropInfo | null>(null);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [proof, setProof] = useState<BoundClaim | null>(null);
  const [txHash, setTxHash] = useState('');
  const [receipt, setReceipt] = useState<{ hash: string; amount: bigint; recipient: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const drop = configuredDrop();
  const sdk = useRef<ProofportSDK | null>(null);
  const rpc = useRef<JsonRpcProvider | null>(null);
  const version = useRef(0);
  const locked = useRef(false);
  const walletBusy = useRef(false);
  const readVersion = useRef(0);
  const walletVersion = useRef(0);
  const readProvider = useCallback(() => {
    if (!rpc.current) rpc.current = new JsonRpcProvider(GIWA_RPC, GIWA_CHAIN_ID, { staticNetwork: true, cacheTimeout: -1 });
    return rpc.current;
  }, []);
  const contract = (address: string) => new Contract(address, SSIAT_DROP_ABI, readProvider());

  /**
   * Reads every figure at one block. `atLeastBlock` is the claim's own block:
   * the public GIWA RPC answers from several servers and some trail the chain,
   * so a plain "latest" read right after a claim can come from before it and
   * show the old figures. Then it waits for a server that has the block.
   */
  const refresh = useCallback(async (atLeastBlock?: number) => {
    const current = ++readVersion.current;
    const recipient = account;
    let address: string;
    try { address = ssiatDropAddress(); } catch { return; }
    for (let attempt = 1; ; attempt++) {
      try {
        const blockTag = await timeout(readProvider().getBlockNumber());
        if (atLeastBlock !== undefined && blockTag < atLeastBlock) throw new Error(`The RPC is at block ${blockTag}, before the claim's block ${atLeastBlock}.`);
        const reader = new Contract(address, SSIAT_DROP_ABI, readProvider());
        const [token, claimAmount, remaining, totalClaims] = await timeout(Promise.all([
          reader.token({ blockTag }), reader.CLAIM_AMOUNT({ blockTag }), reader.remaining({ blockTag }), reader.totalClaims({ blockTag }),
        ]));
        const recipientBalance = recipient && isAddress(token)
          ? await timeout(new Contract(token, TOKEN_ABI, readProvider()).balanceOf(recipient, { blockTag })) as bigint : null;
        if (current !== readVersion.current) return;
        setInfo({ token, claimAmount, remaining, totalClaims, recipientBalance }); setReadError('');
        return;
      } catch {
        if (current !== readVersion.current) return;
        if (atLeastBlock === undefined || attempt >= REFRESH_AFTER_CLAIM_ATTEMPTS) {
          setReadError('Live drop figures are unavailable. Retry before claiming.');
          return;
        }
        await new Promise(resolve => setTimeout(resolve, REFRESH_AFTER_CLAIM_DELAY_MS));
        if (current !== readVersion.current) return;
      }
    }
  }, [account, readProvider]);

  function reset() {
    version.current++; locked.current = false;
    sdk.current?.disconnect(); sdk.current = null;
    setProof(null); setReceipt(null); setQr(''); setDeepLink(''); setError(''); setNotice(''); setPhase('idle'); setTxHash('');
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => { clearInterval(timer); readVersion.current++; };
  }, [refresh]);
  useEffect(() => {
    const provider = injected();
    const changed = () => {
      // The proof is bound to the connected recipient; a different wallet or chain voids it.
      walletVersion.current++; reset(); setAccount('');
      setError(STALE_WALLET);
    };
    provider?.on?.('accountsChanged', changed); provider?.on?.('chainChanged', changed);
    return () => { provider?.removeListener?.('accountsChanged', changed); provider?.removeListener?.('chainChanged', changed); version.current++; sdk.current?.disconnect(); rpc.current?.destroy(); rpc.current = null; };
  }, []);

  async function connect() {
    if (walletBusy.current || locked.current) return;
    walletBusy.current = true; setConnecting(true); setError('');
    try {
      const provider = injected();
      if (!provider) throw new Error('Open this page in a browser with an Ethereum wallet, such as MetaMask.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
      if (!accounts[0] || !isAddress(accounts[0])) throw new Error('Select an Ethereum account in your wallet.');
      const chainId = '0x' + GIWA_CHAIN_ID.toString(16);
      if (Number(await provider.request({ method: 'eth_chainId' })) !== GIWA_CHAIN_ID) {
        try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
        catch (cause) {
          if ((cause as { code?: number }).code !== 4902) throw cause;
          await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: 'GIWA Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [GIWA_RPC], blockExplorerUrls: [EXPLORER] }] });
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
        }
      }
      const connectedVersion = walletVersion.current;
      const latest = await provider.request({ method: 'eth_accounts' }) as string[];
      if (!latest[0] || !isAddress(latest[0]) || Number(await provider.request({ method: 'eth_chainId' })) !== GIWA_CHAIN_ID || connectedVersion !== walletVersion.current) throw new Error('Reconnect your wallet on GIWA Sepolia.');
      reset(); setAccount(latest[0]);
    } catch (cause) { setError(ssiatErrorMessage(cause)); }
    finally { walletBusy.current = false; setConnecting(false); }
  }

  async function requestProof() {
    if (locked.current || walletBusy.current) return;
    if (!account) { setError('Connect the wallet that should receive the seeds first.'); return; }
    locked.current = true; const current = ++version.current;
    setError(''); setNotice(''); setProof(null); setReceipt(null); setPhase('requesting'); setTxHash('');
    let client: ProofportSDK | undefined;
    try {
      const address = ssiatDropAddress();
      const recipient = account;
      const reader = contract(address);
      const blockTag = await timeout(readProvider().getBlockNumber());
      const [scope, domainHash, actionHash, remaining, claimAmount] = await timeout(Promise.all([
        reader.claimScope({ blockTag }), reader.domainSeparator({ blockTag }), reader.claimActionHash(recipient, { blockTag }),
        reader.remaining({ blockTag }), reader.CLAIM_AMOUNT({ blockTag }),
      ]));
      if (current !== version.current) return;
      const action = buildSsiatClaimAction(recipient, address);
      if (typeof scope !== 'string' || !SSIAT_SCOPE_PATTERN.test(scope) || scope !== expectedSsiatScope(address) ||
          TypedDataEncoder.hashDomain(action.domain) !== domainHash ||
          TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message) !== actionHash) {
        throw new Error('The configured drop contract is not the Ssiat drop this page expects. Please reload the demo.');
      }
      if (remaining < claimAmount) { setPhase('exhausted'); return; }
      // The browser calls the relay directly, as any dApp does. createSDK's random key
      // authenticates only the relay request. The phone's faucet wallet signs
      // Claim(recipient); the connected recipient wallet sends the claim transaction.
      client = createSDK();
      sdk.current = client;
      const pending = await timeout(client.createRelayRequest(SSIAT_CIRCUIT, { scope, action }, {
        dappName: 'Ssiat', dappIcon: `${window.location.origin}/brand/ssiat-app-icon.png`,
        message: 'Claim Ssiat test seeds for the wallet you connected. Sign with the wallet you used on the GIWA Playground faucet.',
      }));
      if (current !== version.current) return;
      if (!pending.requestId || !pending.deepLink) throw new Error('The proof request is incomplete. Please try again.');
      const image = await client.generateQRCode(pending.deepLink, { width: 1080 });
      if (current !== version.current) return;
      setQr(image); setDeepLink(pending.deepLink); setPhase('waiting');
      // Every status that is not pending ends the wait; settleRelayResult refuses one it does not know.
      let result: RelayProofResult | undefined;
      const expires = Date.now() + DEMO_PROOF_WAIT_MS;
      while (current === version.current && Date.now() < expires) {
        const update = await timeout(client.pollResult(pending.requestId));
        if (!isPendingRelayStatus(update.status)) { result = update; break; }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (current !== version.current) return;
      if (!result) throw new Error('No answer came back from the relay. Please generate a new proof.');
      const outcome = settleRelayResult(result);
      if (outcome.kind === 'cancelled' || outcome.kind === 'expired') {
        setQr(''); setDeepLink(''); setNotice(outcome.message); setPhase('ended'); return;
      }
      if (outcome.kind !== 'proof') throw new Error(describeFailure(outcome));
      const bound = prepareSsiatClaimProof(outcome.result, pending.requestId, scope, action);
      setQr(''); setDeepLink(''); setPhase('verifying');
      const reread = contract(address);
      if (await timeout(reread.claimed(bound.nullifier))) {
        if (current === version.current) setPhase('already-claimed');
        return;
      }
      if (current !== version.current) return;
      const accepted = await timeout(reread.verifyClaim(recipient, bound.proof, bound.publicInputs));
      if (current !== version.current) return;
      if (accepted !== true) throw new Error('The drop did not accept this proof.');
      setProof({ ...bound, amount: claimAmount }); setPhase('ready');
    } catch (cause) {
      if (current !== version.current) return;
      setQr(''); setDeepLink('');
      const name = ssiatErrorName(cause);
      if (name === 'AlreadyClaimed') setPhase('already-claimed');
      else if (name === 'DropExhausted') setPhase('exhausted');
      else { setError(ssiatErrorMessage(cause)); setPhase('blocked'); }
    } finally { client?.disconnect(); if (current === version.current) locked.current = false; }
  }

  async function claim() {
    if (locked.current || !account || !proof) return;
    if (proof.recipient.toLowerCase() !== account.toLowerCase()) {
      setProof(null); setPhase('blocked');
      setError('This proof names a different recipient. Generate a new proof for the connected wallet.');
      return;
    }
    locked.current = true; const current = ++version.current;
    const connectedVersion = walletVersion.current;
    const isCurrent = () => current === version.current && connectedVersion === walletVersion.current;
    const bound = proof;
    setError(''); setTxHash(''); setPhase('claiming');
    try {
      const address = ssiatDropAddress();
      const provider = injected();
      if (!provider) throw new Error('Connect the recipient wallet first.');
      const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
      if (accounts[0]?.toLowerCase() !== account.toLowerCase() || Number(await provider.request({ method: 'eth_chainId' })) !== GIWA_CHAIN_ID) {
        throw new Error('Reconnect the recipient wallet on GIWA Sepolia.');
      }
      if (!isCurrent()) return;
      const signer = await new BrowserProvider(guardGiwaWalletProvider(provider, isCurrent, STALE_WALLET)).getSigner(account);
      if (!isCurrent()) return;
      const writable = new Contract(address, SSIAT_DROP_ABI, signer);
      const tx = await writable.claim(account, bound.proof, bound.publicInputs, { chainId: GIWA_CHAIN_ID });
      if (isCurrent()) setTxHash(tx.hash);
      const confirmed = await waitForVaultReceipt(tx, hash => { if (isCurrent()) setTxHash(hash); });
      if (!isCurrent()) return;
      setTxHash(confirmed.hash);
      setReceipt({ hash: confirmed.hash, amount: bound.amount, recipient: bound.recipient });
      setProof(null); setPhase('claimed');
      await refresh(confirmed.blockNumber);
    } catch (cause) {
      if (!isCurrent()) return;
      const name = ssiatErrorName(cause);
      if (name === 'AlreadyClaimed') { setProof(null); setPhase('already-claimed'); return; }
      if (name === 'DropExhausted') { setProof(null); setPhase('exhausted'); return; }
      const invalid = SSIAT_PROOF_ERRORS.includes(name ?? '');
      if (invalid) setProof(null);
      setError(ssiatErrorMessage(cause));
      setPhase(invalid ? 'blocked' : 'ready');
    } finally { if (isCurrent()) locked.current = false; }
  }

  return {
    account, phase, info, readError, error, notice, qr, deepLink, proof, txHash, receipt, connecting,
    dropAddress: drop.address, configError: drop.error, busy: BUSY.includes(phase),
    connect, refresh, requestProof, claim, reset,
  };
}
