'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createSDK } from '@/lib/sdk';
import type { ProofportSDK as ProofportSDKType, AuthToken, RelayProofResult, ProofResponse } from '@zkproofport-app/sdk';

/* ─── Color tokens (matching portal-web design system) ─── */
const C = {
  bgDeep: '#0a0e14',
  bgCard: '#0e1219',
  bgCardHover: '#131a24',
  gold: '#d6b15c',
  gold2: '#f0d488',
  goldLine: 'rgba(214,177,92,0.15)',
  cream: '#e8dcc8',
  muted: '#5a6577',
  ink: '#c9d7e2',
  white: '#ffffff',
  navy: '#0e2233',
} as const;

const FONT = {
  mono: "var(--font-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace)",
  serif: "var(--font-serif, 'DM Serif Display', Georgia, serif)",
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial",
} as const;

/* ─── Keyframe CSS injected once via <style> ─── */
const KEYFRAMES_CSS = `
@keyframes slideIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes confettiFall {
  0% { opacity: 1; top: -10px; transform: rotate(0deg) scale(1); }
  50% { opacity: 1; transform: rotate(720deg) scale(0.8); }
  100% { opacity: 0; top: 110vh; transform: rotate(1440deg) scale(0.3); }
}
@keyframes betaFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes betaSlideUp {
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
`;

/* ─── Types ─── */
/** Extended relay result with optional on-chain status from callback */
type ProofResultExt = RelayProofResult & {
  onChainStatus?: string;
  numPublicInputs?: number;
  timestamp?: number;
};

/* ─── Helpers ─── */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  return Promise.resolve();
}

/* ─── Spinner component ─── */
function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        border: `2px solid ${C.goldLine}`,
        borderTopColor: C.gold,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        verticalAlign: 'middle',
        marginRight: 8,
      }}
    />
  );
}

/* ─── Apple & Android SVG icons ─── */
function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 384 512" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
      <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  /* ── SDK ── */
  const sdkRef = useRef<ProofportSDKType | null>(null);

  const getSDK = useCallback(() => {
    if (!sdkRef.current) {
      sdkRef.current = createSDK();
    }
    return sdkRef.current;
  }, []);

  /* ── Auth state ── */
  const [authStatus, setAuthStatus] = useState('');
  const [authStatusColor, setAuthStatusColor] = useState('');
  const [showManualAuth, setShowManualAuth] = useState(false);
  const [authClientId, setAuthClientId] = useState('');
  const [authApiKey, setAuthApiKey] = useState('');
  const [authenticating, setAuthenticating] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [planBadge, setPlanBadge] = useState<{ tier: string; visible: boolean }>({ tier: '', visible: false });

  /* ── Country form ── */
  const [countryList, setCountryList] = useState('US,KR,JP');
  const [isIncluded, setIsIncluded] = useState(true);

  /* ── Demo result state (per-prefix) ── */
  type DemoState = {
    showResult: boolean;
    showWaiting: boolean;
    showFailed: boolean;
    showReceived: boolean;
    failedReason: string;
    qrHtml: string;
    deepLink: string;
    proofData: string;
    proofObject: ProofResultExt | null;
    receivedClass: string;
    receivedTitle: string;
    showVerifyResult: boolean;
    verifyResultClass: string;
    verifyResultContent: string;
    copyLabel: string;
    copyClass: string;
  };

  const emptyDemoState: DemoState = {
    showResult: false,
    showWaiting: false,
    showFailed: false,
    showReceived: false,
    failedReason: 'The proof request timed out. Please try again.',
    qrHtml: '',
    deepLink: '',
    proofData: '',
    proofObject: null,
    receivedClass: 'received',
    receivedTitle: 'Proof Received',
    showVerifyResult: false,
    verifyResultClass: '',
    verifyResultContent: '',
    copyLabel: 'Copy',
    copyClass: '',
  };

  const [kycState, setKycState] = useState<DemoState>({ ...emptyDemoState });
  const [countryState, setCountryState] = useState<DemoState>({ ...emptyDemoState });

  const activeKycRequestIdRef = useRef<string | null>(null);
  const activeCountryRequestIdRef = useRef<string | null>(null);

  /* ── Proof modal ── */
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [proofModalPrefix, setProofModalPrefix] = useState<'kyc' | 'country' | null>(null);

  /* ── Beta modal ── */
  const [betaOpen, setBetaOpen] = useState(false);
  const [betaPlatform, setBetaPlatformState] = useState<string | null>(null);
  const [betaEmail, setBetaEmail] = useState('');
  const [betaOrg, setBetaOrg] = useState('');
  const [betaSubmitting, setBetaSubmitting] = useState(false);
  const [betaSuccess, setBetaSuccess] = useState(false);
  const [betaError, setBetaError] = useState('');

  /* ── Confetti ── */
  const [confettiPieces, setConfettiPieces] = useState<Array<{
    id: number;
    left: string;
    background: string;
    delay: string;
    duration: string;
    borderRadius: string;
    width: string;
    height: string;
  }>>([]);
  const confettiIdRef = useRef(0);

  /* ── Hover states for nav links ── */
  const [iosHover, setIosHover] = useState(false);
  const [androidHover, setAndroidHover] = useState(false);

  /* ── Hover states for steps ── */
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  /* ── Hover states for features ── */
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  /* ── Hover states for demo cards ── */
  const [hoveredDemoCard, setHoveredDemoCard] = useState<string | null>(null);

  /* ── Hover states for buttons ── */
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  /* ── Auto-login on mount ── */
  useEffect(() => {
    const demoClientId = process.env.DEMO_CLIENT_ID || '';
    const demoApiKey = process.env.DEMO_API_KEY || '';
    const hasAutoCreds = demoClientId && demoApiKey && !demoClientId.startsWith('__');

    if (hasAutoCreds) {
      const sdk = getSDK();
      sdk.login({ clientId: demoClientId, apiKey: demoApiKey })
        .then((auth: AuthToken) => {
          console.log(`[Auto-login] ${auth.clientId} (${auth.tier})`);
          setAuthStatus('');
          setAuthenticated(true);
          setPlanBadge({ tier: auth.tier, visible: true });
        })
        .catch((err: Error) => {
          console.error(`[Auto-login] Failed: ${err.message}`);
          setAuthStatus(`Auto-login failed: ${err.message}`);
          setAuthStatusColor('#ef4444');
          setShowManualAuth(true);
        });
    } else {
      setShowManualAuth(true);
    }
  }, [getSDK]);

  /* ── Auth handlers ── */
  const handleAuthenticate = useCallback(async () => {
    if (!authClientId || !authApiKey) {
      setAuthStatus('Both fields required');
      setAuthStatusColor('#ef4444');
      return;
    }
    try {
      setAuthenticating(true);
      setAuthStatus('Authenticating...');
      setAuthStatusColor(C.muted);
      const sdk = getSDK();
      const auth = await sdk.login({ clientId: authClientId, apiKey: authApiKey }) as AuthToken;
      setAuthenticated(true);
      setShowManualAuth(false);
      setAuthStatus(`Authenticated as ${auth.clientId} (${auth.tier})`);
      setAuthStatusColor('#22c55e');
      setPlanBadge({ tier: auth.tier, visible: true });
    } catch (err) {
      setAuthStatus((err as Error).message);
      setAuthStatusColor('#ef4444');
    } finally {
      setAuthenticating(false);
    }
  }, [authClientId, authApiKey, getSDK]);

  const handleClearAuth = useCallback(() => {
    setAuthClientId('');
    setAuthApiKey('');
    setAuthenticated(false);
    setShowManualAuth(true);
    setAuthStatus('');
    setPlanBadge({ tier: '', visible: false });
    const sdk = sdkRef.current;
    if (sdk) sdk.logout();
  }, []);

  /* ── Confetti launcher ── */
  const launchConfetti = useCallback(() => {
    const colors = ['#22c55e', '#3b82f6', '#a855f7', '#eab308', '#ec4899', '#06b6d4', '#f97316'];
    const pieces = [];
    for (let i = 0; i < 80; i++) {
      const isCircle = Math.random() > 0.5;
      const size = isCircle ? '10px' : `${6 + Math.random() * 8}px`;
      pieces.push({
        id: confettiIdRef.current++,
        left: `${Math.random() * 100}%`,
        background: colors[Math.floor(Math.random() * colors.length)],
        delay: `${Math.random() * 1.5}s`,
        duration: `${2 + Math.random() * 2}s`,
        borderRadius: isCircle ? '50%' : '0',
        width: size,
        height: size,
      });
    }
    setConfettiPieces(pieces);
    setTimeout(() => setConfettiPieces([]), 5000);
  }, []);

  /* ── Show proof helpers ── */
  const setDemoState = useCallback((prefix: 'kyc' | 'country', updater: (prev: DemoState) => DemoState) => {
    if (prefix === 'kyc') setKycState(updater);
    else setCountryState(updater);
  }, []);

  const showProofReceived = useCallback((prefix: 'kyc' | 'country', proof: ProofResultExt) => {
    const isAlreadyRegistered = proof.onChainStatus === 'already_registered';
    setDemoState(prefix, (prev) => ({
      ...prev,
      showWaiting: false,
      showFailed: false,
      showResult: true,
      showReceived: true,
      showVerifyResult: false,
      receivedClass: isAlreadyRegistered ? 'duplicate' : 'received',
      receivedTitle: isAlreadyRegistered
        ? 'Already Registered'
        : proof.onChainStatus === 'verified_and_registered'
          ? 'Verified & Registered On-Chain'
          : 'Proof Received',
      proofData: JSON.stringify(proof, null, 2),
      proofObject: proof,
    }));
    if (prefix === 'kyc') activeKycRequestIdRef.current = null;
    else activeCountryRequestIdRef.current = null;
    if (proof.status === 'completed' && !isAlreadyRegistered) launchConfetti();
  }, [setDemoState, launchConfetti]);

  const showProofTimeout = useCallback((prefix: 'kyc' | 'country') => {
    setDemoState(prefix, (prev) => ({
      ...prev,
      showWaiting: false,
      showReceived: false,
      showFailed: true,
      failedReason: 'The proof request timed out after 3 minutes. Please try again.',
    }));
    if (prefix === 'kyc') activeKycRequestIdRef.current = null;
    else activeCountryRequestIdRef.current = null;
  }, [setDemoState]);

  const showProofFailed = useCallback((prefix: 'kyc' | 'country', reason: string) => {
    setDemoState(prefix, (prev) => ({
      ...prev,
      showWaiting: false,
      showReceived: false,
      showFailed: true,
      failedReason: reason,
    }));
    if (prefix === 'kyc') activeKycRequestIdRef.current = null;
    else activeCountryRequestIdRef.current = null;
  }, [setDemoState]);

  const showProofResult = useCallback(async (deepLink: string, prefix: 'kyc' | 'country') => {
    if (isMobileDevice()) {
      setDemoState(prefix, (prev) => ({
        ...prev,
        qrHtml: '',
        deepLink: '',
      }));
      // We'll render the "Open App" button via state
    } else {
      const sdk = getSDK();
      const qrDataUrl = await sdk.generateQRCode(deepLink, { width: 200 });
      setDemoState(prefix, (prev) => ({
        ...prev,
        qrHtml: qrDataUrl,
        deepLink: deepLink,
      }));
    }
  }, [getSDK, setDemoState]);

  /* ── KYC request ── */
  const requestKycProof = useCallback(async () => {
    if (!authenticated) { alert('Please log in first to request a proof.'); return; }
    setProofModalPrefix('kyc');
    setProofModalOpen(true);
    setKycState((prev) => ({
      ...prev,
      showReceived: false,
      showWaiting: false,
      showFailed: false,
      showVerifyResult: false,
    }));

    try {
      const sdk = getSDK();
      const result = await sdk.createRelayRequest('coinbase_attestation', {}, {
        dappName: 'ZKProofport Demo',
      });

      activeKycRequestIdRef.current = result.requestId;

      const deepLink = result.deepLink;
      await showProofResult(deepLink, 'kyc');
      setKycState((prev) => ({ ...prev, showResult: true, showWaiting: true }));

      const finalResult = await sdk.waitForProof(result.requestId, {
        timeoutMs: 180000,
        onStatusChange: (status) => {
          if (status.status === 'completed') {
            showProofReceived('kyc', status as ProofResultExt);
          } else if (status.status === 'failed') {
            showProofFailed('kyc', ('error' in status && status.error) || 'Proof generation failed');
          }
        },
      });

      if (finalResult.status === 'completed') {
        showProofReceived('kyc', finalResult as ProofResultExt);
      } else if (finalResult.status === 'failed') {
        showProofFailed('kyc', finalResult.error || 'Proof generation failed');
      }
    } catch (err) {
      if ((err as Error).message.includes('timeout')) {
        showProofTimeout('kyc');
      } else {
        alert(`Failed to create proof request: ${(err as Error).message}`);
      }
    }
  }, [authenticated, getSDK, showProofResult, showProofReceived, showProofFailed, showProofTimeout]);

  /* ── Country request ── */
  const requestCountryProof = useCallback(async () => {
    if (!authenticated) { alert('Please log in first to request a proof.'); return; }
    const countries = countryList.split(',').map(c => c.trim().toUpperCase()).filter(c => c);

    setProofModalPrefix('country');
    setProofModalOpen(true);
    setCountryState((prev) => ({
      ...prev,
      showReceived: false,
      showWaiting: false,
      showFailed: false,
      showVerifyResult: false,
    }));

    try {
      const sdk = getSDK();
      const result = await sdk.createRelayRequest('coinbase_country_attestation', { countryList: countries, isIncluded }, {
        dappName: 'ZKProofport Demo',
      });

      activeCountryRequestIdRef.current = result.requestId;

      const deepLink = result.deepLink;
      await showProofResult(deepLink, 'country');
      setCountryState((prev) => ({ ...prev, showResult: true, showWaiting: true }));

      const finalResult = await sdk.waitForProof(result.requestId, {
        timeoutMs: 180000,
        onStatusChange: (status) => {
          if (status.status === 'completed') {
            showProofReceived('country', status as ProofResultExt);
          } else if (status.status === 'failed') {
            showProofFailed('country', ('error' in status && status.error) || 'Proof generation failed');
          }
        },
      });

      if (finalResult.status === 'completed') {
        showProofReceived('country', finalResult as ProofResultExt);
      } else if (finalResult.status === 'failed') {
        showProofFailed('country', finalResult.error || 'Proof generation failed');
      }
    } catch (err) {
      if ((err as Error).message.includes('timeout')) {
        showProofTimeout('country');
      } else {
        alert(`Failed to create proof request: ${(err as Error).message}`);
      }
    }
  }, [authenticated, countryList, isIncluded, getSDK, showProofResult, showProofReceived, showProofFailed, showProofTimeout]);

  /* ── Copy proof ── */
  const handleCopyProof = useCallback((prefix: 'kyc' | 'country') => {
    const data = prefix === 'kyc' ? kycState.proofData : countryState.proofData;
    if (data) {
      copyToClipboard(data).then(() => {
        setDemoState(prefix, (prev) => ({ ...prev, copyLabel: 'Copied!', copyClass: 'copied' }));
        setTimeout(() => {
          setDemoState(prefix, (prev) => ({ ...prev, copyLabel: 'Copy', copyClass: '' }));
        }, 2000);
      });
    }
  }, [kycState.proofData, countryState.proofData, setDemoState]);

  /* ── Verify proof ── */
  const handleVerifyProof = useCallback(async (prefix: 'kyc' | 'country', type: 'onchain' | 'offchain') => {
    const proof = prefix === 'kyc' ? kycState.proofObject : countryState.proofObject;
    if (!proof || proof.status !== 'completed') return;

    setDemoState(prefix, (prev) => ({
      ...prev,
      showVerifyResult: true,
      verifyResultClass: 'verifying',
      verifyResultContent: `${type === 'onchain' ? 'On-Chain' : 'Off-Chain'} verification in progress...`,
    }));

    try {
      const sdk = getSDK();
      const result = await sdk.verifyResponseOnChain(proof as unknown as ProofResponse);
      if (result.valid) {
        setDemoState(prefix, (prev) => ({
          ...prev,
          verifyResultClass: 'success',
          verifyResultContent: `${type === 'onchain' ? 'On-Chain' : 'Off-Chain'} Verification Passed!`,
        }));
        launchConfetti();
      } else {
        setDemoState(prefix, (prev) => ({
          ...prev,
          verifyResultClass: 'failure',
          verifyResultContent: `Verification Failed: ${result.error || 'Invalid proof'}`,
        }));
      }
    } catch (err) {
      setDemoState(prefix, (prev) => ({
        ...prev,
        verifyResultClass: 'failure',
        verifyResultContent: `Verification Error: ${(err as Error).message || err}`,
      }));
    }
  }, [kycState.proofObject, countryState.proofObject, getSDK, setDemoState, launchConfetti]);

  /* ── Smooth scroll ── */
  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /* ── Beta modal ── */
  const openBetaModal = useCallback((platform: string) => {
    setBetaPlatformState(platform);
    setBetaEmail('');
    setBetaOrg('');
    setBetaSuccess(false);
    setBetaError('');
    setBetaSubmitting(false);
    setBetaOpen(true);
  }, []);

  const closeBetaModal = useCallback(() => {
    setBetaOpen(false);
  }, []);

  const submitBetaRequest = useCallback(async () => {
    if (!betaEmail.trim()) {
      setBetaError('Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(betaEmail.trim())) {
      setBetaError('Please enter a valid email address.');
      return;
    }
    if (!betaOrg.trim()) {
      setBetaError('Please enter your organization.');
      return;
    }

    setBetaSubmitting(true);
    setBetaError('');

    try {
      const res = await fetch('/api/proxy/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: betaEmail.trim(),
          name: betaOrg.trim(),
          subject: `Beta Invite Request - ${betaPlatform || 'Unknown'}`,
          body: `[Beta Invite Request]\n\n${betaEmail.trim()} (${betaOrg.trim()}) has signed up for the ZKProofport closed beta through the demo page.\n\n- Organization: ${betaOrg.trim()}\n- Platform: ${betaPlatform || 'Unknown'}\n- Requested via: Demo landing page (${betaPlatform || 'Unknown'} download button)\n\nPlease register this email as a tester on the corresponding platform (App Store Connect / Google Play Console) and send an invite.`,
          category: 'beta_invite',
          metadata: { platform: betaPlatform, organization: betaOrg.trim() },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error || 'Failed to submit request');
      }
      setBetaSuccess(true);
    } catch (err) {
      setBetaError((err as Error).message);
      setBetaSubmitting(false);
    }
  }, [betaEmail, betaOrg, betaPlatform]);

  const dashboardUrl = process.env.DASHBOARD_URL || '';

  /* ── Render helpers for demo cards ── */
  const renderDemoCard = (
    prefix: 'kyc' | 'country',
    state: DemoState,
  ) => {
    const isMobile = typeof window !== 'undefined' && isMobileDevice();

    // Callback status styles
    const callbackBaseStyle: React.CSSProperties = {
      marginTop: 16,
      padding: 16,
      borderRadius: 12,
      animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    };

    const waitingStyle: React.CSSProperties = {
      ...callbackBaseStyle,
      background: 'rgba(214, 177, 92, 0.1)',
      border: '1px solid rgba(214, 177, 92, 0.3)',
    };

    const failedStyle: React.CSSProperties = {
      ...callbackBaseStyle,
      background: 'rgba(248, 113, 113, 0.1)',
      border: '1px solid rgba(248, 113, 113, 0.3)',
    };

    const receivedStyle: React.CSSProperties = {
      ...callbackBaseStyle,
      background: state.receivedClass === 'duplicate'
        ? 'rgba(214, 177, 92, 0.1)'
        : 'rgba(52, 211, 153, 0.1)',
      border: state.receivedClass === 'duplicate'
        ? '1px solid rgba(214, 177, 92, 0.3)'
        : '1px solid rgba(52, 211, 153, 0.3)',
    };

    const receivedH4Color = state.receivedClass === 'duplicate' ? C.gold : '#34d399';

    // Verify result styles
    let verifyStyle: React.CSSProperties = {};
    if (state.verifyResultClass === 'verifying') {
      verifyStyle = {
        background: 'rgba(214, 177, 92, 0.1)',
        border: '1px solid rgba(214, 177, 92, 0.3)',
        color: C.gold,
      };
    } else if (state.verifyResultClass === 'success') {
      verifyStyle = {
        background: 'rgba(52, 211, 153, 0.15)',
        border: '1px solid rgba(52, 211, 153, 0.4)',
        color: '#34d399',
      };
    } else if (state.verifyResultClass === 'failure') {
      verifyStyle = {
        background: 'rgba(248, 113, 113, 0.15)',
        border: '1px solid rgba(248, 113, 113, 0.4)',
        color: '#f87171',
      };
    }

    return (
      <>
        {/* Result Panel */}
        {state.showResult && (
          <div style={{
            marginTop: 24,
            padding: 20,
            background: 'rgba(214, 177, 92, 0.06)',
            border: `1px solid ${C.goldLine}`,
            borderRadius: 12,
            animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}>
            <h4 style={{ fontSize: 16, marginBottom: 12, color: C.gold, fontFamily: FONT.mono, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>Request Generated</h4>

            {/* QR / Open App */}
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              {isMobile ? (
                <button
                  onClick={() => {
                    if (!state.deepLink) return;
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.src = state.deepLink;
                    document.body.appendChild(iframe);
                    setTimeout(() => document.body.removeChild(iframe), 1000);
                  }}
                  style={{
                    display: 'inline-block',
                    padding: '16px 32px',
                    background: `linear-gradient(180deg, ${C.gold}, ${C.gold2})`,
                    color: '#1a222c',
                    textDecoration: 'none',
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 18,
                    fontWeight: 700,
                    fontFamily: FONT.mono,
                    textAlign: 'center',
                    width: '100%',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                    transition: 'opacity 0.2s',
                  }}
                >
                  Open ZKProofport App
                </button>
              ) : state.qrHtml ? (
                <img
                  src={state.qrHtml}
                  alt="QR Code"
                  style={{ maxWidth: 200, borderRadius: 12, background: 'white', padding: 8 }}
                />
              ) : null}
            </div>



            {/* Waiting */}
            {state.showWaiting && (
              <div style={waitingStyle}>
                <h4 style={{ fontSize: 14, marginBottom: 8, color: C.gold, fontFamily: FONT.mono }}>
                  <Spinner />Waiting for proof...
                </h4>
                <p style={{ fontSize: 13, color: C.muted }}>
                  Scan the QR code with ZKProofport app to generate a proof
                </p>
              </div>
            )}

            {/* Failed */}
            {state.showFailed && (
              <div style={failedStyle}>
                <h4 style={{ fontSize: 14, marginBottom: 8, color: '#f87171', fontFamily: FONT.mono }}>Proof Failed</h4>
                <p style={{ fontSize: 13, color: C.muted }}>{state.failedReason}</p>
              </div>
            )}

            {/* Received */}
            {state.showReceived && (
              <div style={receivedStyle}>
                <h4 style={{ fontSize: 14, marginBottom: 8, color: receivedH4Color, fontFamily: FONT.mono }}>
                  {state.receivedClass === 'duplicate' ? '\u26A0\uFE0F ' : '\u2705 '}{state.receivedTitle}
                </h4>
                <pre style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: 8,
                  fontFamily: "'SF Mono', 'Monaco', 'Courier New', monospace",
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: C.ink,
                  maxHeight: 200,
                  overflowY: 'auto',
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap',
                }}>
                  {state.proofData}
                </pre>

                {/* Verify actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => handleVerifyProof(prefix, 'offchain')}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      color: 'white',
                      background: `linear-gradient(180deg, ${C.gold}, ${C.gold2})`,
                    }}
                  >
                    Off-Chain Verify
                  </button>
                  <button
                    onClick={() => handleVerifyProof(prefix, 'onchain')}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: 'rgba(255,255,255,.07)',
                      border: '1.5px solid rgba(255,255,255,.16)',
                      color: C.cream,
                    }}
                  >
                    On-Chain Verify
                  </button>
                  <button
                    onClick={() => handleCopyProof(prefix)}
                    style={{
                      marginTop: 0,
                      padding: '10px 20px',
                      fontSize: 13,
                      fontWeight: 600,
                      background: state.copyClass === 'copied'
                        ? 'rgba(255,255,255,.07)'
                        : 'rgba(52,211,153,.15)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {state.copyLabel}
                  </button>
                </div>

                {/* Verify result */}
                {state.showVerifyResult && (
                  <div style={{
                    marginTop: 12,
                    padding: '12px 16px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    ...verifyStyle,
                  }}>
                    {state.verifyResultClass === 'verifying' && <Spinner />}
                    {state.verifyResultContent}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  /* ── Plan badge color ── */
  const planBadgeStyle = (tier: string): React.CSSProperties => {
    const map: Record<string, React.CSSProperties> = {
      free: { background: 'rgba(52,211,153,0.15)', color: '#34d399' },
      credit: { background: 'rgba(214,177,92,0.15)', color: C.gold },
      plan1: { background: 'rgba(240,212,136,0.15)', color: C.gold2 },
      plan2: { background: 'rgba(214,177,92,0.15)', color: C.gold },
    };
    return {
      fontSize: 11,
      padding: '3px 8px',
      borderRadius: 6,
      fontWeight: 600,
      ...(map[tier] || map.free),
    };
  };

  /* ── Nav link style ── */
  const navLinkStyle = (hovered: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    color: C.cream,
    textDecoration: 'none',
    fontSize: '1.2rem',
    fontFamily: FONT.mono,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    padding: '0.6rem 1.2rem',
    border: `1.5px solid ${hovered ? C.gold : 'rgba(255,255,255,.16)'}`,
    borderRadius: 8,
    background: hovered ? 'rgba(214,177,92,.06)' : 'rgba(255,255,255,.07)',
    transition: 'all 0.2s',
    cursor: 'pointer',
  });

  /* ═════════════════════ RENDER ═════════════════════ */
  return (
    <>
      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES_CSS }} />

      {/* Noise & dot-matrix textures (matching portal-web) */}
      <div className="noise" aria-hidden="true" />
      <div className="dot-matrix" aria-hidden="true" />

      {/* Confetti container */}
      {confettiPieces.length > 0 && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 9999,
          overflow: 'hidden',
        }}>
          {confettiPieces.map((piece) => (
            <div
              key={piece.id}
              style={{
                position: 'absolute',
                top: -10,
                left: piece.left,
                width: piece.width,
                height: piece.height,
                background: piece.background,
                borderRadius: piece.borderRadius,
                opacity: 0,
                animation: `confettiFall ${piece.duration} ease-in forwards`,
                animationDelay: piece.delay,
              }}
            />
          ))}
        </div>
      )}

      {/* ── HEADER ── */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        minHeight: 64,
        backdropFilter: 'blur(10px)',
        background: 'linear-gradient(180deg, rgba(10,14,20,.85), rgba(10,14,20,.45))',
        borderBottom: `1px solid ${C.goldLine}`,
      }}>
        <div className="header-inner" style={{
          maxWidth: 1280,
          width: 'calc(100% - 2rem)',
          margin: '0 auto',
          padding: '16px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <img src="/logo.png" alt="" width={30} height={30} style={{ borderRadius: 8 }} />
            <span style={{
              fontFamily: FONT.mono,
              fontWeight: 700,
              letterSpacing: '0.04em',
              fontSize: 'clamp(1.3rem, 2.5vw, 1.7rem)',
              textTransform: 'uppercase' as const,
              color: C.cream,
            }}>ZKProofport</span>
          </div>

          {/* Nav (iOS/Android) */}
          <nav className="header-nav" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); openBetaModal('iOS'); }}
              title="Download on the App Store"
              style={navLinkStyle(iosHover)}
              onMouseEnter={() => setIosHover(true)}
              onMouseLeave={() => setIosHover(false)}
            >
              <AppleIcon /> iOS
            </a>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); openBetaModal('Android'); }}
              title="Get it on Google Play"
              style={navLinkStyle(androidHover)}
              onMouseEnter={() => setAndroidHover(true)}
              onMouseLeave={() => setAndroidHover(false)}
            >
              <AndroidIcon /> Android
            </a>
          </nav>

          {/* Auth section */}
          <div className="header-auth" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
            {showManualAuth && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {authenticated ? null : (
                  <>
                    <input
                      type="text"
                      value={authClientId}
                      onChange={(e) => setAuthClientId(e.target.value)}
                      placeholder="Client ID"
                      style={{
                        width: 120,
                        padding: '4px 8px',
                        fontSize: 12,
                        background: '#1e1e2e',
                        border: '1px solid #444',
                        borderRadius: 4,
                        color: '#eee',
                      }}
                    />
                    <input
                      type="password"
                      value={authApiKey}
                      onChange={(e) => setAuthApiKey(e.target.value)}
                      placeholder="API Key"
                      style={{
                        width: 120,
                        padding: '4px 8px',
                        fontSize: 12,
                        background: '#1e1e2e',
                        border: '1px solid #444',
                        borderRadius: 4,
                        color: '#eee',
                      }}
                    />
                    <button
                      onClick={handleAuthenticate}
                      disabled={authenticating}
                      style={{
                        padding: '4px 12px',
                        fontSize: 12,
                        background: C.gold,
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Login
                    </button>
                  </>
                )}
                {authenticated && (
                  <button
                    onClick={handleClearAuth}
                    style={{
                      padding: '4px 12px',
                      fontSize: 12,
                      background: '#444',
                      color: 'white',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Logout
                  </button>
                )}
              </span>
            )}
            {authStatus && (
              <span style={{ fontSize: 12, color: authStatusColor }}>{authStatus}</span>
            )}
            {planBadge.visible && (
              <span style={planBadgeStyle(planBadge.tier)}>
                {planBadge.tier.toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── LIVE DEMOS ── */}
      <section style={{ padding: '80px 0 60px', marginTop: 64 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ textAlign: 'center', fontFamily: FONT.serif, fontSize: 'clamp(2.8rem, 5vw, 4.5rem)', fontWeight: 400, marginBottom: 32, color: C.cream }}>
            Try it live.
          </h2>

          {/* All cards in one row: KYC + Country (large) + coming-soon grid (compact) */}
          <div className="demo-cards-row" style={{
            display: 'flex',
            gap: 20,
            alignItems: 'stretch',
          }}>

            {/* ── KYC Demo Card ── */}
            <div
              id="demo-kyc"
              onMouseEnter={() => setHoveredDemoCard('kyc')}
              onMouseLeave={() => setHoveredDemoCard(null)}
              style={{
                flex: '2 1 0',
                background: hoveredDemoCard === 'kyc' ? C.bgCardHover : C.bgCard,
                border: `1.5px solid ${C.goldLine}`,
                borderRadius: 0,
                padding: 36,
                transition: 'all 0.3s',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 36, filter: 'drop-shadow(0 4px 12px rgba(214, 177, 92, 0.3))' }}>
                  {'\uD83D\uDEE1\uFE0F'}
                </div>
                <span style={{
                  fontFamily: FONT.mono, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em',
                  padding: '4px 10px', borderRadius: 4,
                  background: 'rgba(52,211,153,0.15)', color: '#34d399',
                }}>LIVE</span>
              </div>
              <h3 style={{ fontFamily: FONT.serif, fontSize: '2rem', fontWeight: 400, marginBottom: 10, color: C.cream }}>KYC Verification</h3>
              <p style={{ color: C.muted, marginBottom: 20, fontFamily: FONT.mono, fontSize: '1.2rem', lineHeight: 1.6, flex: 1 }}>
                Prove Coinbase identity verification without revealing personal data.
              </p>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: '1.1rem', fontFamily: FONT.mono }}>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.gold2, display: 'block', marginBottom: 4, fontSize: '1rem', letterSpacing: '0.05em' }}>PROVE</strong>
                  <span style={{ color: C.muted }}>KYC completion</span>
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.gold2, display: 'block', marginBottom: 4, fontSize: '1rem', letterSpacing: '0.05em' }}>HIDE</strong>
                  <span style={{ color: C.muted }}>Personal identity</span>
                </div>
              </div>
              <button
                onClick={requestKycProof}
                onMouseEnter={() => setHoveredBtn('kyc-request')}
                onMouseLeave={() => setHoveredBtn(null)}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  fontFamily: FONT.mono,
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.25s',
                  background: `linear-gradient(180deg, ${C.gold}, ${C.gold2})`,
                  color: '#1a222c',
                  boxShadow: hoveredBtn === 'kyc-request'
                    ? '0 10px 28px rgba(214, 177, 92, 0.5), inset 0 1px 0 rgba(255,255,255,.8)'
                    : '0 6px 18px rgba(214, 177, 92, 0.3), inset 0 1px 0 rgba(255,255,255,.6)',
                  transform: hoveredBtn === 'kyc-request' ? 'translateY(-1px)' : 'none',
                }}
              >
                Request Proof
              </button>

            </div>

            {/* ── Country Demo Card ── */}
            <div
              id="demo-country"
              onMouseEnter={() => setHoveredDemoCard('country')}
              onMouseLeave={() => setHoveredDemoCard(null)}
              style={{
                flex: '2 1 0',
                background: hoveredDemoCard === 'country' ? C.bgCardHover : C.bgCard,
                border: `1.5px solid ${C.goldLine}`,
                borderRadius: 0,
                padding: 36,
                transition: 'all 0.3s',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 36, filter: 'drop-shadow(0 4px 12px rgba(214, 177, 92, 0.3))' }}>
                  {'\uD83C\uDF0D'}
                </div>
                <span style={{
                  fontFamily: FONT.mono, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em',
                  padding: '4px 10px', borderRadius: 4,
                  background: 'rgba(52,211,153,0.15)', color: '#34d399',
                }}>LIVE</span>
              </div>
              <h3 style={{ fontFamily: FONT.serif, fontSize: '2rem', fontWeight: 400, marginBottom: 10, color: C.cream }}>Country Attestation</h3>
              <p style={{ color: C.muted, marginBottom: 20, fontFamily: FONT.mono, fontSize: '1.2rem', lineHeight: 1.6, flex: 1 }}>
                Prove Coinbase country of residence eligibility without revealing exact location.
              </p>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: '1.1rem', fontFamily: FONT.mono }}>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.gold2, display: 'block', marginBottom: 4, fontSize: '1rem', letterSpacing: '0.05em' }}>PROVE</strong>
                  <span style={{ color: C.muted }}>Country eligibility</span>
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.gold2, display: 'block', marginBottom: 4, fontSize: '1rem', letterSpacing: '0.05em' }}>HIDE</strong>
                  <span style={{ color: C.muted }}>Exact location</span>
                </div>
              </div>

              {/* Country list input */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '1.1rem', fontWeight: 500, fontFamily: FONT.mono, color: C.ink }}>
                  Country List (ISO codes)
                </label>
                <input
                  type="text"
                  value={countryList}
                  onChange={(e) => setCountryList(e.target.value)}
                  placeholder="US,KR,JP,GB,FR"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 8,
                    color: C.white,
                    fontSize: '1.2rem',
                    fontFamily: FONT.mono,
                    transition: 'all 0.2s',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = C.gold;
                    e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                />
              </div>

              {/* List type toggle */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '1.1rem', fontWeight: 500, fontFamily: FONT.mono, color: C.ink }}>
                  List Type
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setIsIncluded(true)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: isIncluded ? C.gold : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${isIncluded ? C.gold : 'rgba(255, 255, 255, 0.1)'}`,
                      borderRadius: 6,
                      color: isIncluded ? '#1a222c' : C.muted,
                      fontSize: '1.1rem',
                      fontFamily: FONT.mono,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    Include
                  </button>
                  <button
                    onClick={() => setIsIncluded(false)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: !isIncluded ? C.gold : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${!isIncluded ? C.gold : 'rgba(255, 255, 255, 0.1)'}`,
                      borderRadius: 6,
                      color: !isIncluded ? '#1a222c' : C.muted,
                      fontSize: '1.1rem',
                      fontFamily: FONT.mono,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    Exclude
                  </button>
                </div>
              </div>

              <button
                onClick={requestCountryProof}
                onMouseEnter={() => setHoveredBtn('country-request')}
                onMouseLeave={() => setHoveredBtn(null)}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  fontFamily: FONT.mono,
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.25s',
                  background: `linear-gradient(180deg, ${C.gold}, ${C.gold2})`,
                  color: '#1a222c',
                  boxShadow: hoveredBtn === 'country-request'
                    ? '0 10px 28px rgba(214, 177, 92, 0.5), inset 0 1px 0 rgba(255,255,255,.8)'
                    : '0 6px 18px rgba(214, 177, 92, 0.3), inset 0 1px 0 rgba(255,255,255,.6)',
                  transform: hoveredBtn === 'country-request' ? 'translateY(-1px)' : 'none',
                }}
              >
                Request Proof
              </button>

            </div>

            {/* ── Coming-soon 3×2 grid beside live cards ── */}
            <div className="coming-soon-grid" style={{
              flex: '1 1 520px',
              minWidth: 280,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridTemplateRows: 'repeat(2, 1fr)',
              gap: 14,
            }}>
              {[
                { icon: '💰', title: 'DeFi Assets', desc: 'Prove holdings privately' },
                { icon: '🏢', title: 'RWA', desc: 'Prove asset ownership' },
                { icon: '🤖', title: 'Agent', desc: 'Prove agent identity' },
                { icon: '📧', title: 'Email Corp', desc: 'Prove company affiliation' },
                { icon: '𝕏', title: 'X Follow', desc: 'Prove social follows' },
                { icon: '🎂', title: 'Age', desc: 'Prove age eligibility' },
              ].map((item, i) => (
                <div key={i} style={{
                  background: C.bgCard,
                  border: `1.5px dashed rgba(214,177,92,0.3)`,
                  borderRadius: 0,
                  padding: '20px 14px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Subtle diagonal stripe overlay */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0.04,
                    backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(214,177,92,0.5) 8px, rgba(214,177,92,0.5) 9px)',
                    pointerEvents: 'none',
                  }} />
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{item.icon}</div>
                  <div style={{ fontFamily: FONT.mono, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em', color: C.gold, marginBottom: 6, background: 'rgba(214,177,92,0.1)', padding: '2px 8px', borderRadius: 3 }}>SOON</div>
                  <h4 style={{ fontFamily: FONT.serif, fontSize: '1.5rem', fontWeight: 400, margin: '0 0 6px', color: C.cream }}>{item.title}</h4>
                  <p style={{ color: 'rgba(232,220,200,0.55)', fontFamily: FONT.mono, fontSize: '1.1rem', lineHeight: 1.4, margin: 0 }}>{item.desc}</p>
                </div>
              ))}
            </div>

          </div>

        </div>
      </section>

      {/* ── SEPARATOR ── */}
      <div style={{ height: 1, maxWidth: 700, margin: '0 auto', background: 'linear-gradient(to right, transparent, rgba(214,177,92,0.15), transparent)' }} />

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '80px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ textAlign: 'center', fontFamily: FONT.serif, fontSize: 'clamp(2.8rem, 5vw, 4.5rem)', fontWeight: 400, marginBottom: 64, color: C.cream }}>
            Three simple steps.
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 32,
          }}>
            {[
              { num: 1, title: 'Request', desc: 'Your dApp creates a proof request via the ZKProofport SDK with specific verification requirements.' },
              { num: 2, title: 'Prove', desc: 'User generates a zero-knowledge proof on their mobile device using private credentials.' },
              { num: 3, title: 'Verify', desc: 'Your dApp verifies the cryptographic proof on-chain or off-chain without accessing personal data.' },
            ].map((step) => (
              <div
                key={step.num}
                onMouseEnter={() => setHoveredStep(step.num)}
                onMouseLeave={() => setHoveredStep(null)}
                style={{
                  background: hoveredStep === step.num ? C.bgCardHover : C.bgCard,
                  border: `1.5px solid ${C.goldLine}`,
                  borderRadius: 0,
                  padding: 40,
                  position: 'relative',
                  transition: 'all 0.3s',
                  transform: hoveredStep === step.num ? 'translateY(-2px)' : 'none',
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: -16,
                  left: 32,
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `linear-gradient(180deg, ${C.gold}, ${C.gold2})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  fontWeight: 700,
                  fontFamily: FONT.mono,
                  boxShadow: '0 4px 16px rgba(214, 177, 92, 0.4)',
                  color: '#1a222c',
                }}>
                  {step.num}
                </div>
                <h3 style={{ fontSize: 24, margin: '16px 0 12px', fontWeight: 600, fontFamily: FONT.serif, color: C.cream }}>{step.title}</h3>
                <p style={{ color: C.muted, fontSize: '1.4rem', fontFamily: FONT.mono, lineHeight: 1.7 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SEPARATOR ── */}
      <div style={{ height: 1, maxWidth: 700, margin: '0 auto', background: 'linear-gradient(to right, transparent, rgba(214,177,92,0.15), transparent)' }} />

      {/* ── CODE SECTION ── */}
      <section style={{ padding: '80px 0' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ textAlign: 'center', fontFamily: FONT.serif, fontSize: 'clamp(2.8rem, 5vw, 4.5rem)', fontWeight: 400, marginBottom: 16, color: C.cream }}>
            Get started in minutes.
          </h2>
          <p style={{ textAlign: 'center', fontFamily: FONT.mono, fontSize: '1.1rem', marginBottom: '3rem' }}>
            <a href="https://www.npmjs.com/package/@zkproofport-app/sdk" target="_blank" rel="noopener noreferrer" style={{ color: C.gold, textDecoration: 'underline', textUnderlineOffset: '4px' }}>@zkproofport-app/sdk on npm →</a>
          </p>
          <div style={{
            background: C.bgCard,
            border: `1.5px solid ${C.goldLine}`,
            borderRadius: 0,
            padding: 32,
            overflowX: 'auto',
            position: 'relative',
          }}>
            <span style={{
              position: 'absolute',
              top: 12,
              right: 20,
              fontSize: 12,
              color: C.muted,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              JavaScript
            </span>
            <pre style={{
              margin: 0,
              fontFamily: FONT.mono,
              fontSize: '1.3rem',
              lineHeight: 1.8,
              color: C.ink,
            }}>
              <span style={{ color: '#c586c0' }}>import</span>{' '}
              {'{ ProofportSDK }'}{' '}
              <span style={{ color: '#c586c0' }}>from</span>{' '}
              <span style={{ color: '#ce9178' }}>{`'@zkproofport-app/sdk'`}</span>;{'\n'}
              {'\n'}
              <span style={{ color: '#6a9955' }}>{'// Initialize SDK'}</span>{'\n'}
              <span style={{ color: '#569cd6' }}>const</span>{' '}sdk = ProofportSDK.<span style={{ color: '#dcdcaa' }}>create</span>();{'\n'}
              {'\n'}
              <span style={{ color: '#6a9955' }}>{'// Authenticate with your API credentials'}</span>{'\n'}
              <span style={{ color: '#c586c0' }}>await</span>{' '}sdk.<span style={{ color: '#dcdcaa' }}>login</span>{'({ clientId: '}<span style={{ color: '#ce9178' }}>{`'your-client-id'`}</span>{', apiKey: '}<span style={{ color: '#ce9178' }}>{`'your-api-key'`}</span>{' });'}{'\n'}
              {'\n'}
              <span style={{ color: '#6a9955' }}>{'// Create a proof request via relay'}</span>{'\n'}
              <span style={{ color: '#569cd6' }}>const</span>{' '}relay = <span style={{ color: '#c586c0' }}>await</span>{' '}sdk.<span style={{ color: '#dcdcaa' }}>createRelayRequest</span>(<span style={{ color: '#ce9178' }}>{`'coinbase_attestation'`}</span>{', {'}{'\n'}
              {'  scope: '}<span style={{ color: '#ce9178' }}>{`'myapp.com'`}</span>{'\n'}
              {'});'}{'\n'}
              {'\n'}
              <span style={{ color: '#6a9955' }}>{'// Generate QR code for desktop users'}</span>{'\n'}
              <span style={{ color: '#569cd6' }}>const</span>{' '}qrDataUrl = <span style={{ color: '#c586c0' }}>await</span>{' '}sdk.<span style={{ color: '#dcdcaa' }}>generateQRCode</span>{'(relay.deepLink);'}{'\n'}
              {'\n'}
              <span style={{ color: '#6a9955' }}>{'// Wait for proof via WebSocket'}</span>{'\n'}
              <span style={{ color: '#569cd6' }}>const</span>{' '}result = <span style={{ color: '#c586c0' }}>await</span>{' '}sdk.<span style={{ color: '#dcdcaa' }}>waitForProof</span>{'(relay.requestId);'}{'\n'}
              <span style={{ color: '#c586c0' }}>if</span>{' (result.status === '}<span style={{ color: '#ce9178' }}>{`'completed'`}</span>{') {'}{'\n'}
              {'  console.'}<span style={{ color: '#dcdcaa' }}>log</span>{'('}<span style={{ color: '#ce9178' }}>{`'Proof received:'`}</span>{', result.proof);'}{'\n'}
              {'}'}
            </pre>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        padding: '80px 0 40px',
        textAlign: 'center',
        borderTop: `1px solid ${C.goldLine}`,
        marginTop: 80,
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <p style={{ color: C.muted, fontFamily: FONT.mono, fontSize: '1.2rem', marginBottom: 16 }}>
            Privacy, proven. — ZKProofport
          </p>
          <a
            href="https://github.com/zkproofport"
            target="_blank"
            rel="noreferrer"
            style={{ color: C.gold, fontFamily: FONT.mono, fontSize: '1.2rem', textDecoration: 'none', borderBottom: '1px solid rgba(214,177,92,0.3)', transition: 'color 0.2s' }}
          >
            GitHub
          </a>
        </div>
      </footer>

      {/* ── PROOF MODAL ── */}
      {proofModalOpen && proofModalPrefix && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setProofModalOpen(false); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'betaFadeIn 0.2s ease-out',
            padding: 20,
          }}
        >
          <div style={{
            background: C.bgCard,
            border: `1.5px solid ${C.goldLine}`,
            borderRadius: 16,
            padding: 32,
            maxWidth: 480,
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            position: 'relative',
            animation: 'betaSlideUp 0.3s ease-out',
          }}>
            {/* Close button */}
            <button
              onClick={() => setProofModalOpen(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: C.muted,
                fontSize: 24,
                lineHeight: 1,
                padding: 4,
              }}
            >
              <CloseIcon />
            </button>
            {/* Title */}
            <h3 style={{
              fontFamily: FONT.serif,
              fontSize: '1.8rem',
              fontWeight: 400,
              color: C.cream,
              marginBottom: 8,
            }}>
              {proofModalPrefix === 'kyc' ? '🛡️ KYC Verification' : '🌍 Country Attestation'}
            </h3>
            <p style={{ fontFamily: FONT.mono, fontSize: '1rem', color: C.muted, marginBottom: 16 }}>
              {proofModalPrefix === 'kyc'
                ? 'Scan the QR code with ZKProofport app to generate a proof.'
                : 'Scan the QR code with ZKProofport app to prove country eligibility.'}
            </p>
            {renderDemoCard(proofModalPrefix, proofModalPrefix === 'kyc' ? kycState : countryState)}
          </div>
        </div>
      )}

      {/* ── BETA INVITE MODAL ── */}
      {betaOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeBetaModal(); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            animation: 'betaFadeIn 200ms ease-out',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              background: C.bgCard,
              border: `1.5px solid ${C.goldLine}`,
              borderRadius: 0,
              overflow: 'hidden',
              animation: 'betaSlideUp 300ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px 24px 0',
            }}>
              <h3 style={{ fontFamily: FONT.serif, fontSize: '2rem', fontWeight: 400, color: C.cream, margin: 0 }}>Closed Beta</h3>
              <button
                onClick={closeBetaModal}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.muted,
                  cursor: 'pointer',
                  padding: 4,
                  lineHeight: 1,
                }}
              >
                <CloseIcon />
              </button>
            </div>

            {/* Modal body */}
            <div style={{ padding: '16px 24px 24px' }}>
              <p style={{ color: C.muted, fontFamily: FONT.mono, fontSize: '1.2rem', lineHeight: 1.7, margin: '0 0 20px' }}>
                ZKProofport is currently in closed beta testing. Leave your email and preferred platform — we{"'"}ll send you an invite as soon as a spot opens up.
              </p>

              {/* Email */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.ink, marginBottom: 6 }}>
                  Email *
                </label>
                <input
                  type="email"
                  value={betaEmail}
                  onChange={(e) => setBetaEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: 14,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    color: '#fff',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = C.gold2; }}
                  onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
              </div>

              {/* Organization */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.ink, marginBottom: 6 }}>
                  Organization *
                </label>
                <input
                  type="text"
                  value={betaOrg}
                  onChange={(e) => setBetaOrg(e.target.value)}
                  placeholder="Company or team name"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: 14,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    color: '#fff',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = C.gold2; }}
                  onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
              </div>

              {/* Platform */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.ink, marginBottom: 6 }}>
                  Platform
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['iOS', 'Android', 'Both'].map((plat) => (
                    <button
                      key={plat}
                      onClick={() => setBetaPlatformState(plat)}
                      style={{
                        flex: 1,
                        padding: '8px 0',
                        fontSize: 13,
                        fontWeight: 500,
                        background: betaPlatform === plat ? 'rgba(214, 177, 92, 0.12)' : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${betaPlatform === plat ? C.gold2 : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 8,
                        color: betaPlatform === plat ? C.gold2 : C.muted,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {plat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              {!betaSuccess && (
                <button
                  onClick={submitBetaRequest}
                  disabled={betaSubmitting}
                  style={{
                    width: '100%',
                    padding: 12,
                    fontSize: '1.3rem',
                    fontWeight: 700,
                    fontFamily: FONT.mono,
                    background: `linear-gradient(180deg, ${C.gold}, ${C.gold2})`,
                    color: '#1a222c',
                    border: 'none',
                    borderRadius: 8,
                    cursor: betaSubmitting ? 'not-allowed' : 'pointer',
                    marginTop: 8,
                    transition: 'opacity 0.15s',
                    opacity: betaSubmitting ? 0.5 : 1,
                    boxShadow: '0 8px 20px rgba(214,177,92,.35), inset 0 1px 0 rgba(255,255,255,.6)',
                  }}
                >
                  Request Invite
                </button>
              )}

              {/* Success */}
              {betaSuccess && (
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(52,211,153,0.1)',
                  border: '1px solid rgba(52,211,153,0.2)',
                  borderRadius: 8,
                  color: '#34d399',
                  fontSize: '1.2rem',
                  fontFamily: FONT.mono,
                  textAlign: 'center',
                }}>
                  Thanks! We{"'"}ll reach out when your invite is ready.
                </div>
              )}

              {/* Error */}
              {betaError && (
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(248,113,113,0.1)',
                  border: '1px solid rgba(248,113,113,0.2)',
                  borderRadius: 8,
                  color: '#f87171',
                  fontSize: '1.2rem',
                  fontFamily: FONT.mono,
                  textAlign: 'center',
                }}>
                  {betaError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
