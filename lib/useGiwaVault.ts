'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserProvider, Contract, JsonRpcProvider, TypedDataEncoder, Wallet, toBeHex, type Eip1193Provider } from 'ethers';
import { CIRCUIT_IDS, ProofportSDK, type ProofResponse, type RelayProofResult } from '@zkproofport-app/sdk';
import { GIWA_CHAIN_ID, prepareGiwaMembershipProof } from './giwa-membership';
import { EXPLORER, GIWA_RPC, OPERATIONAL_WALLET, TOKEN_ABI, TOKEN_ADDRESS, VAULT_ABI, VAULT_ADDRESS, buildGiwaDepositAction, guardGiwaWalletProvider, parseVaultAmount, vaultErrorMessage, vaultErrorName, waitForVaultReceipt } from './giwa-vault';

type WalletProvider = Eip1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void };
type Phase = 'idle' | 'checking' | 'blocked' | 'requesting' | 'waiting' | 'verifying' | 'ready' | 'approving' | 'depositing' | 'withdrawing' | 'success';
type BoundProof = { proof: string; publicInputs: string[]; scope: string; amount: bigint; account: string; response: ProofResponse };
type Verification = { kind: 'offchain' | 'onchain'; status: 'verifying' | 'success' | 'error'; message: string };
type Balances = { wallet: bigint; deposited: bigint; total: bigint; allowance: bigint };
const injected = () => (window as Window & { ethereum?: WalletProvider }).ethereum;
const timeout = async <T,>(promise: Promise<T>, ms = 30000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The request timed out. Please try again.')), ms); })]); }
  finally { clearTimeout(timer); }
};

export function useGiwaVault() {
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('10000');
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [phase, setPhase] = useState<Phase>('idle');
  const [balances, setBalances] = useState<Balances | null>(null);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [proof, setProof] = useState<BoundProof | null>(null);
  const [txHash, setTxHash] = useState('');
  const [receipt, setReceipt] = useState<{ hash: string; amount: bigint; action: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);
  const sdk = useRef<ProofportSDK | null>(null);
  const rpc = useRef<JsonRpcProvider | null>(null);
  const version = useRef(0);
  const locked = useRef(false);
  const walletBusy = useRef(false);
  const readVersion = useRef(0);
  const walletVersion = useRef(0);
  const writing = useRef(false);
  const verifying = useRef(false);
  const readProvider = useCallback(() => {
    if (!rpc.current) rpc.current = new JsonRpcProvider(GIWA_RPC, GIWA_CHAIN_ID, { staticNetwork: true, cacheTimeout: -1 });
    return rpc.current;
  }, []);
  const vault = () => new Contract(VAULT_ADDRESS, VAULT_ABI, readProvider());

  const refresh = useCallback(async () => {
    const current = ++readVersion.current;
    const address = account || OPERATIONAL_WALLET;
    try {
      const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, readProvider());
      const contract = new Contract(VAULT_ADDRESS, VAULT_ABI, readProvider());
      const [wallet, deposited, total, allowance] = await timeout(Promise.all([
        token.balanceOf(address), contract.balanceOf(address), contract.totalDeposits(), token.allowance(address, VAULT_ADDRESS),
      ]));
      if (current !== readVersion.current) return;
      setBalances({ wallet, deposited, total, allowance }); setReadError('');
    } catch { if (current === readVersion.current) setReadError('Live balances are unavailable. Retry before submitting a transaction.'); }
  }, [account, readProvider]);

  function reset() {
    version.current++; locked.current = false; writing.current = false; verifying.current = false;
    sdk.current?.disconnect(); sdk.current = null;
    setProof(null); setVerification(null); setQr(''); setDeepLink(''); setError(''); setPhase('idle'); setTxHash('');
  }
  useEffect(() => {
    setBalances(null); void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => { clearInterval(timer); readVersion.current++; };
  }, [refresh]);
  useEffect(() => {
    const provider = injected();
    const changed = () => {
      // The mobile proof always targets the configured wallet. A browser wallet
      // change invalidates transaction authority, not that independent proof.
      walletVersion.current++; setAccount('');
      if (writing.current) {
        writing.current = false; locked.current = false; setPhase('idle');
        setError('Wallet or network changed. Reconnect the operational wallet.');
      }
    };
    provider?.on?.('accountsChanged', changed); provider?.on?.('chainChanged', changed);
    return () => { provider?.removeListener?.('accountsChanged', changed); provider?.removeListener?.('chainChanged', changed); version.current++; sdk.current?.disconnect(); rpc.current?.destroy(); rpc.current = null; };
  }, []);

  async function connect() {
    if (walletBusy.current || locked.current || verifying.current) return;
    walletBusy.current = true; setConnecting(true); setError('');
    try {
      const provider = injected();
      if (!provider) throw new Error('Open this page in a browser with an Ethereum wallet, such as MetaMask.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
      if (accounts[0]?.toLowerCase() !== OPERATIONAL_WALLET) throw new Error('Select the configured operational wallet: ' + OPERATIONAL_WALLET);
      const chainId = '0x' + GIWA_CHAIN_ID.toString(16);
      if (Number(await provider.request({ method: 'eth_chainId' })) !== GIWA_CHAIN_ID) {
        try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
        catch (cause) {
          if ((cause as { code?: number }).code !== 4902) throw cause;
          await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: 'GIWA Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [GIWA_RPC], blockExplorerUrls: [EXPLORER] }] });
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
        }
      }
      const latest = await provider.request({ method: 'eth_accounts' }) as string[];
      if (latest[0]?.toLowerCase() !== OPERATIONAL_WALLET || Number(await provider.request({ method: 'eth_chainId' })) !== GIWA_CHAIN_ID) throw new Error('Select the operational wallet on GIWA Sepolia.');
      setAccount(latest[0]);
    } catch (cause) { setError(vaultErrorMessage(cause)); }
    finally { walletBusy.current = false; setConnecting(false); }
  }

  async function signer(isCurrent: () => boolean) {
    const provider = injected();
    if (!provider || !account) throw new Error('Connect the operational wallet first.');
    const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
    if (accounts[0]?.toLowerCase() !== OPERATIONAL_WALLET || Number(await provider.request({ method: 'eth_chainId' })) !== GIWA_CHAIN_ID) throw new Error('Reconnect the operational wallet on GIWA Sepolia.');
    return new BrowserProvider(guardGiwaWalletProvider(provider, isCurrent)).getSigner(account);
  }

  async function requestProof() {
    if (locked.current || verifying.current || walletBusy.current) return;
    locked.current = true; const current = ++version.current;
    setError(''); setProof(null); setVerification(null); setPhase('requesting'); setTxHash('');
    let client: ProofportSDK | undefined;
    try {
      const units = parseVaultAmount(amount);
      const target = OPERATIONAL_WALLET;
      const contract = vault();
      const blockTag = await timeout(readProvider().getBlockNumber());
      const [scope, nonce, domainHash, actionHash] = await timeout(Promise.all([
        contract.depositScope(target, units, { blockTag }), contract.nonces(target, { blockTag }),
        contract.domainSeparator({ blockTag }), contract.depositActionHash(target, units, { blockTag }),
      ]));
      const action = buildGiwaDepositAction(target, units, nonce);
      if (TypedDataEncoder.hashDomain(action.domain) !== domainHash ||
          TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message) !== actionHash) {
        throw new Error('The configured Vault uses a different deposit action. Please reload the demo.');
      }
      if (current !== version.current) return;
      client = new ProofportSDK({ relayUrl: `${window.location.origin}/api/giwa-relay` });
      // This key authenticates only the relay request. The app's attested wallet
      // signs the deposit action; the connected operational wallet moves dKRW.
      client.setSigner(Wallet.createRandom());
      sdk.current = client;
      const pending = await timeout(client.createRelayRequest(CIRCUIT_IDS.GIWA_ATTESTATION, { scope, action }, {
        dappName: 'Gotgan', dappIcon: `${window.location.origin}/brand/gotgan-app-icon.png`,
        message: `Prove eligibility for a ${amount} dKRW deposit into Gotgan from your operational wallet.`,
      }));
      if (current !== version.current) return;
      if (!pending.requestId || !pending.deepLink) throw new Error('The proof request is incomplete. Please try again.');
      const image = await client.generateQRCode(pending.deepLink, { width: 280 });
      if (current !== version.current) return;
      setQr(image); setDeepLink(pending.deepLink); setPhase('waiting');
      // The same-origin relay adapter is HTTP-only. Poll through the SDK rather
      // than opening a Socket.IO namespace against the Next.js server.
      let result: RelayProofResult | undefined;
      const expires = Date.now() + 180000;
      while (current === version.current && Date.now() < expires) {
        const update = await timeout(client.pollResult(pending.requestId));
        if (update.status === 'completed' || update.status === 'failed') { result = update; break; }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (current !== version.current) return;
      if (!result) throw new Error('The proof request expired. Please generate a new proof.');
      const response = prepareGiwaMembershipProof(result, pending.requestId, scope, action);
      const bound: BoundProof = { proof: response.proof!, publicInputs: response.publicInputs!.map(value => toBeHex(BigInt(value), 32)), scope, amount: units, account: target, response };
      setPhase('verifying');
      const valid = await timeout(vault().verifyEligibility(target, units, bound.proof, bound.publicInputs));
      if (current !== version.current) return;
      if (!valid) throw new Error('The Vault did not accept this proof.');
      setProof(bound); setPhase('ready'); setQr(''); setDeepLink('');
    } catch (cause) { if (current === version.current) { setError(vaultErrorMessage(cause)); setPhase('blocked'); } }
    finally { client?.disconnect(); if (current === version.current) locked.current = false; }
  }

  async function verifyProof(kind: 'offchain' | 'onchain') {
    if (!proof || locked.current || verifying.current) return;
    verifying.current = true;
    const current = version.current;
    const label = kind === 'onchain' ? 'On-Chain' : 'Off-Chain';
    setVerification({ kind, status: 'verifying', message: `${label} verification in progress…` });
    try {
      const client = sdk.current;
      if (!client) throw new Error('Generate an eligibility proof first.');
      const result = await timeout(kind === 'onchain'
        ? client.verifyResponseOnChain(proof.response)
        : client.verifyResponseOffChain(proof.response), kind === 'onchain' ? 30000 : 90000);
      if (current !== version.current) return;
      if (!result.valid) throw new Error(result.error || 'The proof did not pass verification.');
      setVerification({ kind, status: 'success', message: `${label} Verification Passed!` });
    } catch (cause) {
      if (current === version.current) setVerification({ kind, status: 'error', message: vaultErrorMessage(cause) });
    } finally { if (current === version.current) verifying.current = false; }
  }

  async function act(action: 'deposit' | 'approve' | 'withdraw') {
    if (locked.current || verifying.current || !account) return;
    locked.current = true; writing.current = true; const current = ++version.current;
    const connectedVersion = walletVersion.current;
    const isCurrent = () => current === version.current && connectedVersion === walletVersion.current;
    setError(''); setTxHash(''); setPhase('checking');
    try {
      const units = parseVaultAmount(amount);
      const contract = vault();
      // A real eth_call against deposit exercises the exact missing-proof branch,
      // without prompting for or broadcasting a transaction destined to revert.
      if (action === 'deposit' && !proof) {
        await timeout(contract.deposit.staticCall(units, '0x', [], { from: account }));
        throw new Error('Unexpected Vault response. No transaction was sent.');
      }
      const connectedSigner = await signer(isCurrent);
      if (!isCurrent()) return;
      const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, connectedSigner);
      if (action !== 'withdraw') {
        const scope = await timeout(contract.depositScope(account, units));
        if (!isCurrent()) return;
        if (!proof || proof.account.toLowerCase() !== account.toLowerCase() || proof.amount !== units || scope !== proof.scope) {
          setProof(null); throw new Error('The deposit changed. Generate a new eligibility proof.');
        }
        const available: bigint = await timeout(token.balanceOf(account));
        if (available < units) throw new Error('Your operational wallet does not have enough dKRW.');
      } else if (await timeout(contract.balanceOf(account)) < units) throw new Error('The withdrawal exceeds your deposited balance.');
      if (!isCurrent()) return;
      if (action === 'deposit' && await timeout(token.allowance(account, VAULT_ADDRESS)) < units) throw new Error('Approve dKRW before depositing.');
      if (!isCurrent()) return;
      const writable = new Contract(VAULT_ADDRESS, VAULT_ABI, connectedSigner);
      setPhase(action === 'approve' ? 'approving' : action === 'deposit' ? 'depositing' : 'withdrawing');
      // Each write is a distinct user action with a wallet confirmation.
      const transaction = { chainId: GIWA_CHAIN_ID };
      const tx = action === 'approve' ? await token.approve(VAULT_ADDRESS, units, transaction)
        : action === 'deposit' ? await writable.deposit(units, proof!.proof, proof!.publicInputs, transaction)
        : await writable.withdraw(units, transaction);
      if (isCurrent()) setTxHash(tx.hash);
      const confirmed = await waitForVaultReceipt(tx, hash => {
        if (isCurrent()) setTxHash(hash);
      });
      if (!isCurrent()) return;
      setTxHash(confirmed.hash);
      if (action === 'approve') setPhase('ready');
      else { setReceipt({ hash: confirmed.hash, amount: units, action }); setProof(null); setPhase('success'); }
      await refresh();
    } catch (cause) {
      if (!isCurrent()) return;
      if (action === 'deposit' && !proof && vaultErrorName(cause) === 'ProofRequired') setPhase('blocked');
      else {
        const invalidProof = ['WrongDepositScope', 'WrongDepositDomain', 'WrongDepositAction', 'IdentityProofNotAllowed', 'InvalidProof', 'UntrustedIssuer'].includes(vaultErrorName(cause) ?? '');
        if (invalidProof) setProof(null);
        setError(vaultErrorMessage(cause)); setPhase(invalidProof ? 'blocked' : proof ? 'ready' : 'idle');
      }
    } finally { if (isCurrent()) { locked.current = false; writing.current = false; } }
  }

  const busy = verification?.status === 'verifying' || ['checking', 'requesting', 'waiting', 'verifying', 'approving', 'depositing', 'withdrawing'].includes(phase);
  let units: bigint | null = null;
  try { units = parseVaultAmount(amount); } catch { /* The form keeps editable partial input. */ }
  const approvalNeeded = !!proof && units !== null && (balances === null || balances.allowance < units);
  return { account, amount, mode, phase, balances, readError, error, qr, deepLink, proof, txHash, receipt, connecting, verification, busy, units, approvalNeeded,
    connect, refresh, requestProof, verifyProof, act, reset,
    changeAmount: (value: string) => { if (!locked.current) { reset(); setAmount(value); } },
    changeMode: (value: 'deposit' | 'withdraw') => { if (!locked.current) { reset(); setMode(value); } },
  };
}
