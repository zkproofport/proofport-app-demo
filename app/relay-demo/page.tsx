'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createSDK, detectSDKEnv } from '@/lib/sdk';
import { ProofportSDK } from '@zkproofport-app/sdk';
import type { ProofportSDK as ProofportSDKType, AuthToken, RelayProofResult } from '@zkproofport-app/sdk';

// ---------------------------------------------------------------------------
// Design tokens (matching the HTML CSS variables exactly)
// ---------------------------------------------------------------------------
const T = {
  navyDeep: '#0a0f1e',
  navyMid: '#131a2f',
  navyLight: '#1a2440',
  blue: '#2563eb',
  purple: '#7c3aed',
  cyan: '#06b6d4',
  green: '#22c55e',
  white: '#ffffff',
  gray100: '#f3f4f6',
  gray300: '#cbd5e1',
  gray400: '#94a3b8',
  gray600: '#64748b',
  yellow: '#eab308',
  red: '#ef4444',
} as const;

const MONO_FONT = "'SF Mono', 'Monaco', 'Courier New', monospace";
const SYSTEM_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type LogEntry = {
  id: number;
  time: string;
  method?: string;
  path?: string;
  status?: number;
  body?: string;
  type?: string;
  message?: string;
};

type NullifierEntry = {
  hash: string;
  timestamp: number;
  scope: string;
};

type OnChainData = {
  onChainStatus: string;
  txHash?: string;
  registeredAt?: number;
  scope?: string;
  circuitId?: string;
};

type ProofData = {
  status: string;
  proof: string;
  publicInputs?: string[];
  nullifier?: string;
  scope?: string;
  onChainStatus?: string;
  txHash?: string;
  registeredAt?: number;
  circuitId?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let logIdCounter = 0;
function nextLogId() {
  return ++logIdCounter;
}

function now() {
  return new Date().toLocaleTimeString();
}

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// ---------------------------------------------------------------------------
// Inline keyframes (injected once via <style>)
// ---------------------------------------------------------------------------
const GLOBAL_STYLES = `
@keyframes spin {
  to { transform: rotate(360deg); }
}
`;

// ---------------------------------------------------------------------------
// Reusable style objects
// ---------------------------------------------------------------------------
const styles = {
  // Container
  container: {
    maxWidth: 1400,
    margin: '0 auto',
    padding: '0 24px',
  } as React.CSSProperties,

  // Card
  card: {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 24,
    padding: 32,
    marginBottom: 24,
  } as React.CSSProperties,

  // Form input
  input: {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    color: T.white,
    fontSize: 14,
    fontFamily: 'inherit',
    transition: 'all 0.2s',
    outline: 'none',
  } as React.CSSProperties,

  select: {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    color: T.white,
    fontSize: 14,
    fontFamily: 'inherit',
    transition: 'all 0.2s',
    outline: 'none',
  } as React.CSSProperties,

  label: {
    display: 'block',
    marginBottom: 8,
    fontSize: 14,
    fontWeight: 500,
    color: T.gray300,
  } as React.CSSProperties,

  note: {
    fontSize: 12,
    color: T.gray400,
    marginTop: 6,
  } as React.CSSProperties,

  // Buttons
  btnPrimary: {
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 600,
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    background: `linear-gradient(135deg, ${T.blue}, ${T.purple})`,
    color: T.white,
    boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
    display: 'inline-block',
    textDecoration: 'none',
  } as React.CSSProperties,

  btnSecondary: {
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 12,
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    background: 'rgba(255,255,255,0.1)',
    color: T.white,
    display: 'inline-block',
    textDecoration: 'none',
  } as React.CSSProperties,

  btnSmall: {
    padding: '8px 16px',
    fontSize: 13,
  } as React.CSSProperties,

  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as React.CSSProperties,

  // Log viewer
  logViewer: {
    maxHeight: 800,
    overflowY: 'auto' as const,
    padding: 16,
    background: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    fontFamily: MONO_FONT,
    fontSize: 12,
  } as React.CSSProperties,

  logEntry: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  } as React.CSSProperties,

  // Spinner
  spinner: {
    display: 'inline-block',
    width: 14,
    height: 14,
    border: '2px solid rgba(234,179,8,0.3)',
    borderTopColor: T.yellow,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    verticalAlign: 'middle',
    marginRight: 8,
  } as React.CSSProperties,
};

// Badge style helper
function badgeStyle(tier: string): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
  switch (tier) {
    case 'free':
      return { ...base, background: 'rgba(100,116,139,0.2)', color: T.gray400 };
    case 'credit':
      return { ...base, background: 'rgba(234,179,8,0.2)', color: T.yellow };
    case 'plan1':
      return { ...base, background: 'rgba(37,99,235,0.2)', color: T.blue };
    case 'plan2':
      return { ...base, background: 'rgba(34,197,94,0.2)', color: T.green };
    default:
      return { ...base, background: 'rgba(100,116,139,0.2)', color: T.gray400 };
  }
}

// Status box style helper
function statusBoxStyle(variant: 'pending' | 'success' | 'error'): React.CSSProperties {
  const base: React.CSSProperties = { padding: 16, borderRadius: 12, marginTop: 16, fontSize: 14 };
  switch (variant) {
    case 'pending':
      return { ...base, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: T.yellow };
    case 'success':
      return { ...base, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: T.green };
    case 'error':
      return { ...base, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: T.red };
  }
}

// ---------------------------------------------------------------------------
// Component: Spinner
// ---------------------------------------------------------------------------
function Spinner() {
  return <span style={styles.spinner} />;
}

// ---------------------------------------------------------------------------
// Component: CopyButton (inline)
// ---------------------------------------------------------------------------
function CopyInlineBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!text || text === '-' || text === 'N/A') return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  if (!text || text === '-' || text === 'N/A') return null;

  return (
    <button
      onClick={handleCopy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        fontSize: 11,
        background: copied ? T.green : 'rgba(255,255,255,0.08)',
        border: `1px solid ${copied ? T.green : 'rgba(255,255,255,0.15)'}`,
        borderRadius: 4,
        color: copied ? T.white : T.gray400,
        cursor: 'pointer',
        transition: 'all 0.2s',
        marginLeft: 6,
        verticalAlign: 'middle',
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component: CopyButton (overlay for proof hex)
// ---------------------------------------------------------------------------
function CopyOverlayBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!text || text === '-') return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        padding: '6px 12px',
        fontSize: 12,
        background: copied ? T.green : 'rgba(255,255,255,0.1)',
        border: `1px solid ${copied ? T.green : 'rgba(255,255,255,0.2)'}`,
        borderRadius: 6,
        color: T.white,
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------
export default function RelayDemoPage() {
  // SDK ref
  const sdkRef = useRef<ProofportSDKType | null>(null);
  const sdkEnvRef = useRef<string>('local');

  // Auth state
  const [authToken, setAuthToken] = useState<AuthToken | null>(null);
  const [jwtToken, setJwtToken] = useState('');
  const [tier, setTier] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [authStatusColor, setAuthStatusColor] = useState<string>(T.gray400);
  const [authenticating, setAuthenticating] = useState(false);
  const [showAuthBadge, setShowAuthBadge] = useState(false);
  const [showClearAuth, setShowClearAuth] = useState(false);
  const [showTokenInfo, setShowTokenInfo] = useState(false);

  // Demo init
  const [demoIniting, setDemoIniting] = useState(false);
  const [demoStatusHtml, setDemoStatusHtml] = useState('');
  const [showDemoStatus, setShowDemoStatus] = useState(false);

  // Proof request
  const [circuit, setCircuit] = useState('coinbase_attestation');
  const [scope, setScope] = useState('proofport:demo:relay');
  const [countryListInput, setCountryListInput] = useState('');
  const [isIncluded, setIsIncluded] = useState('true');
  const [proofBtnDisabled, setProofBtnDisabled] = useState(true);
  const [showScopeNote, setShowScopeNote] = useState(false);

  // Proof request result
  const [showProofRequestResult, setShowProofRequestResult] = useState(false);
  const [qrHtml, setQrHtml] = useState('');
  const [deepLinkText, setDeepLinkText] = useState('');
  const [showDeepLink, setShowDeepLink] = useState(true);
  const [requestId, setRequestId] = useState('');
  const [statusVariant, setStatusVariant] = useState<'pending' | 'success' | 'error'>('pending');
  const [statusMessage, setStatusMessage] = useState('Waiting for proof...');

  // Proof result
  const [showProofResult, setShowProofResult] = useState(false);
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [showCreditAlert, setShowCreditAlert] = useState(false);

  // Nullifier
  const [showNullifierSection, setShowNullifierSection] = useState(false);
  const [localNullifiers, setLocalNullifiers] = useState<NullifierEntry[]>([]);
  const [duplicateResult, setDuplicateResult] = useState('');
  const [onChainData, setOnChainData] = useState<OnChainData | null>(null);
  const [onChainPlaceholder, setOnChainPlaceholder] = useState('On-chain verification data will appear here after proof submission');

  // Log state
  const [activeLogTab, setActiveLogTab] = useState<'api' | 'events' | 'nullifier'>('api');
  const [apiLogs, setApiLogs] = useState<LogEntry[]>([]);
  const [eventLogs, setEventLogs] = useState<LogEntry[]>([]);
  const [nullifierLogs, setNullifierLogs] = useState<LogEntry[]>([]);

  // Refs for current proof state (avoid stale closures)
  const currentProofRef = useRef<ProofData | null>(null);
  const jwtTokenRef = useRef('');
  const authTokenRef = useRef<AuthToken | null>(null);
  const tierRef = useRef('');

  // Env vars
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3000';

  // ---------------------------------------------------------------------------
  // SDK init
  // ---------------------------------------------------------------------------
  const getSDK = useCallback(() => {
    if (!sdkRef.current) {
      sdkEnvRef.current = detectSDKEnv();
      sdkRef.current = createSDK();
    }
    return sdkRef.current;
  }, []);

  // ---------------------------------------------------------------------------
  // Load nullifiers from localStorage on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    try {
      const stored = localStorage.getItem('relay_nullifiers');
      if (stored) {
        setLocalNullifiers(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Logging helpers
  // ---------------------------------------------------------------------------
  const logApi = useCallback((method: string, path: string, body?: unknown, status?: number) => {
    const entry: LogEntry = {
      id: nextLogId(),
      time: now(),
      method,
      path,
      status,
      body: body ? JSON.stringify(body, null, 2) : undefined,
    };
    setApiLogs(prev => [entry, ...prev]);
    console.log(`[API ${method}] ${path}`, status || '', body || '');
  }, []);

  const logEvent = useCallback((type: string, message: string) => {
    const entry: LogEntry = {
      id: nextLogId(),
      time: now(),
      type,
      message,
    };
    setEventLogs(prev => [entry, ...prev]);
    console.log(`[EVENT ${type}]`, message);
  }, []);

  const logNullifier = useCallback((operation: string, details: string) => {
    const entry: LogEntry = {
      id: nextLogId(),
      time: now(),
      type: operation,
      message: details,
    };
    setNullifierLogs(prev => [entry, ...prev]);
    console.log(`[NULLIFIER ${operation}]`, details);
  }, []);

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  const handleAuthenticate = useCallback(async () => {
    if (!clientIdInput.trim() || !apiKeyInput.trim()) {
      setAuthStatus('Both Client ID and API Key are required');
      setAuthStatusColor(T.red);
      return;
    }

    try {
      setAuthenticating(true);
      setAuthStatus('Authenticating...');
      setAuthStatusColor(T.gray400);

      const sdk = getSDK();
      const sdkEnv = sdkEnvRef.current;

      console.log('[Auth] Authenticating via SDK:', sdkEnv, 'clientId:', clientIdInput.trim());
      logEvent('AUTH', `Authenticating clientId=${clientIdInput.trim()} via SDK (env=${sdkEnv})`);
      logApi('POST', '/api/v1/auth/token', { client_id: clientIdInput.trim(), api_key: '***' });

      const auth = await sdk.login({ clientId: clientIdInput.trim(), apiKey: apiKeyInput.trim() });

      console.log('[Auth] Authentication successful:', JSON.stringify(auth));

      const authObj = auth as AuthToken;
      setJwtToken(authObj.token);
      jwtTokenRef.current = authObj.token;
      setAuthToken(authObj);
      authTokenRef.current = authObj;
      setTier(authObj.tier);
      tierRef.current = authObj.tier;

      setShowAuthBadge(true);
      setAuthStatus('Authenticated successfully');
      setAuthStatusColor(T.green);
      setShowTokenInfo(true);
      setShowClearAuth(true);
      setProofBtnDisabled(false);
      setShowScopeNote(authObj.tier === 'free');

      logEvent('AUTH_SUCCESS', `Authenticated as ${authObj.clientId} (tier=${authObj.tier}, dapp=${authObj.dappId})`);
      logApi('RESPONSE', '/api/auth/token', { token: authObj.token, client_id: authObj.clientId, dapp_id: authObj.dappId, tier: authObj.tier, expires_in: authObj.expiresIn }, 200);
    } catch (err) {
      const msg = (err as Error).message;
      console.error('[Auth] Authentication failed:', msg);
      setAuthStatus(`Auth failed: ${msg}`);
      setAuthStatusColor(T.red);
      logEvent('AUTH_FAILED', msg);
      logApi('ERROR', '/api/auth/token', { error: msg }, 401);
    } finally {
      setAuthenticating(false);
    }
  }, [clientIdInput, apiKeyInput, getSDK, logApi, logEvent]);

  const handleClearAuth = useCallback(() => {
    setJwtToken('');
    jwtTokenRef.current = '';
    setAuthToken(null);
    authTokenRef.current = null;
    setTier('');
    tierRef.current = '';
    setShowAuthBadge(false);
    setShowTokenInfo(false);
    setAuthStatus('');
    setShowClearAuth(false);
    setClientIdInput('');
    setApiKeyInput('');
    setProofBtnDisabled(true);

    logEvent('AUTH_CLEARED', 'JWT auth cleared, re-authenticate to make requests');
  }, [logEvent]);

  // ---------------------------------------------------------------------------
  // Demo init
  // ---------------------------------------------------------------------------
  const handleInitDemo = useCallback(async () => {
    try {
      setDemoIniting(true);
      setShowDemoStatus(true);
      setDemoStatusHtml('setting-up');

      setProofBtnDisabled(false);
      setDemoStatusHtml('ready');
      logEvent('INIT', 'Demo account initialized');
    } catch (err) {
      setDemoStatusHtml(`error:${(err as Error).message}`);
      setDemoIniting(false);
    }
  }, [logEvent]);

  // ---------------------------------------------------------------------------
  // Proof request
  // ---------------------------------------------------------------------------
  const showOnChainInfo = useCallback((data: OnChainData) => {
    setOnChainPlaceholder('');
    setOnChainData(data);
    logNullifier('ON_CHAIN', `Status: ${data.onChainStatus}, Tx: ${data.txHash}`);
  }, [logNullifier]);

  const showProofResultFn = useCallback((data: ProofData) => {
    console.log('[showProofResult] Full data:', JSON.stringify(data, null, 2));

    setStatusVariant('success');
    setStatusMessage('Proof completed');

    currentProofRef.current = data;
    setProofData(data);

    const nullifierHash = data.nullifier || (data.publicInputs && data.publicInputs.length > 0 ? data.publicInputs[0] : 'N/A');

    setShowProofResult(true);
    setShowNullifierSection(true);

    if (tierRef.current === 'credit') {
      setShowCreditAlert(true);
    }

    if (data.onChainStatus) {
      showOnChainInfo({
        onChainStatus: data.onChainStatus,
        txHash: data.txHash,
        registeredAt: data.registeredAt,
        scope: data.scope,
        circuitId: data.circuitId,
      });
    } else {
      setOnChainPlaceholder('On-chain verification data will appear here after proof submission');
      setOnChainData(null);
    }

    logEvent('PROOF_COMPLETED', 'Proof received');
    logNullifier('EXTRACTED', `Nullifier: ${nullifierHash}`);
  }, [logEvent, logNullifier, showOnChainInfo]);

  const startPolling = useCallback(async (reqId: string) => {
    console.log('[startPolling] Using SDK waitForProof (Socket.IO primary, polling fallback)');

    try {
      const sdk = getSDK();
      const result = await sdk.waitForProof(reqId, {
        onStatusChange: (statusUpdate: { status: string }) => {
          console.log('[SDK onStatusChange]', JSON.stringify(statusUpdate));
          logEvent('STATUS', `Status: ${statusUpdate.status}`);

          if (statusUpdate.status === 'pending' || statusUpdate.status === 'processing') {
            setStatusVariant('pending');
            setStatusMessage(`Waiting for proof... (${statusUpdate.status})`);
          }
        },
        timeoutMs: 300000,
      });

      console.log('[startPolling] SDK returned result:', JSON.stringify(result, null, 2));
      logApi('PROOF_COMPLETED', `/api/relay/proof/${reqId}`, result, 200);
      showProofResultFn(result as unknown as ProofData);
    } catch (err) {
      console.error('[startPolling] SDK waitForProof failed:', err);
      setStatusVariant('error');
      setStatusMessage(`Proof failed: ${(err as Error).message}`);
      logEvent('PROOF_FAILED', (err as Error).message);
      logApi('ERROR', `/api/relay/proof/${reqId}`, { error: (err as Error).message }, 0);
    }
  }, [getSDK, logApi, logEvent, showProofResultFn]);

  const handleRequestProof = useCallback(async () => {
    if (!jwtTokenRef.current) {
      logEvent('ERROR', 'Not authenticated. Please enter Client ID and API Key first.');
      alert('Please authenticate first (enter Client ID and API Key above)');
      return;
    }

    if (authTokenRef.current && !ProofportSDK.isTokenValid(authTokenRef.current)) {
      logEvent('TOKEN_EXPIRED', 'JWT token expired, clearing auth');
      handleClearAuth();
      alert('Your authentication token has expired. Please re-authenticate.');
      return;
    }

    try {
      const sdk = getSDK();
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const dappCallbackUrl = `${baseUrl}/api/callback`;

      console.log('[requestProof] START', { circuit, scope, baseUrl, dappCallbackUrl });

      const inputs: Record<string, unknown> = { scope };
      if (circuit === 'coinbase_country_attestation') {
        const countries = countryListInput.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
        if (countries.length === 0) {
          alert('Country List is required for country attestation');
          return;
        }
        inputs.countryList = countries;
        inputs.isIncluded = isIncluded === 'true';
      }

      console.log('[requestProof] Creating relay request via SDK:', { circuit, inputs, dappCallbackUrl });
      logApi('POST', '/api/relay/proof/request', { circuitId: circuit, scope, inputs, callbackUrl: dappCallbackUrl });

      const data = await sdk.createRelayRequest(circuit as 'coinbase_attestation' | 'coinbase_country_attestation', inputs as Record<string, unknown>, {
        message: undefined,
        dappName: undefined,
        nonce: undefined,
      });

      console.log('[requestProof] SDK response (FULL):', JSON.stringify(data, null, 2));

      setRequestId(data.requestId);
      logEvent('REQUEST_PROOF', `Request created: ${data.requestId}`);

      // Decode deep link
      try {
        const dlUrl = new URL(data.deepLink);
        const b64 = dlUrl.searchParams.get('data');
        console.log('[requestProof] Deep link base64 data param:', b64);
        if (b64) {
          let padded = b64.replace(/-/g, '+').replace(/_/g, '/');
          while (padded.length % 4) padded += '=';
          const decoded = JSON.parse(atob(padded));
          const decodedStr = JSON.stringify(decoded, null, 2);

          console.log('[requestProof] DECODED deep link data:', decodedStr);

          logApi('DEEP_LINK_DECODED', 'deep link -> app data', decoded);
          logApi('DEEP_LINK_CALLBACK', `callbackUrl = ${decoded.callbackUrl || 'MISSING!'}`, { callbackUrl: decoded.callbackUrl, fields: Object.keys(decoded) });
          logApi('RESPONSE', '/api/relay/proof/request', data, 200);
          logEvent('DEEP_LINK_DATA', decodedStr);
          logEvent('DEEP_LINK_CALLBACK', `callbackUrl in deep link: ${decoded.callbackUrl || 'MISSING!'}`);
          logEvent('DEEP_LINK_FIELDS', `Fields: ${Object.keys(decoded).join(', ')}`);
        } else {
          console.warn('[requestProof] No "data" param in deep link URL!');
          logApi('DEEP_LINK_WARNING', 'No data param in deep link', { deepLink: data.deepLink });
          logApi('RESPONSE', '/api/relay/proof/request', data, 200);
        }
      } catch (e) {
        console.error('[requestProof] Deep link decode error:', e);
        logEvent('DEEP_LINK_DECODE_ERR', (e as Error).message);
        logApi('RESPONSE', '/api/relay/proof/request', data, 200);
      }

      // Display QR or deep link button
      const mobile = isMobileDevice();
      if (mobile) {
        setQrHtml(`<a href="${data.deepLink}" style="display:inline-block;padding:16px 32px;font-size:18px;text-decoration:none;text-align:center;color:${T.white};background:linear-gradient(135deg,${T.blue},${T.purple});border-radius:12px;font-weight:600;box-shadow:0 4px 16px rgba(37,99,235,0.3);">Open ZKProofport App</a>`);
        setShowDeepLink(false);
      } else {
        const qrData = await sdk.generateQRCode(data.deepLink, { width: 200, margin: 1 });
        setQrHtml(`<img src="${qrData}" alt="QR Code" style="max-width:200px;border-radius:12px;background:white;padding:8px;" />`);
        setDeepLinkText(data.deepLink);
        setShowDeepLink(true);
      }

      setShowProofRequestResult(true);
      setStatusVariant('pending');
      setStatusMessage('Waiting for proof...');

      console.log('[requestProof] Starting polling for:', data.requestId);
      startPolling(data.requestId);
    } catch (err) {
      console.error('[requestProof] FAILED:', err);
      alert('Proof request failed: ' + (err as Error).message);
    }
  }, [circuit, scope, countryListInput, isIncluded, getSDK, handleClearAuth, logApi, logEvent, startPolling]);

  // ---------------------------------------------------------------------------
  // Nullifier management
  // ---------------------------------------------------------------------------
  const handleSaveToLocalStorage = useCallback(() => {
    if (!currentProofRef.current || !proofData) return;

    const nullifierHash = proofData.nullifier || (proofData.publicInputs && proofData.publicInputs.length > 0 ? proofData.publicInputs[0] : 'N/A');
    const entry: NullifierEntry = {
      hash: nullifierHash,
      timestamp: Date.now(),
      scope: currentProofRef.current.scope || '',
    };

    const updated = [...localNullifiers, entry];
    setLocalNullifiers(updated);
    localStorage.setItem('relay_nullifiers', JSON.stringify(updated));
    logNullifier('SAVED', `Saved to localStorage: ${nullifierHash}`);
  }, [localNullifiers, proofData, logNullifier]);

  const handleCheckDuplicate = useCallback(() => {
    if (!proofData) return;

    const nullifierHash = proofData.nullifier || (proofData.publicInputs && proofData.publicInputs.length > 0 ? proofData.publicInputs[0] : 'N/A');
    const exists = localNullifiers.some(n => n.hash === nullifierHash);

    if (exists) {
      setDuplicateResult('duplicate');
      logNullifier('DUPLICATE', `Nullifier already exists: ${nullifierHash}`);
    } else {
      setDuplicateResult('unique');
      logNullifier('CHECK', `Nullifier is unique: ${nullifierHash}`);
    }
  }, [localNullifiers, proofData, logNullifier]);

  const handleCheckOnChain = useCallback(async () => {
    if (!proofData) return;

    try {
      const nullifierHash = proofData.nullifier || (proofData.publicInputs && proofData.publicInputs.length > 0 ? proofData.publicInputs[0] : 'N/A');

      console.log('[checkOnChain] Checking nullifier on relay:', nullifierHash);
      logApi('GET', `/api/v1/nullifier/${nullifierHash}`);

      const sdkEnv = sdkEnvRef.current;
      const RELAY_URLS: Record<string, string> = {
        production: 'https://relay.zkproofport.app',
        staging: 'https://stg-relay.zkproofport.app',
        local: 'http://localhost:4001',
      };
      const localRelayUrl = typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:4001`
        : 'http://localhost:4001';
      const relayBase = sdkEnv === 'local' ? localRelayUrl : RELAY_URLS[sdkEnv];

      const response = await fetch(`${relayBase}/api/v1/nullifier/${nullifierHash}`);
      if (!response.ok) throw new Error(`Nullifier query failed: HTTP ${response.status}`);
      const data = await response.json();

      console.log('[checkOnChain] Response:', JSON.stringify(data, null, 2));
      logApi('RESPONSE', `/api/v1/nullifier/${nullifierHash}`, data, 200);

      if (data.registered) {
        showOnChainInfo({
          onChainStatus: 'verified_and_registered',
          txHash: data.txHash,
          registeredAt: data.registeredAt,
          scope: data.scope,
          circuitId: data.circuitId,
        });
        logNullifier('ON_CHAIN_CHECK', `Found: ${nullifierHash}`);
      } else {
        setOnChainPlaceholder('Nullifier not found on-chain');
        setOnChainData(null);
        logNullifier('ON_CHAIN_CHECK', `Not found: ${nullifierHash}`);
      }
    } catch (err) {
      console.error('[checkOnChain] Error:', err);
      logApi('ERROR', '/api/relay/nullifier', { error: (err as Error).message }, 0);
      alert('On-chain check failed: ' + (err as Error).message);
    }
  }, [proofData, logApi, logNullifier, showOnChainInfo]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const nullifierHash = proofData
    ? (proofData.nullifier || (proofData.publicInputs && proofData.publicInputs.length > 0 ? proofData.publicInputs[0] : 'N/A'))
    : '-';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_STYLES }} />

      {/* Background gradient overlay */}
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: `radial-gradient(circle at 20% 30%, rgba(37,99,235,0.15) 0%, transparent 50%),
                     radial-gradient(circle at 80% 70%, rgba(124,58,237,0.15) 0%, transparent 50%)`,
        pointerEvents: 'none', zIndex: -1,
      }} />

      <div style={{
        fontFamily: SYSTEM_FONT,
        background: T.navyDeep,
        color: T.gray100,
        lineHeight: 1.6,
        minHeight: '100vh',
        overflowX: 'hidden',
      }}>
        {/* ============================================================ */}
        {/* Header */}
        {/* ============================================================ */}
        <header style={{ padding: '32px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={styles.container}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <a href="/landing" style={{
                fontSize: 32, fontWeight: 700,
                background: `linear-gradient(135deg, ${T.blue}, ${T.purple})`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text', letterSpacing: '-0.02em', textDecoration: 'none',
              }}>
                ZKProofport
              </a>

              {showAuthBadge && (
                <span style={{ ...badgeStyle('plan1') }}>Authenticated</span>
              )}

              <nav style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                <a href="/landing#demo-kyc" style={{ color: T.gray400, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Callback Demo</a>
                <a href="/relay-demo" style={{ color: T.blue, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Relay Demo</a>
                <a href="/zkpswap" style={{ color: T.gray400, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>ZKPSwap</a>
                <a
                  href={`${dashboardUrl}/dashboard`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: T.cyan, border: `1px solid ${T.cyan}`, padding: '0.25rem 0.75rem', borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}
                >
                  Dashboard
                </a>
              </nav>
            </div>
          </div>
        </header>

        {/* ============================================================ */}
        {/* Hero */}
        {/* ============================================================ */}
        <section style={{ padding: '60px 0 40px', textAlign: 'center' }}>
          <div style={styles.container}>
            <h1 style={{
              fontSize: 48, fontWeight: 800, marginBottom: 16,
              background: `linear-gradient(135deg, ${T.white}, ${T.gray300})`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              Relay Demo
            </h1>
            <p style={{ fontSize: 18, color: T.gray400, maxWidth: 800, margin: '0 auto' }}>
              Test relay-based proof requests with verification and nullifier management
            </p>
          </div>
        </section>

        {/* ============================================================ */}
        {/* Quick Setup */}
        {/* ============================================================ */}
        <section style={{ padding: '40px 0' }}>
          <div style={styles.container}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 32, filter: 'drop-shadow(0 4px 12px rgba(37,99,235,0.4))' }}>&#9881;&#65039;</span>
              <h2 style={{ fontSize: 28, fontWeight: 700 }}>Quick Setup</h2>
            </div>

            <div style={styles.card}>
              {/* Demo init button */}
              <div style={{ textAlign: 'center', padding: 20 }}>
                <p style={{ color: T.gray400, marginBottom: 16 }}>Demo account is ready to use. Click below to start.</p>
                <button
                  style={{ ...styles.btnPrimary, ...(demoIniting ? styles.btnDisabled : {}) }}
                  disabled={demoIniting}
                  onClick={handleInitDemo}
                >
                  Initialize Demo
                </button>
                {showDemoStatus && (
                  <div style={{ marginTop: 16 }}>
                    {demoStatusHtml === 'setting-up' && (
                      <div><Spinner /> Setting up demo...</div>
                    )}
                    {demoStatusHtml === 'ready' && (
                      <div style={statusBoxStyle('success')}>Demo ready! You can now request proofs.</div>
                    )}
                    {demoStatusHtml.startsWith('error:') && (
                      <div style={statusBoxStyle('error')}>Setup failed: {demoStatusHtml.replace('error:', '')}</div>
                    )}
                  </div>
                )}
              </div>

              {/* Tier badge */}
              <div style={{ marginTop: 16 }}>
                <label style={styles.label}>
                  Current Tier <span style={badgeStyle(tier || 'free')}>{tier || 'free'}</span>
                </label>
              </div>

              {/* Auth section */}
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>API Key Authentication (Required)</div>
                  {showAuthBadge && <span style={badgeStyle('plan1')}>Authenticated</span>}
                </div>
                <p style={{ color: T.gray400, fontSize: 13, marginBottom: 16 }}>
                  Enter your API credentials to authenticate via JWT token. Authentication is required to use the relay.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={styles.label}>Client ID</label>
                    <input
                      type="text"
                      value={clientIdInput}
                      onChange={e => setClientIdInput(e.target.value)}
                      placeholder="Your client_id from dashboard"
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>API Key</label>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={e => setApiKeyInput(e.target.value)}
                      placeholder="Your api_key (shown once at creation)"
                      style={styles.input}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button
                    style={{ ...styles.btnSecondary, ...styles.btnSmall, ...(authenticating ? styles.btnDisabled : {}) }}
                    disabled={authenticating}
                    onClick={handleAuthenticate}
                  >
                    {authenticating ? <><Spinner /> Authenticating...</> : 'Authenticate'}
                  </button>
                  {showClearAuth && (
                    <button
                      style={{ ...styles.btnSecondary, ...styles.btnSmall }}
                      onClick={handleClearAuth}
                    >
                      Clear Auth
                    </button>
                  )}
                  <span style={{ fontSize: 13, color: authStatusColor }}>{authStatus}</span>
                </div>

                {/* JWT token info */}
                {showTokenInfo && authToken && (
                  <div style={{
                    marginTop: 12, padding: 12,
                    background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>JWT Token</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: T.green, wordBreak: 'break-all', marginTop: 4 }}>
                      {authToken.token}
                    </div>
                    <div style={{ fontSize: 12, color: T.gray400, marginTop: 8 }}>
                      Tier: <span>{authToken.tier}</span> | Expires: <span>{new Date(authToken.expiresAt).toLocaleTimeString()}</span> | dApp: <span>{authToken.dappId}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* Proof Request */}
        {/* ============================================================ */}
        <section style={{ padding: '40px 0' }}>
          <div style={styles.container}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 32, filter: 'drop-shadow(0 4px 12px rgba(37,99,235,0.4))' }}>&#128274;</span>
              <h2 style={{ fontSize: 28, fontWeight: 700 }}>Proof Request</h2>
            </div>

            <div style={styles.card}>
              {/* Circuit selector */}
              <div style={{ marginBottom: 16 }}>
                <label style={styles.label}>Circuit</label>
                <select
                  value={circuit}
                  onChange={e => setCircuit(e.target.value)}
                  style={styles.select}
                >
                  <option value="coinbase_attestation">Coinbase KYC</option>
                  <option value="coinbase_country_attestation">Coinbase Country</option>
                </select>
              </div>

              {/* Scope */}
              <div style={{ marginBottom: 16 }}>
                <label style={styles.label}>Scope</label>
                <input
                  type="text"
                  value={scope}
                  onChange={e => setScope(e.target.value)}
                  placeholder="proofport:demo:relay"
                  style={styles.input}
                />
                {showScopeNote && (
                  <p style={styles.note}>Note: Free tier will replace scope with noop</p>
                )}
              </div>

              {/* Country inputs (conditional) */}
              {circuit === 'coinbase_country_attestation' && (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={styles.label}>Country List</label>
                    <input
                      type="text"
                      value={countryListInput}
                      onChange={e => setCountryListInput(e.target.value)}
                      placeholder="US, KR"
                      onKeyDown={e => {
                        if (e.key === 'Tab' && !countryListInput && 'US, KR') {
                          e.preventDefault();
                          setCountryListInput('US, KR');
                        }
                      }}
                      style={styles.input}
                    />
                    <p style={styles.note}>Comma-separated ISO 3166-1 alpha-2 codes. Press Tab to autocomplete placeholder.</p>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={styles.label}>Is Included</label>
                    <select
                      value={isIncluded}
                      onChange={e => setIsIncluded(e.target.value)}
                      style={styles.select}
                    >
                      <option value="true">true — prove user IS from listed countries</option>
                      <option value="false">false — prove user is NOT from listed countries</option>
                    </select>
                  </div>
                </div>
              )}

              <button
                style={{ ...styles.btnPrimary, ...(proofBtnDisabled ? styles.btnDisabled : {}) }}
                disabled={proofBtnDisabled}
                onClick={handleRequestProof}
              >
                Request Proof
              </button>

              {/* Proof request result area */}
              {showProofRequestResult && (
                <div style={{ marginTop: 20 }}>
                  {/* QR / deep link */}
                  <div style={{ textAlign: 'center', margin: '20px 0' }} dangerouslySetInnerHTML={{ __html: qrHtml }} />

                  {showDeepLink && deepLinkText && (
                    <div style={{
                      marginTop: 12, padding: 12,
                      background: 'rgba(0,0,0,0.3)', borderRadius: 8,
                      fontFamily: "'Courier New', monospace", fontSize: 11,
                      wordBreak: 'break-all', color: T.gray400,
                    }}>
                      {deepLinkText}
                    </div>
                  )}

                  {/* Status box */}
                  <div style={statusBoxStyle(statusVariant)}>
                    {statusVariant === 'pending' && <Spinner />}
                    {statusMessage}
                    <div style={{ fontSize: 12, marginTop: 8, color: T.gray400 }}>
                      Request ID: <span>{requestId}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* Proof Result */}
        {/* ============================================================ */}
        {showProofResult && proofData && (
          <section style={{ padding: '40px 0' }}>
            <div style={styles.container}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <span style={{ fontSize: 32, filter: 'drop-shadow(0 4px 12px rgba(37,99,235,0.4))' }}>&#9989;</span>
                <h2 style={{ fontSize: 28, fontWeight: 700 }}>Proof Result</h2>
              </div>

              <div style={styles.card}>
                <div style={{
                  marginTop: 0, padding: 20,
                  background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: 12,
                }}>
                  <h4 style={{ fontSize: 16, color: T.cyan, marginBottom: 12 }}>Proof Received</h4>

                  {/* Proof meta grid */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 12, marginBottom: 16,
                  }}>
                    <div style={{ padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Status</div>
                      <div style={{ fontSize: 14, color: T.white, fontWeight: 600 }}>{proofData.status}</div>
                    </div>
                    <div style={{ padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Public Inputs</div>
                      <div style={{ fontSize: 14, color: T.white, fontWeight: 600 }}>{proofData.publicInputs ? proofData.publicInputs.length : 0}</div>
                    </div>
                    <div style={{ padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Nullifier Hash</div>
                      <div style={{ fontSize: 11, color: T.white, fontWeight: 600, wordBreak: 'break-all' }}>
                        {nullifierHash}
                        <CopyInlineBtn text={nullifierHash} />
                      </div>
                    </div>
                    <div style={{ padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Scope</div>
                      <div style={{ fontSize: 11, color: T.white, fontWeight: 600, wordBreak: 'break-all' }}>
                        {proofData.scope || 'N/A'}
                        <CopyInlineBtn text={proofData.scope || ''} />
                      </div>
                    </div>
                  </div>

                  {/* Proof hex */}
                  <div style={{ position: 'relative' }}>
                    <div style={{
                      padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 8,
                      fontFamily: MONO_FONT, fontSize: 12, color: T.gray300,
                      maxHeight: 150, overflowY: 'auto', wordBreak: 'break-all',
                    }}>
                      {proofData.proof}
                    </div>
                    <CopyOverlayBtn text={proofData.proof} />
                  </div>
                </div>

                {/* Credit alert */}
                {showCreditAlert && (
                  <div style={{
                    padding: '12px 16px', borderRadius: 8, marginTop: 12,
                    fontSize: 13, fontWeight: 500,
                    background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', color: T.cyan,
                  }}>
                    1 credit deducted
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* Nullifier Management */}
        {/* ============================================================ */}
        {showNullifierSection && (
          <section style={{ padding: '40px 0' }}>
            <div style={styles.container}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <span style={{ fontSize: 32, filter: 'drop-shadow(0 4px 12px rgba(37,99,235,0.4))' }}>&#128273;</span>
                <h2 style={{ fontSize: 28, fontWeight: 700 }}>Nullifier Management</h2>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
                gap: 24,
              }}>
                {/* Plan 1 — Off-Chain */}
                <div style={{
                  padding: 24, background: 'rgba(255,255,255,0.03)', borderRadius: 16,
                  border: '2px solid rgba(37,99,235,0.4)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Plan 1 — dApp Manages (Off-Chain)</div>
                      <div style={{ fontSize: 13, color: T.gray400, lineHeight: 1.5 }}>
                        Your dApp receives the nullifier hash. Store it in your database and check duplicates yourself.
                      </div>
                    </div>
                    <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: 'rgba(37,99,235,0.2)', color: T.blue }}>
                      No gas fees
                    </span>
                  </div>

                  {/* Nullifier display */}
                  <div style={{ position: 'relative' }}>
                    <div style={{
                      margin: '16px 0', padding: 12,
                      background: 'rgba(0,0,0,0.3)', borderRadius: 8,
                      fontFamily: MONO_FONT, fontSize: 12, wordBreak: 'break-all', color: T.gray300,
                    }}>
                      {nullifierHash}
                    </div>
                    <CopyOverlayBtn text={nullifierHash} />
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      style={{ ...styles.btnSecondary, ...styles.btnSmall }}
                      onClick={handleSaveToLocalStorage}
                    >
                      Save to Local Storage
                    </button>
                    <button
                      style={{ ...styles.btnSecondary, ...styles.btnSmall }}
                      onClick={handleCheckDuplicate}
                    >
                      Check Duplicate
                    </button>
                  </div>

                  {/* Duplicate result */}
                  {duplicateResult && (
                    <div style={{ marginTop: 12 }}>
                      {duplicateResult === 'duplicate' && (
                        <div style={statusBoxStyle('error')}>Duplicate detected!</div>
                      )}
                      {duplicateResult === 'unique' && (
                        <div style={statusBoxStyle('success')}>No duplicate found</div>
                      )}
                    </div>
                  )}

                  {/* Nullifier list */}
                  <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 12 }}>
                    {localNullifiers.length === 0 ? (
                      <div style={{ color: T.gray600, textAlign: 'center', padding: 20 }}>No nullifiers saved yet</div>
                    ) : (
                      localNullifiers.map((n, i) => (
                        <div key={i} style={{ padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
                          <div style={{ fontFamily: MONO_FONT, color: T.cyan, wordBreak: 'break-all', marginBottom: 4 }}>{n.hash}</div>
                          <div style={{ color: T.gray400, fontSize: 11 }}>
                            {new Date(n.timestamp).toLocaleString()} &bull; {n.scope || 'N/A'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'rgba(37,99,235,0.2)', color: T.blue }}>
                      Your responsibility
                    </span>
                  </div>
                </div>

                {/* Plan 2 — On-Chain */}
                <div style={{
                  padding: 24, background: 'rgba(255,255,255,0.03)', borderRadius: 16,
                  border: '2px solid rgba(34,197,94,0.4)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Plan 2 — ZKProofport Manages (On-Chain)</div>
                      <div style={{ fontSize: 13, color: T.gray400, lineHeight: 1.5 }}>
                        ZKProofport automatically verifies and registers nullifiers on-chain. Relay pays gas.
                      </div>
                    </div>
                    <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: 'rgba(34,197,94,0.2)', color: T.green }}>
                      Relay pays gas
                    </span>
                  </div>

                  {/* On-chain info */}
                  {onChainData ? (
                    <div style={{
                      padding: 12, background: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, marginTop: 12,
                    }}>
                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Status</div>
                      <div style={{ fontSize: 13, color: T.gray300, marginBottom: 8 }}>
                        <span style={badgeStyle('plan2')}>{onChainData.onChainStatus}</span>
                      </div>

                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Transaction</div>
                      <div style={{ fontSize: 13, color: T.gray300, marginBottom: 8 }}>
                        {onChainData.txHash ? (
                          <>
                            <a
                              href={`https://sepolia.basescan.org/tx/${onChainData.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: T.green, textDecoration: 'none', fontWeight: 600 }}
                            >
                              View on BaseScan
                            </a>
                            <CopyInlineBtn text={onChainData.txHash} label="Copy Hash" />
                          </>
                        ) : (
                          '-'
                        )}
                      </div>

                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Registered At</div>
                      <div style={{ fontSize: 13, color: T.gray300, marginBottom: 8 }}>
                        {onChainData.registeredAt ? new Date(onChainData.registeredAt * 1000).toLocaleString() : '-'}
                      </div>

                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Scope</div>
                      <div style={{ fontSize: 13, color: T.gray300, marginBottom: 8, wordBreak: 'break-all' }}>
                        {onChainData.scope || 'N/A'}
                        <CopyInlineBtn text={onChainData.scope || ''} />
                      </div>

                      <div style={{ fontSize: 11, color: T.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Circuit ID</div>
                      <div style={{ fontSize: 13, color: T.gray300 }}>
                        {onChainData.circuitId || 'N/A'}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: 20, textAlign: 'center', color: T.gray400, fontSize: 14 }}>
                      {onChainPlaceholder}
                    </div>
                  )}

                  <button
                    style={{ ...styles.btnSecondary, ...styles.btnSmall, marginTop: 16 }}
                    onClick={handleCheckOnChain}
                  >
                    Check On-Chain
                  </button>

                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'rgba(34,197,94,0.2)', color: T.green }}>
                      On-chain verification
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/* Developer Log */}
        {/* ============================================================ */}
        <section style={{ padding: '40px 0' }}>
          <div style={styles.container}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 32, filter: 'drop-shadow(0 4px 12px rgba(37,99,235,0.4))' }}>&#128202;</span>
              <h2 style={{ fontSize: 28, fontWeight: 700 }}>Developer Log</h2>
            </div>

            <div style={styles.card}>
              {/* Log tabs */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                {(['api', 'events', 'nullifier'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveLogTab(tab)}
                    style={{
                      padding: '10px 20px', fontSize: 14, fontWeight: 500,
                      color: activeLogTab === tab ? T.blue : T.gray400,
                      background: 'transparent', border: 'none',
                      borderBottom: `2px solid ${activeLogTab === tab ? T.blue : 'transparent'}`,
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    {tab === 'api' ? 'API Calls' : tab === 'events' ? 'Events' : 'Nullifier'}
                  </button>
                ))}
              </div>

              {/* API Calls log */}
              {activeLogTab === 'api' && (
                <div style={styles.logViewer}>
                  {apiLogs.length === 0 ? (
                    <div style={{ color: T.gray600, textAlign: 'center' }}>No API calls yet</div>
                  ) : (
                    apiLogs.map(entry => (
                      <div key={entry.id} style={styles.logEntry}>
                        <div>
                          <span style={{ color: T.gray600, marginRight: 8 }}>{entry.time}</span>
                          <span style={{ color: T.purple, fontWeight: 600, marginRight: 8 }}>{entry.method}</span>
                          <span style={{ color: T.cyan }}>{entry.path}</span>
                          {entry.status !== undefined && entry.status !== 0 && (
                            <span style={{
                              display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 11, marginLeft: 8,
                              background: entry.status >= 200 && entry.status < 300 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                              color: entry.status >= 200 && entry.status < 300 ? T.green : T.red,
                            }}>
                              {entry.status}
                            </span>
                          )}
                        </div>
                        {entry.body && (
                          <div style={{ marginTop: 4, paddingLeft: 16, color: T.gray400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {entry.body}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Events log */}
              {activeLogTab === 'events' && (
                <div style={styles.logViewer}>
                  {eventLogs.length === 0 ? (
                    <div style={{ color: T.gray600, textAlign: 'center' }}>No events yet</div>
                  ) : (
                    eventLogs.map(entry => (
                      <div key={entry.id} style={styles.logEntry}>
                        <div>
                          <span style={{ color: T.gray600, marginRight: 8 }}>{entry.time}</span>
                          <span style={{ color: T.yellow, fontWeight: 600, marginRight: 8 }}>{entry.type}</span>
                          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{entry.message}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Nullifier log */}
              {activeLogTab === 'nullifier' && (
                <div style={styles.logViewer}>
                  {nullifierLogs.length === 0 ? (
                    <div style={{ color: T.gray600, textAlign: 'center' }}>No nullifier operations yet</div>
                  ) : (
                    nullifierLogs.map(entry => (
                      <div key={entry.id} style={styles.logEntry}>
                        <div>
                          <span style={{ color: T.gray600, marginRight: 8 }}>{entry.time}</span>
                          <span style={{ color: T.yellow, fontWeight: 600, marginRight: 8 }}>{entry.type}</span>
                          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{entry.message}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
