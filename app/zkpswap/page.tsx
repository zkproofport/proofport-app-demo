'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createSDK } from '@/lib/sdk';
import type { ProofportSDK as ProofportSDKType, AuthToken, RelayProofResult } from '@zkproofport-app/sdk';
import { ethers } from 'ethers';

// ========== TYPES ==========

interface TokenData {
  symbol: string;
  name: string;
  color: string;
  price: number;
  balance: number;
}

interface LogEntry {
  time: string;
  tag: string;
  message: string;
}

// ========== CONSTANTS ==========

const KYC_THRESHOLD = 5;

const INITIAL_TOKENS: Record<string, TokenData> = {
  ETH:  { symbol: 'ETH',  name: 'Ethereum',    color: '#627EEA', price: 2164.82, balance: 12.5000 },
  USDC: { symbol: 'USDC', name: 'USD Coin',    color: '#2775CA', price: 1.00,    balance: 12500.00 },
  WBTC: { symbol: 'WBTC', name: 'Wrapped BTC', color: '#F7931A', price: 43250.00, balance: 0.5200 },
  DAI:  { symbol: 'DAI',  name: 'Dai',         color: '#F5AC37', price: 1.00,    balance: 8750.00 },
};

// ========== UTILITY FUNCTIONS ==========

function generateRandomAddress(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateRandomTxHash(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function shortenAddress(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatNumber(num: number, decimals = 2): string {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCompact(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (num >= 1) return num.toFixed(4);
  if (num > 0) return num.toFixed(6);
  return '0';
}

function getAvatarColor(addr: string): string {
  if (!addr) return '#6366f1';
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = addr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 65%, 55%)`;
}

function timeString(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function syntaxHighlightJson(json: string): string {
  return json.replace(/("[\w]+")(\s*:\s*)/g, '<span style="color:#818cf8">$1</span>$2')
             .replace(/:\s*(".*?")/g, ': <span style="color:#22c55e">$1</span>')
             .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color:#f59e0b">$1</span>')
             .replace(/:\s*(true|false|null)/g, ': <span style="color:#f472b6">$1</span>');
}

// ========== CSS VARIABLES (as JS object for inline styles) ==========

const V = {
  bgDeep: '#131318',
  bgCard: '#1c1c24',
  bgInput: '#2a2a35',
  bgInputHover: '#32323f',
  accent: '#6366f1',
  accentHover: '#818cf8',
  accentGlow: 'rgba(99, 102, 241, 0.15)',
  accentGlowStrong: 'rgba(99, 102, 241, 0.25)',
  success: '#22c55e',
  successDim: 'rgba(34, 197, 94, 0.12)',
  warning: '#f59e0b',
  warningDim: 'rgba(245, 158, 11, 0.12)',
  error: '#ef4444',
  errorDim: 'rgba(239, 68, 68, 0.12)',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  border: 'rgba(255, 255, 255, 0.08)',
  borderHover: 'rgba(255, 255, 255, 0.14)',
  shield: '#10b981',
  shieldDim: 'rgba(16, 185, 129, 0.12)',
  fontSans: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', monospace",
  radiusSm: '8px',
  radiusMd: '12px',
  radiusLg: '16px',
  radiusXl: '20px',
  radiusFull: '9999px',
  shadowCard: '0 4px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.08)',
  shadowModal: '0 24px 80px rgba(0, 0, 0, 0.6)',
  transitionFast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  transitionBase: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
  transitionSlow: '400ms cubic-bezier(0.4, 0, 0.2, 1)',
};

// ========== COMPONENT ==========

export default function ZKPSwapPage() {
  // SDK ref
  const sdkRef = useRef<ProofportSDKType | null>(null);

  // Wallet state
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  // KYC state
  const [kycVerified, setKycVerified] = useState(false);
  const [kycVerifiedAt, setKycVerifiedAt] = useState<number | null>(null);

  // Token state
  const [tokens, setTokens] = useState<Record<string, TokenData>>(INITIAL_TOKENS);
  const [fromToken, setFromToken] = useState('ETH');
  const [toToken, setToToken] = useState('USDC');
  const [fromAmount, setFromAmount] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [customSlippage, setCustomSlippage] = useState('');

  // Settings popover
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Token select modal
  const [tokenSelectOpen, setTokenSelectOpen] = useState(false);
  const [tokenSelectSide, setTokenSelectSide] = useState<'from' | 'to'>('from');

  // KYC modal
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [kycQrDataUrl, setKycQrDataUrl] = useState('');
  const [kycStatus, setKycStatus] = useState<'waiting' | 'verifying' | 'verified' | 'error' | 'cancelled'>('waiting');
  const [kycStatusText, setKycStatusText] = useState('');
  const [kycShieldAnimating, setKycShieldAnimating] = useState(true);

  // Success modal
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [successSubtitle, setSuccessSubtitle] = useState('');
  const [successDetails, setSuccessDetails] = useState<Array<{ label: string; value: string; color?: string; copyValue?: string }>>([]);
  const [successTxHash, setSuccessTxHash] = useState('');

  // Swap button state
  const [swapLoading, setSwapLoading] = useState(false);

  // Auth state
  const [jwtToken, setJwtToken] = useState('');
  const [authClientId, setAuthClientId] = useState('');
  const [manualAuthVisible, setManualAuthVisible] = useState(false);
  const [authInputClientId, setAuthInputClientId] = useState('');
  const [authInputApiKey, setAuthInputApiKey] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [authBtnDisabled, setAuthBtnDisabled] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  // Dev panel
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [devActiveTab, setDevActiveTab] = useState('logs');
  const [devLogs, setDevLogs] = useState<LogEntry[]>([]);
  const [lastRequestData, setLastRequestData] = useState<Record<string, unknown> | null>(null);
  const [lastProofData, setLastProofData] = useState<Record<string, unknown> | null>(null);

  // Current request state
  const currentRequestIdRef = useRef<string | null>(null);
  const currentDeepLinkRef = useRef<string | null>(null);
  const jwtTokenRef = useRef('');
  const credentialsRef = useRef<{ clientId: string; apiKey: string } | null>(null);
  const devLogsRef = useRef<LogEntry[]>([]);
  const devLogsPanelRef = useRef<HTMLDivElement | null>(null);

  // Keep refs in sync
  useEffect(() => { jwtTokenRef.current = jwtToken; }, [jwtToken]);
  useEffect(() => { devLogsRef.current = devLogs; }, [devLogs]);

  // ========== SDK INIT ==========

  const getSDK = useCallback(() => {
    if (!sdkRef.current) {
      sdkRef.current = createSDK();
    }
    return sdkRef.current;
  }, []);

  // ========== DEV LOG ==========

  const devLog = useCallback((tag: string, message: string) => {
    const entry: LogEntry = { time: timeString(), tag, message };
    setDevLogs(prev => [...prev, entry]);
  }, []);

  // Auto-scroll dev logs
  useEffect(() => {
    if (devLogsPanelRef.current) {
      devLogsPanelRef.current.scrollTop = devLogsPanelRef.current.scrollHeight;
    }
  }, [devLogs]);

  // ========== INITIALIZATION ==========

  useEffect(() => {
    // Restore wallet from sessionStorage
    const savedWallet = sessionStorage.getItem('walletConnected') === 'true';
    const savedAddress = sessionStorage.getItem('walletAddress');
    if (savedWallet && savedAddress) {
      setWalletConnected(true);
      setWalletAddress(savedAddress);
    }

    // Restore KYC
    const savedKyc = sessionStorage.getItem('kycVerified') === 'true';
    const savedKycAt = sessionStorage.getItem('kycVerifiedAt');
    if (savedKyc) {
      setKycVerified(true);
      if (savedKycAt) setKycVerifiedAt(parseInt(savedKycAt));
    }

    // Reset token balances on page load
    sessionStorage.removeItem('tokenBalances');
    sessionStorage.removeItem('tokenDefaultBalances');
  }, []);

  // Auto-login with demo credentials
  useEffect(() => {
    const clientId = process.env.DEMO_CLIENT_ID || '';
    const apiKey = process.env.DEMO_API_KEY || '';

    if (clientId && apiKey && !clientId.startsWith('__')) {
      credentialsRef.current = { clientId, apiKey };
      const sdk = getSDK();
      sdk.login({ clientId, apiKey }).then((auth: AuthToken) => {
        setJwtToken(auth.token);
        setAuthClientId(auth.clientId);
        setLoggedIn(true);
        console.log(`[Auto-login] ${auth.clientId} (${auth.tier})`);
      }).catch((err: Error) => {
        console.error(`[Auto-login] Failed: ${err.message}`);
        setAuthStatus(`Auto-login failed: ${err.message}`);
        setManualAuthVisible(true);
      });
    } else {
      setManualAuthVisible(true);
    }
  }, [getSDK]);

  // Init log messages
  useEffect(() => {
    devLog('SDK', 'ZKPSwap initialized');
    devLog('SDK', `KYC threshold: ${KYC_THRESHOLD} ETH`);
  }, [devLog]);

  // ========== COMPUTED VALUES ==========

  const fromTokenData = tokens[fromToken];
  const toTokenData = tokens[toToken];
  const parsedFromAmount = parseFloat(fromAmount);
  const hasValidAmount = !isNaN(parsedFromAmount) && parsedFromAmount > 0;

  const outputAmount = hasValidAmount ? parsedFromAmount * (fromTokenData.price / toTokenData.price) : 0;
  const usdValue = hasValidAmount ? parsedFromAmount * fromTokenData.price : 0;
  const outputUsdValue = hasValidAmount ? outputAmount * toTokenData.price : 0;
  const rate = fromTokenData.price / toTokenData.price;
  const needsKyc = hasValidAmount && parsedFromAmount >= KYC_THRESHOLD && !kycVerified;
  const insufficientBalance = hasValidAmount && parsedFromAmount > fromTokenData.balance;
  const callbackUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/callback` : '';

  // Swap button state
  let swapBtnText = 'Enter an amount';
  let swapBtnDisabled = true;
  let swapBtnShowShield = false;

  if (!walletConnected) {
    swapBtnText = 'Connect Wallet';
    swapBtnDisabled = false;
  } else if (!hasValidAmount) {
    swapBtnText = 'Enter an amount';
    swapBtnDisabled = true;
  } else if (insufficientBalance) {
    swapBtnText = `Insufficient ${fromTokenData.symbol} balance`;
    swapBtnDisabled = true;
  } else if (needsKyc) {
    swapBtnText = 'Verify & Swap';
    swapBtnDisabled = false;
    swapBtnShowShield = true;
  } else {
    swapBtnText = 'Swap';
    swapBtnDisabled = false;
  }

  // ========== HANDLERS ==========

  const handleConnectWallet = useCallback(() => {
    if (walletConnected) {
      setWalletConnected(false);
      setWalletAddress(null);
      sessionStorage.removeItem('walletConnected');
      sessionStorage.removeItem('walletAddress');
      devLog('UI', 'Wallet disconnected');
    } else {
      const addr = generateRandomAddress();
      setWalletConnected(true);
      setWalletAddress(addr);
      sessionStorage.setItem('walletConnected', 'true');
      sessionStorage.setItem('walletAddress', addr);
      devLog('UI', `Wallet connected: ${addr}`);
    }
  }, [walletConnected, devLog]);

  const handleAmountInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
    setFromAmount(val);
  }, []);

  const handleSetMax = useCallback(() => {
    if (!walletConnected) return;
    const from = tokens[fromToken];
    setFromAmount(from.balance.toString());
    devLog('UI', `Set max amount: ${from.balance} ${from.symbol}`);
  }, [walletConnected, tokens, fromToken, devLog]);

  const handleSwapDirection = useCallback(() => {
    const oldFrom = fromToken;
    const oldTo = toToken;
    setFromToken(oldTo);
    setToToken(oldFrom);

    const amount = parseFloat(fromAmount);
    if (amount && !isNaN(amount)) {
      const newOutput = amount * (tokens[oldFrom].price / tokens[oldFrom].price);
      setFromAmount(parseFloat(newOutput.toString()).toString());
    }
    devLog('UI', `Swapped direction: ${oldTo} -> ${oldFrom}`);
  }, [fromToken, toToken, fromAmount, tokens, devLog]);

  const handleSetSlippage = useCallback((val: number) => {
    setSlippage(val);
    setCustomSlippage('');
    devLog('UI', `Slippage set to ${val}%`);
  }, [devLog]);

  const handleCustomSlippageInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomSlippage(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0 && num < 50) {
      setSlippage(num);
      devLog('UI', `Custom slippage set to ${num}%`);
    }
  }, [devLog]);

  const openTokenSelect = useCallback((side: 'from' | 'to') => {
    setTokenSelectSide(side);
    setTokenSelectOpen(true);
  }, []);

  const selectToken = useCallback((symbol: string) => {
    if (tokenSelectSide === 'from') {
      setFromToken(symbol);
    } else {
      setToToken(symbol);
    }
    setTokenSelectOpen(false);
    devLog('UI', `Selected ${symbol} for ${tokenSelectSide}`);
  }, [tokenSelectSide, devLog]);

  const resetKycVerification = useCallback(() => {
    setKycVerified(false);
    setKycVerifiedAt(null);
    sessionStorage.removeItem('kycVerified');
    sessionStorage.removeItem('kycVerifiedAt');
    devLog('UI', 'KYC verification reset');
  }, [devLog]);

  const authenticateWithApiKey = useCallback(async () => {
    if (!authInputClientId || !authInputApiKey) {
      setAuthStatus('Both fields required');
      return;
    }
    try {
      setAuthBtnDisabled(true);
      setAuthStatus('Authenticating...');
      credentialsRef.current = { clientId: authInputClientId, apiKey: authInputApiKey };
      const sdk = getSDK();
      const auth = await sdk.login({ clientId: authInputClientId, apiKey: authInputApiKey });
      setJwtToken(auth.token);
      setAuthClientId(auth.clientId);
      setLoggedIn(true);
      setAuthStatus('');
      devLog('AUTH', `Authenticated as ${auth.clientId} (tier=${auth.tier})`);
    } catch (err) {
      setAuthStatus((err as Error).message);
      devLog('AUTH', `Failed: ${(err as Error).message}`);
    } finally {
      setAuthBtnDisabled(false);
    }
  }, [authInputClientId, authInputApiKey, getSDK, devLog]);

  const clearAuth = useCallback(() => {
    setJwtToken('');
    setAuthClientId('');
    setLoggedIn(false);
    setAuthInputClientId('');
    setAuthInputApiKey('');
    setAuthStatus('');
    credentialsRef.current = null;
    const sdk = sdkRef.current;
    if (sdk) sdk.logout();
    devLog('AUTH', 'Logged out');
  }, [devLog]);

  const ensureAuth = useCallback(async (): Promise<boolean> => {
    const creds = credentialsRef.current;
    if (!creds) return false;
    try {
      const sdk = getSDK();
      const auth = await sdk.login(creds) as AuthToken;
      setJwtToken(auth.token);
      setAuthClientId(auth.clientId);
      setLoggedIn(true);
      console.log(`[Re-auth] ${auth.clientId} (${auth.tier})`);
      return true;
    } catch (err) {
      console.error('[Re-auth] Failed:', err);
      return false;
    }
  }, [getSDK]);

  const executeSwap = useCallback(async (withKyc: boolean) => {
    setSwapLoading(true);
    devLog('SDK', `Executing swap: ${fromAmount} ${fromToken} -> ${toToken}`);

    await new Promise(r => setTimeout(r, 1500));

    const from = tokens[fromToken];
    const to = tokens[toToken];
    const amount = parseFloat(fromAmount);
    const out = amount * (from.price / to.price);

    // Update balances
    setTokens(prev => ({
      ...prev,
      [fromToken]: { ...prev[fromToken], balance: prev[fromToken].balance - amount },
      [toToken]: { ...prev[toToken], balance: prev[toToken].balance + out },
    }));

    const txHash = generateRandomTxHash();
    devLog('SDK', `Swap complete. TX: ${shortenAddress(txHash)}`);

    setFromAmount('');
    setSwapLoading(false);

    // Show success modal
    setSuccessSubtitle(`Swapped ${formatCompact(amount)} ${from.symbol} for ${formatNumber(out, 2)} ${to.symbol}`);
    const details: Array<{ label: string; value: string; color?: string; copyValue?: string }> = [
      { label: 'Transaction', value: shortenAddress(txHash), copyValue: txHash },
      { label: 'Rate', value: `1 ${from.symbol} = ${formatNumber(from.price / to.price, from.price / to.price >= 1 ? 2 : 6)} ${to.symbol}` },
      { label: 'Slippage', value: `${slippage}%` },
    ];
    if (withKyc && kycVerifiedAt) {
      details.push({
        label: 'KYC Verified',
        value: new Date(kycVerifiedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        color: V.success,
      });
    }
    setSuccessDetails(details);
    setSuccessTxHash(txHash);
    setSuccessModalOpen(true);

    // Confetti
    celebrate();
  }, [fromAmount, fromToken, toToken, tokens, slippage, kycVerifiedAt, devLog]);

  const handleSwap = useCallback(async () => {
    if (!walletConnected) {
      handleConnectWallet();
      return;
    }
    const amount = parseFloat(fromAmount);
    if (!amount || isNaN(amount) || amount <= 0) return;
    if (amount > tokens[fromToken].balance) return;

    if (amount >= KYC_THRESHOLD && !kycVerified) {
      // Open KYC modal
      openKycModal();
    } else {
      await executeSwap(false);
    }
  }, [walletConnected, fromAmount, tokens, fromToken, kycVerified, handleConnectWallet, executeSwap]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openKycModal = useCallback(async () => {
    const from = tokens[fromToken];
    const to = tokens[toToken];
    const amount = parseFloat(fromAmount);
    const out = amount * (from.price / to.price);
    const usd = amount * from.price;

    setKycStatus('waiting');
    setKycStatusText('');
    setKycShieldAnimating(true);

    if (!jwtTokenRef.current) {
      if (await ensureAuth()) {
        devLog('SDK', 'Re-authenticated, retrying...');
      } else {
        setManualAuthVisible(true);
        return;
      }
    }

    devLog('SDK', 'Requesting proof via relay...');

    try {
      const sdk = getSDK();
      const result = await sdk.createRelayRequest('coinbase_attestation', {}, {
        dappName: 'ZKPSwap',
      });

      currentRequestIdRef.current = result.requestId;
      currentDeepLinkRef.current = result.deepLink;
      setLastRequestData({ requestId: result.requestId, circuit: 'coinbase_attestation', scope: 'zkpswap:kyc' });

      devLog('SDK', `Request ID: ${result.requestId}`);
      devLog('SDK', 'Deep link received from relay');

      // Generate QR code
      try {
        const qrDataUrl = await sdk.generateQRCode(result.deepLink, { width: 200, margin: 2 });
        setKycQrDataUrl(qrDataUrl);
        devLog('SDK', 'QR code generated');
      } catch (e) {
        devLog('SDK', `QR generation failed: ${(e as Error).message}`);
      }

      setKycModalOpen(true);

      // Show swap summary
      setKycStatusText(`Your swap: ${formatCompact(amount)} ${from.symbol} -> ${formatNumber(out, 2)} ${to.symbol} (~$${formatNumber(usd, 0)})`);

      // Wait for proof
      devLog('PROOF', `Waiting for proof ${result.requestId}`);

      try {
        const proofResult = await sdk.waitForProof(result.requestId, {
          timeoutMs: 300000,
          onStatusChange: (statusData: { status: string }) => {
            devLog('PROOF', `Status update: ${statusData.status}`);
          },
        });

        devLog('POLL', `Proof completed for ${result.requestId}`);
        await handleProofResult(proofResult);
      } catch (err) {
        devLog('POLL', `Proof failed: ${(err as Error).message}`);
        setKycStatus('error');
        setKycStatusText(`Verification failed: ${(err as Error).message}`);
        setKycShieldAnimating(false);
      }
    } catch (err) {
      if ((err as Error).message.includes('Not authenticated') && await ensureAuth()) {
        openKycModal();
      } else {
        devLog('SDK', `Relay connection failed: ${(err as Error).message}`);
        console.error('Failed to connect to relay:', (err as Error).message);
        setKycShieldAnimating(false);
      }
    }
  }, [tokens, fromToken, toToken, fromAmount, getSDK, devLog, ensureAuth]);

  const handleProofResult = useCallback(async (data: RelayProofResult) => {
    setLastProofData(data as unknown as Record<string, unknown>);
    devLog('PROOF', `Status: ${data.status}`);
    devLog('PROOF', `Request: ${data.requestId}`);

    if (data.status === 'completed') {
      setKycStatus('verifying');
      setKycShieldAnimating(false);

      devLog('VERIFY', 'Starting on-chain verification...');

      if (data.proof && data.publicInputs) {
        devLog('PROOF', `Proof: ${data.proof}`);
        devLog('PROOF', `Public inputs: ${JSON.stringify(data.publicInputs)}`);

        try {
          const address = data.verifierAddress;
          const chainId = data.chainId;

          if (!address || !chainId) {
            devLog('VERIFY', 'No verifier address or chainId in response, skipping on-chain verification');
          } else {
            const rpcUrl = chainId === 8453 ? 'https://mainnet.base.org' : 'https://sepolia.base.org';
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const contract = new ethers.Contract(
              address,
              ['function verify(bytes calldata _proof, bytes32[] calldata _publicInputs) external view returns (bool)'],
              provider
            );

            const publicInputsBytes32 = data.publicInputs!.map((input: string) => {
              const hex = input.startsWith('0x') ? input : `0x${input}`;
              return ethers.zeroPadValue(hex, 32);
            });

            devLog('VERIFY', `Calling verifier contract at ${address}...`);
            const isValid = await contract.verify(data.proof, publicInputsBytes32);

            if (isValid) {
              devLog('VERIFY', 'On-chain verification PASSED');
            } else {
              devLog('VERIFY', 'On-chain verification FAILED - proceeding with proof receipt');
            }
          }
        } catch (e) {
          devLog('VERIFY', `On-chain verification error: ${(e as Error).message}`);
        }
      }

      await new Promise(r => setTimeout(r, 1500));

      setKycStatus('verified');

      // Set KYC verified
      const now = Date.now();
      setKycVerified(true);
      setKycVerifiedAt(now);
      sessionStorage.setItem('kycVerified', 'true');
      sessionStorage.setItem('kycVerifiedAt', now.toString());

      devLog('SDK', 'KYC verified - executing swap');

      await new Promise(r => setTimeout(r, 1200));

      setKycModalOpen(false);
      await executeSwap(true);

    } else if (data.status === 'failed') {
      setKycStatus('error');
      setKycStatusText(`Verification failed: ${data.error || 'Unknown error'}`);
      devLog('PROOF', `Error: ${data.error}`);
    }
  }, [devLog, executeSwap]);

  const openProofportApp = useCallback(() => {
    if (currentDeepLinkRef.current) {
      devLog('SDK', `Opening deep link: ${currentDeepLinkRef.current}`);
      window.location.href = currentDeepLinkRef.current;
    }
  }, [devLog]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      devLog('UI', 'Copied to clipboard');
    });
  }, [devLog]);

  // ========== CONFETTI ==========

  const celebrate = useCallback(() => {
    // Dynamically load canvas-confetti
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
    script.onload = () => {
      const confetti = (window as unknown as { confetti: (opts: Record<string, unknown>) => void }).confetti;
      const duration = 2500;
      const end = Date.now() + duration;

      (function frame() {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.6 },
          colors: ['#6366f1', '#818cf8', '#22c55e', '#10b981'],
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.6 },
          colors: ['#6366f1', '#818cf8', '#22c55e', '#10b981'],
        });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    };
    // Only append if not already loaded
    if (!(window as unknown as { confetti?: unknown }).confetti) {
      document.head.appendChild(script);
    } else {
      script.onload!(new Event('load'));
    }
  }, []);

  // ========== KEYBOARD ==========

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTokenSelectOpen(false);
        setKycModalOpen(false);
        setSuccessModalOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close settings on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsOpen && !(e.target as HTMLElement).closest('[data-settings-area]')) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [settingsOpen]);

  // ========== RENDER ==========

  // KYC summary text for modal
  const kycSwapSummaryHtml = hasValidAmount
    ? `Your swap: <strong>${formatCompact(parsedFromAmount)} ${fromTokenData.symbol}</strong> &rarr; <strong>${formatNumber(outputAmount, 2)} ${toTokenData.symbol}</strong> (~$${formatNumber(usdValue, 0)})`
    : '';

  return (
    <>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Global styles via style tag for pseudo-elements and keyframes */}
      <style>{`
        body {
          font-family: ${V.fontSans};
          background: ${V.bgDeep};
          color: ${V.textPrimary};
          min-height: 100vh;
          overflow-x: hidden;
        }
        body::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
          pointer-events: none;
          z-index: 0;
        }
        body::after {
          content: '';
          position: fixed;
          top: -40%;
          left: 50%;
          transform: translateX(-50%);
          width: 80vw;
          height: 60vh;
          background: radial-gradient(ellipse at center, rgba(99, 102, 241, 0.06) 0%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeSlideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes modalSlideUp { from { opacity: 0; transform: translateY(24px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes shieldPulse {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(99, 102, 241, 0.3)); }
          50% { filter: drop-shadow(0 0 20px rgba(99, 102, 241, 0.6)); }
        }
        @keyframes successCheckPop {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
      `}</style>

      {/* ===== HEADER ===== */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: '64px',
        background: 'rgba(19, 19, 24, 0.85)',
        backdropFilter: 'blur(16px) saturate(180%)',
        borderBottom: `1px solid ${V.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: V.textPrimary }}>
            <img src="https://avatars.githubusercontent.com/u/230663424?s=200&v=4" alt="ZKPSwap" style={{ width: '28px', height: '28px', borderRadius: '6px' }} />
            <span style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em' }}>ZKPSwap</span>
          </a>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px', background: V.bgCard,
            border: `1px solid ${V.border}`, borderRadius: V.radiusFull,
            fontSize: '12px', fontWeight: 500, color: V.textSecondary,
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: V.success, boxShadow: `0 0 6px ${V.success}` }} />
            Sepolia
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Manual auth form */}
          {manualAuthVisible && (
            <span style={{ display: loggedIn ? 'none' : 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="text" placeholder="Client ID" value={authInputClientId}
                onChange={e => setAuthInputClientId(e.target.value)}
                style={{ width: '100px', padding: '3px 8px', fontSize: '11px', background: V.bgInput, border: `1px solid ${V.border}`, borderRadius: '4px', color: V.textPrimary, outline: 'none' }}
              />
              <input
                type="password" placeholder="API Key" value={authInputApiKey}
                onChange={e => setAuthInputApiKey(e.target.value)}
                style={{ width: '100px', padding: '3px 8px', fontSize: '11px', background: V.bgInput, border: `1px solid ${V.border}`, borderRadius: '4px', color: V.textPrimary, outline: 'none' }}
              />
              <button
                onClick={authenticateWithApiKey} disabled={authBtnDisabled}
                style={{ padding: '3px 10px', fontSize: '11px', background: V.accent, color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >Login</button>
            </span>
          )}
          {loggedIn && (
            <button
              onClick={clearAuth}
              style={{ padding: '3px 10px', fontSize: '11px', background: V.bgInput, color: V.textSecondary, border: `1px solid ${V.border}`, borderRadius: '4px', cursor: 'pointer' }}
            >Logout</button>
          )}
          {authStatus && (
            <span style={{ fontSize: '11px', color: V.error }}>{authStatus}</span>
          )}

          <a href="/landing" style={{ color: V.textSecondary, textDecoration: 'none', fontSize: '13px', marginLeft: '8px' }}>ZKProofport</a>

          {/* KYC Badge */}
          {kycVerified && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '4px 12px', background: V.shieldDim,
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: V.radiusFull, fontSize: '12px', fontWeight: 600, color: V.shield,
              transition: V.transitionBase,
            }}>
              <svg viewBox="0 0 16 16" fill="none" style={{ width: '14px', height: '14px' }}>
                <path d="M8 1L2 4v4c0 3.85 2.55 7.45 6 8 3.45-.55 6-4.15 6-8V4L8 1z" fill="currentColor" />
                <path d="M6.5 8l1.5 1.5 2.5-2.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Verified
            </div>
          )}

          {/* KYC Reset */}
          {kycVerified && (
            <button
              onClick={resetKycVerification} title="Reset KYC verification"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '24px', height: '24px', borderRadius: V.radiusFull,
                border: '1px solid rgba(239, 68, 68, 0.3)', background: V.errorDim,
                color: V.error, cursor: 'pointer', transition: V.transitionFast, fontSize: '12px', padding: 0,
              }}
            >
              <svg viewBox="0 0 16 16" fill="none" style={{ width: '12px', height: '12px' }}>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {/* Connect Wallet */}
          <button
            onClick={handleConnectWallet}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: walletConnected ? '8px 16px' : '8px 16px',
              background: walletConnected ? V.bgCard : V.accent,
              border: walletConnected ? `1px solid ${V.border}` : 'none',
              borderRadius: V.radiusMd, color: 'white',
              fontFamily: V.fontSans, fontSize: '14px', fontWeight: 600,
              cursor: 'pointer', transition: V.transitionFast,
            }}
          >
            {walletConnected && walletAddress ? (
              <>
                <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: getAvatarColor(walletAddress), flexShrink: 0 }} />
                {shortenAddress(walletAddress)}
              </>
            ) : 'Connect Wallet'}
          </button>
        </div>
      </header>

      {/* ===== MAIN ===== */}
      <main style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '48px 16px 120px', minHeight: 'calc(100vh - 64px)',
      }}>
        <div style={{
          width: '100%', maxWidth: '520px',
          background: V.bgCard, border: `1px solid ${V.border}`,
          borderRadius: V.radiusXl, padding: '16px',
          boxShadow: V.shadowCard,
          display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        }}>
          {/* Swap Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 600, color: V.textPrimary }}>Swap</span>

            {/* Settings button */}
            <div
              data-settings-area="true"
              onClick={(e) => { e.stopPropagation(); setSettingsOpen(!settingsOpen); }}
              role="button" tabIndex={0} aria-label="Settings"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '36px', height: '36px', background: 'transparent',
                border: 'none', borderRadius: V.radiusSm,
                color: V.textSecondary, cursor: 'pointer', transition: V.transitionFast,
                position: 'relative',
              }}
            >
              <svg viewBox="0 0 20 20" fill="none" style={{ width: '20px', height: '20px' }}>
                <path d="M8.325 2.317a1 1 0 011.35 0l.675.62a1 1 0 00.88.26l.895-.18a1 1 0 011.16.672l.28.866a1 1 0 00.62.62l.866.28a1 1 0 01.672 1.16l-.18.895a1 1 0 00.26.88l.62.675a1 1 0 010 1.35l-.62.675a1 1 0 00-.26.88l.18.895a1 1 0 01-.672 1.16l-.866.28a1 1 0 00-.62.62l-.28.866a1 1 0 01-1.16.672l-.895-.18a1 1 0 00-.88.26l-.675.62a1 1 0 01-1.35 0l-.675-.62a1 1 0 00-.88-.26l-.895.18a1 1 0 01-1.16-.672l-.28-.866a1 1 0 00-.62-.62l-.866-.28a1 1 0 01-.672-1.16l.18-.895a1 1 0 00-.26-.88l-.62-.675a1 1 0 010-1.35l.62-.675a1 1 0 00.26-.88l-.18-.895a1 1 0 01.672-1.16l.866-.28a1 1 0 00.62-.62l.28-.866a1 1 0 011.16-.672l.895.18a1 1 0 00.88-.26l.675-.62z" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>

              {/* Settings popover */}
              {settingsOpen && (
                <div
                  data-settings-area="true"
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute', top: '44px', right: 0, width: '280px',
                    background: V.bgCard, border: `1px solid ${V.borderHover}`,
                    borderRadius: V.radiusLg, padding: '16px',
                    boxShadow: V.shadowModal, zIndex: 50,
                    animation: 'fadeSlideDown 200ms ease-out',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 500, color: V.textSecondary, marginBottom: '8px' }}>
                    Slippage tolerance
                  </div>
                </div>
              )}
            </div>

            {/* Slippage options */}
            <div style={{ display: 'flex', gap: '10px', flex: 1, justifyContent: 'flex-end' }}>
              {[0.1, 0.5, 1.0].map(val => (
                <button
                  key={val}
                  onClick={(e) => { e.stopPropagation(); handleSetSlippage(val); }}
                  style={{
                    flex: 1, padding: '8px 0',
                    background: slippage === val && !customSlippage ? V.accentGlow : V.bgInput,
                    border: `1px solid ${slippage === val && !customSlippage ? V.accent : V.border}`,
                    borderRadius: V.radiusSm,
                    color: slippage === val && !customSlippage ? V.accentHover : V.textSecondary,
                    fontFamily: V.fontSans, fontSize: '13px', fontWeight: 500,
                    cursor: 'pointer', transition: V.transitionFast,
                  }}
                >{val}%</button>
              ))}
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text" placeholder="Custom" value={customSlippage}
                  onChange={handleCustomSlippageInput}
                  onClick={e => e.stopPropagation()}
                  style={{
                    width: '100%', padding: '8px 24px 8px 8px',
                    background: customSlippage ? V.accentGlow : V.bgInput,
                    border: `1px solid ${customSlippage ? V.accent : V.border}`,
                    borderRadius: V.radiusSm, color: V.textPrimary,
                    fontFamily: V.fontSans, fontSize: '13px', textAlign: 'center',
                    outline: 'none', transition: V.transitionFast,
                  }}
                />
                <span style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  fontSize: '12px', color: V.textTertiary, pointerEvents: 'none',
                }}>%</span>
              </div>
            </div>
          </div>

          {/* FROM token */}
          <div style={{ position: 'relative' }}>
            <div style={{
              background: V.bgInput, border: '1px solid transparent',
              borderRadius: V.radiusLg, padding: '16px', transition: V.transitionFast,
            }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: V.textTertiary, marginBottom: '8px' }}>You pay</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <button
                  onClick={() => openTokenSelect('from')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 12px 6px 6px', background: V.bgCard,
                    border: `1px solid ${V.border}`, borderRadius: V.radiusFull,
                    cursor: 'pointer', transition: V.transitionFast, flexShrink: 0,
                  }}
                >
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '13px', fontWeight: 700, color: 'white', background: fromTokenData.color,
                  }}>{fromTokenData.symbol[0]}</div>
                  <span style={{ fontSize: '16px', fontWeight: 600, color: V.textPrimary }}>{fromTokenData.symbol}</span>
                  <svg viewBox="0 0 16 16" fill="none" style={{ width: '16px', height: '16px', color: V.textTertiary }}>
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <input
                  type="text" inputMode="decimal" placeholder="0"
                  value={fromAmount} onChange={handleAmountInput}
                  style={{
                    width: '100%', minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                    color: V.textPrimary, fontFamily: V.fontSans, fontSize: '28px', fontWeight: 500,
                    textAlign: 'right', letterSpacing: '-0.01em',
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                <span style={{ fontSize: '13px', color: V.textTertiary }}>
                  {hasValidAmount ? `$${formatNumber(usdValue, 2)}` : ''}
                </span>
                <span style={{ fontSize: '13px', color: V.textTertiary }}>
                  Balance: <span
                    onClick={handleSetMax}
                    style={{ cursor: 'pointer', transition: V.transitionFast }}
                  >{formatCompact(fromTokenData.balance)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Direction button */}
          <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', height: 0, margin: '6px 0', zIndex: 2 }}>
            <button
              onClick={handleSwapDirection}
              aria-label="Switch tokens"
              style={{
                position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                width: '40px', height: '40px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: V.bgCard, border: `4px solid ${V.bgDeep}`,
                borderRadius: V.radiusSm, color: V.textSecondary,
                cursor: 'pointer', transition: V.transitionFast,
              }}
            >
              <svg viewBox="0 0 18 18" fill="none" style={{ width: '18px', height: '18px', transition: `transform ${V.transitionBase}` }}>
                <path d="M9 3v12M9 15l-4-4M9 15l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* TO token */}
          <div style={{ position: 'relative' }}>
            <div style={{
              background: V.bgInput, border: '1px solid transparent',
              borderRadius: V.radiusLg, padding: '16px', transition: V.transitionFast,
            }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: V.textTertiary, marginBottom: '8px' }}>You receive</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <button
                  onClick={() => openTokenSelect('to')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 12px 6px 6px', background: V.bgCard,
                    border: `1px solid ${V.border}`, borderRadius: V.radiusFull,
                    cursor: 'pointer', transition: V.transitionFast, flexShrink: 0,
                  }}
                >
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '13px', fontWeight: 700, color: 'white', background: toTokenData.color,
                  }}>{toTokenData.symbol[0]}</div>
                  <span style={{ fontSize: '16px', fontWeight: 600, color: V.textPrimary }}>{toTokenData.symbol}</span>
                  <svg viewBox="0 0 16 16" fill="none" style={{ width: '16px', height: '16px', color: V.textTertiary }}>
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <input
                  type="text" readOnly placeholder="0"
                  value={hasValidAmount ? (outputAmount >= 1000 ? '~' + formatNumber(outputAmount, 2) : '~' + formatCompact(outputAmount)) : ''}
                  style={{
                    width: '100%', minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                    color: V.textSecondary, fontFamily: V.fontSans, fontSize: '28px', fontWeight: 500,
                    textAlign: 'right', letterSpacing: '-0.01em',
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                <span style={{ fontSize: '13px', color: V.textTertiary }}>
                  {hasValidAmount ? `$${formatNumber(outputUsdValue, 2)}` : ''}
                </span>
                <span style={{ fontSize: '13px', color: V.textTertiary }}>
                  Balance: <span>{formatCompact(toTokenData.balance)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Swap info */}
          {hasValidAmount && (
            <div style={{ padding: '12px 8px 4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: V.textTertiary }}>
                <span>Rate</span>
                <span style={{ color: V.textSecondary }}>1 {fromTokenData.symbol} = {formatNumber(rate, rate >= 1 ? 2 : 6)} {toTokenData.symbol}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: V.textTertiary }}>
                <span>Network fee</span>
                <span style={{ color: V.textSecondary }}>~$2.40</span>
              </div>
            </div>
          )}

          {/* KYC warning */}
          {needsKyc && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 14px', marginTop: '12px',
              background: V.warningDim, border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: V.radiusMd, fontSize: '13px', color: V.warning,
            }}>
              <svg viewBox="0 0 16 16" fill="none" style={{ width: '16px', height: '16px', flexShrink: 0 }}>
                <path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M8 6v3M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>Swaps over 5 ETH require identity verification</span>
            </div>
          )}

          {/* Swap button */}
          <button
            disabled={swapBtnDisabled || swapLoading}
            onClick={handleSwap}
            style={{
              width: '100%', padding: '16px', marginTop: '12px',
              background: swapBtnDisabled ? V.bgInput : V.accent,
              border: 'none', borderRadius: V.radiusLg,
              color: swapBtnDisabled ? V.textTertiary : 'white',
              fontFamily: V.fontSans, fontSize: '16px', fontWeight: 600,
              cursor: swapBtnDisabled ? 'not-allowed' : 'pointer',
              transition: V.transitionFast,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              opacity: swapBtnDisabled ? 0.4 : 1,
              pointerEvents: swapLoading ? 'none' : 'auto',
            }}
          >
            {swapLoading ? (
              <>
                <span style={{
                  width: '18px', height: '18px',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  borderTopColor: 'white', borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }} />
                Swapping...
              </>
            ) : (
              <>
                {swapBtnShowShield && (
                  <svg viewBox="0 0 18 18" fill="none" style={{ width: '18px', height: '18px' }}>
                    <path d="M9 2L3 5v4c0 4.6 3 8.9 6 9.5 3-.6 6-4.9 6-9.5V5L9 2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <path d="M7 9.5l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {swapBtnText}
              </>
            )}
          </button>
        </div>
      </main>

      {/* ===== TOKEN SELECT MODAL ===== */}
      {tokenSelectOpen && (
        <div
          onClick={() => setTokenSelectOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px', animation: 'fadeIn 200ms ease-out',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: '420px', maxHeight: '80vh',
            background: V.bgCard, border: `1px solid ${V.borderHover}`,
            borderRadius: V.radiusXl, overflow: 'hidden',
            boxShadow: V.shadowModal, animation: 'modalSlideUp 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 16px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600 }}>Select a token</span>
              <button
                onClick={() => setTokenSelectOpen(false)} aria-label="Close"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '32px', height: '32px', background: 'transparent',
                  border: 'none', borderRadius: V.radiusSm,
                  color: V.textTertiary, cursor: 'pointer', transition: V.transitionFast,
                }}
              >
                <svg viewBox="0 0 18 18" fill="none" style={{ width: '18px', height: '18px' }}>
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div style={{ padding: '0 8px 8px' }}>
              {Object.values(tokens).map(t => {
                const otherToken = tokenSelectSide === 'from' ? toToken : fromToken;
                const isDisabled = t.symbol === otherToken;
                return (
                  <div
                    key={t.symbol}
                    onClick={() => !isDisabled && selectToken(t.symbol)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px', borderRadius: V.radiusMd,
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      transition: V.transitionFast,
                      opacity: isDisabled ? 0.35 : 1,
                    }}
                    onMouseEnter={e => { if (!isDisabled) (e.currentTarget as HTMLDivElement).style.background = V.bgInput; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '15px', fontWeight: 700, color: 'white', background: t.color,
                      }}>{t.symbol[0]}</div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '15px', fontWeight: 600 }}>{t.symbol}</span>
                        <span style={{ fontSize: '12px', color: V.textTertiary }}>{t.name}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: V.textSecondary }}>{formatCompact(t.balance)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== KYC MODAL ===== */}
      {kycModalOpen && (
        <div
          onClick={() => setKycModalOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px', animation: 'fadeIn 200ms ease-out',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto',
            background: V.bgCard, border: `1px solid ${V.borderHover}`,
            borderRadius: V.radiusXl, boxShadow: V.shadowModal,
            animation: 'modalSlideUp 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 16px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600 }}>Identity Verification</span>
              <button
                onClick={() => setKycModalOpen(false)} aria-label="Close"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '32px', height: '32px', background: 'transparent',
                  border: 'none', borderRadius: V.radiusSm,
                  color: V.textTertiary, cursor: 'pointer', transition: V.transitionFast,
                }}
              >
                <svg viewBox="0 0 18 18" fill="none" style={{ width: '18px', height: '18px' }}>
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              {/* Shield lock */}
              <div style={{ width: '72px', height: '72px', marginBottom: '20px', position: 'relative' }}>
                <svg
                  viewBox="0 0 72 72" fill="none"
                  style={{
                    width: '100%', height: '100%',
                    animation: kycShieldAnimating ? 'shieldPulse 2s ease-in-out infinite' : 'none',
                  }}
                >
                  <path d="M36 6L12 18v14c0 15.4 10.2 29.8 24 32 13.8-2.2 24-16.6 24-32V18L36 6z" fill="url(#kyc-shield-grad)" opacity="0.15" />
                  <path d="M36 6L12 18v14c0 15.4 10.2 29.8 24 32 13.8-2.2 24-16.6 24-32V18L36 6z" stroke="url(#kyc-shield-grad)" strokeWidth="2" fill="none" />
                  <rect x="27" y="28" width="18" height="14" rx="3" stroke="#6366f1" strokeWidth="2" fill="none" />
                  <path d="M31 28v-4a5 5 0 0110 0v4" stroke="#6366f1" strokeWidth="2" fill="none" strokeLinecap="round" />
                  <circle cx="36" cy="35" r="2" fill="#6366f1" />
                  <path d="M36 37v2" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
                  <defs>
                    <linearGradient id="kyc-shield-grad" x1="12" y1="6" x2="60" y2="70">
                      <stop stopColor="#6366f1" />
                      <stop offset="1" stopColor="#818cf8" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px', letterSpacing: '-0.02em' }}>Privacy-Preserving KYC</h2>
              <p style={{ fontSize: '14px', color: V.textSecondary, lineHeight: 1.5, marginBottom: '20px', maxWidth: '380px' }}>
                Verify your identity without revealing personal information using zero-knowledge proofs.
              </p>

              {/* Swap summary */}
              <div
                style={{
                  width: '100%', padding: '12px 16px', background: V.bgInput,
                  borderRadius: V.radiusMd, fontSize: '14px', color: V.textSecondary,
                  marginBottom: '24px', fontWeight: 500,
                }}
                dangerouslySetInnerHTML={{ __html: kycSwapSummaryHtml }}
              />

              {/* QR section */}
              <div style={{ width: '100%' }}>
                <div style={{ background: 'white', borderRadius: V.radiusLg, padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {kycQrDataUrl ? (
                    <img src={kycQrDataUrl} alt="QR Code" style={{ width: '200px', height: '200px', borderRadius: '8px' }} />
                  ) : (
                    <div style={{ width: '200px', height: '200px', background: '#f0f0f0', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                      Loading...
                    </div>
                  )}
                  <span style={{ marginTop: '12px', fontSize: '13px', color: '#475569', fontWeight: 500 }}>Scan with ZKProofport app</span>
                </div>

                {/* Divider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%', margin: '20px 0' }}>
                  <span style={{ flex: 1, height: '1px', background: V.border }} />
                  <span style={{ fontSize: '12px', color: V.textTertiary, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>or</span>
                  <span style={{ flex: 1, height: '1px', background: V.border }} />
                </div>

                {/* Open app button */}
                <button
                  onClick={openProofportApp}
                  style={{
                    width: '100%', padding: '14px', background: V.accent,
                    border: 'none', borderRadius: V.radiusMd,
                    color: 'white', fontFamily: V.fontSans, fontSize: '15px', fontWeight: 600,
                    cursor: 'pointer', transition: V.transitionFast,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  }}
                >
                  <svg viewBox="0 0 18 18" fill="none" style={{ width: '18px', height: '18px' }}>
                    <path d="M6 3H4a2 2 0 00-2 2v2m0 4v2a2 2 0 002 2h2m4 0h2a2 2 0 002-2v-2m0-4V5a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Open ZKProofport App
                </button>
              </div>

              {/* Status line */}
              <div style={{
                marginTop: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '8px', fontSize: '14px', fontWeight: 500, minHeight: '24px',
                color: kycStatus === 'waiting' ? V.textSecondary
                     : kycStatus === 'verifying' ? V.accentHover
                     : kycStatus === 'verified' ? V.success
                     : kycStatus === 'error' ? V.error
                     : V.warning,
              }}>
                {kycStatus === 'waiting' && (
                  <>
                    <span>Waiting for verification</span>
                    <span>
                      <span style={{ animation: 'dotPulse 1.4s infinite both' }}>.</span>
                      <span style={{ animation: 'dotPulse 1.4s infinite both', animationDelay: '0.2s' }}>.</span>
                      <span style={{ animation: 'dotPulse 1.4s infinite both', animationDelay: '0.4s' }}>.</span>
                    </span>
                  </>
                )}
                {kycStatus === 'verifying' && (
                  <>
                    <span style={{
                      width: '16px', height: '16px',
                      border: '2px solid rgba(129,140,248,0.3)', borderTopColor: '#818cf8',
                      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                    }} />
                    Verifying proof on-chain...
                  </>
                )}
                {kycStatus === 'verified' && (
                  <>
                    <svg viewBox="0 0 18 18" fill="none" style={{ width: '18px', height: '18px' }}>
                      <path d="M4 9l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Identity Verified! Executing swap...
                  </>
                )}
                {(kycStatus === 'error' || kycStatus === 'cancelled') && (
                  <span>{kycStatusText}</span>
                )}
              </div>

              {/* Explainer steps */}
              <div style={{ width: '100%', marginTop: '24px', paddingTop: '24px', borderTop: `1px solid ${V.border}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'ZKProofport connects to your wallet',
                  'Finds your Coinbase attestation',
                  'Generates a zero-knowledge proof',
                  'ZKPSwap verifies without seeing your identity',
                ].map((text, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}>
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '50%',
                      background: V.bgInput, border: `1px solid ${V.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 600, color: V.textTertiary, flexShrink: 0,
                    }}>{i + 1}</div>
                    <div style={{ fontSize: '13px', color: V.textSecondary, lineHeight: '24px' }}>{text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== SUCCESS MODAL ===== */}
      {successModalOpen && (
        <div
          onClick={() => setSuccessModalOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px', animation: 'fadeIn 200ms ease-out',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: '420px',
            background: V.bgCard, border: `1px solid ${V.borderHover}`,
            borderRadius: V.radiusXl, boxShadow: V.shadowModal,
            animation: 'modalSlideUp 300ms cubic-bezier(0.16, 1, 0.3, 1)',
            padding: '32px 24px', textAlign: 'center',
          }}>
            {/* Check icon */}
            <div style={{
              width: '72px', height: '72px', margin: '0 auto 20px',
              background: V.successDim, border: `2px solid ${V.success}`,
              borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'successCheckPop 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}>
              <svg viewBox="0 0 36 36" fill="none" style={{ width: '36px', height: '36px', color: V.success }}>
                <path d="M10 18l6 6 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px', letterSpacing: '-0.02em' }}>Swap Successful!</h2>
            <p style={{ fontSize: '14px', color: V.textSecondary, marginBottom: '24px' }}>{successSubtitle}</p>

            {/* Details */}
            <div style={{ width: '100%', background: V.bgInput, borderRadius: V.radiusMd, padding: '16px', marginBottom: '20px', textAlign: 'left' }}>
              {successDetails.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 0', fontSize: '13px',
                    borderBottom: i < successDetails.length - 1 ? `1px solid ${V.border}` : 'none',
                  }}
                >
                  <span style={{ color: V.textTertiary }}>{d.label}</span>
                  <span style={{ color: d.color || V.textPrimary, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {d.value}
                    {d.copyValue && (
                      <button
                        onClick={() => copyToClipboard(d.copyValue!)}
                        aria-label="Copy"
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '22px', height: '22px', background: V.bgCard,
                          border: `1px solid ${V.border}`, borderRadius: '4px',
                          color: V.textTertiary, cursor: 'pointer', transition: V.transitionFast,
                        }}
                      >
                        <svg viewBox="0 0 12 12" fill="none" style={{ width: '12px', height: '12px' }}>
                          <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M8 4V2.5A1.5 1.5 0 006.5 1h-4A1.5 1.5 0 001 2.5v4A1.5 1.5 0 002.5 8H4" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <a
              href={`https://sepolia.etherscan.io/tx/${successTxHash}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                color: V.accentHover, textDecoration: 'none',
                fontSize: '13px', fontWeight: 500, marginBottom: '20px',
                transition: V.transitionFast,
              }}
            >
              View on Etherscan
              <svg viewBox="0 0 14 14" fill="none" style={{ width: '14px', height: '14px' }}>
                <path d="M4 10L10 4M10 4H5M10 4v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>

            <br /><br />

            <button
              onClick={() => setSuccessModalOpen(false)}
              style={{
                width: '100%', padding: '14px',
                background: V.bgInput, border: `1px solid ${V.border}`,
                borderRadius: V.radiusMd, color: V.textPrimary,
                fontFamily: V.fontSans, fontSize: '15px', fontWeight: 600,
                cursor: 'pointer', transition: V.transitionFast,
              }}
            >Close</button>
          </div>
        </div>
      )}

      {/* ===== DEV PANEL TOGGLE ===== */}
      <button
        onClick={() => setDevPanelOpen(!devPanelOpen)}
        aria-label="Developer panel"
        style={{
          position: 'fixed', bottom: '16px', right: '16px',
          width: '40px', height: '40px',
          background: V.bgCard, border: `1px solid ${V.border}`,
          borderRadius: V.radiusSm, color: V.textTertiary,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 150, transition: V.transitionFast,
        }}
      >
        <svg viewBox="0 0 18 18" fill="none" style={{ width: '18px', height: '18px' }}>
          <path d="M6 4L2 9l4 5M12 4l4 5-4 5M10 2l-2 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* ===== DEV PANEL ===== */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        maxHeight: devPanelOpen ? '40vh' : '0',
        background: '#0f0f14', borderTop: `1px solid ${V.border}`,
        zIndex: 140, overflow: 'hidden',
        transition: `max-height ${V.transitionSlow}`,
      }}>
        <div style={{ height: '40vh', display: 'flex', flexDirection: 'column' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${V.border}`, flexShrink: 0 }}>
            {[
              { key: 'logs', label: 'SDK Logs' },
              { key: 'request', label: 'Request Data' },
              { key: 'proof', label: 'Proof Data' },
              { key: 'config', label: 'Config' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setDevActiveTab(tab.key)}
                style={{
                  padding: '10px 16px', background: 'transparent',
                  border: 'none', borderBottom: `2px solid ${devActiveTab === tab.key ? V.accent : 'transparent'}`,
                  color: devActiveTab === tab.key ? V.accentHover : V.textTertiary,
                  fontFamily: V.fontSans, fontSize: '12px', fontWeight: 500,
                  cursor: 'pointer', transition: V.transitionFast, whiteSpace: 'nowrap',
                }}
              >{tab.label}</button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', fontFamily: V.fontMono, fontSize: '12px', lineHeight: 1.6 }}>
            {/* Logs */}
            {devActiveTab === 'logs' && (
              <div ref={devLogsPanelRef}>
                {devLogs.map((l, i) => {
                  const tagColors: Record<string, { color: string; bg: string }> = {
                    SDK: { color: V.accentHover, bg: V.accentGlow },
                    POLL: { color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)' },
                    PROOF: { color: V.success, bg: V.successDim },
                    VERIFY: { color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.12)' },
                    UI: { color: V.textTertiary, bg: 'rgba(100, 116, 139, 0.12)' },
                    AUTH: { color: V.accentHover, bg: V.accentGlow },
                  };
                  const tc = tagColors[l.tag] || tagColors.UI;
                  return (
                    <div key={i} style={{ padding: '2px 0' }}>
                      <span style={{ color: V.textTertiary }}>[{l.time}]</span>{' '}
                      <span style={{ fontWeight: 600, padding: '1px 4px', borderRadius: '3px', fontSize: '10px', color: tc.color, background: tc.bg }}>{l.tag}</span>{' '}
                      {l.message}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Request Data */}
            {devActiveTab === 'request' && (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: V.textSecondary }}>
                {lastRequestData ? (
                  <div dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(lastRequestData, null, 2)) }} />
                ) : 'No active request'}
              </div>
            )}

            {/* Proof Data */}
            {devActiveTab === 'proof' && (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: V.textSecondary }}>
                {lastProofData ? (
                  <div dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(lastProofData, null, 2)) }} />
                ) : 'No proof received yet'}
              </div>
            )}

            {/* Config */}
            {devActiveTab === 'config' && (
              <div>
                {[
                  { label: 'Deep link scheme', value: 'zkproofport' },
                  { label: 'Verifier contract', value: 'From proof response', small: true },
                  { label: 'Chain', value: 'Sepolia (11155111)' },
                  { label: 'KYC threshold', value: '5 ETH' },
                  { label: 'Callback URL', value: callbackUrl, small: true },
                  { label: 'Poll interval', value: '2000ms' },
                ].map((row, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 0', borderBottom: `1px solid ${V.border}`,
                  }}>
                    <span style={{ color: V.textTertiary }}>{row.label}</span>
                    <span style={{ color: V.textPrimary, fontWeight: 500, fontSize: row.small ? '11px' : undefined }}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
