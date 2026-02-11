'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createSDK } from '@/lib/sdk';
import type { ProofportSDK as ProofportSDKType, AuthToken, RelayProofResult, ProofResponse } from '@zkproofport-app/sdk';

/* ─── Color tokens (mirrors CSS custom properties from the HTML) ─── */
const C = {
  navyDeep: '#0a0f1e',
  navyMid: '#131a2f',
  navyLight: '#1a2440',
  blue: '#2563eb',
  purple: '#7c3aed',
  cyan: '#06b6d4',
  white: '#ffffff',
  gray100: '#f3f4f6',
  gray300: '#cbd5e1',
  gray400: '#94a3b8',
  gray600: '#64748b',
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
        border: '2px solid rgba(234, 179, 8, 0.3)',
        borderTopColor: '#eab308',
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
      setAuthStatusColor(C.gray400);
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
  }, [getSDK, showProofResult, showProofReceived, showProofFailed, showProofTimeout]);

  /* ── Country request ── */
  const requestCountryProof = useCallback(async () => {
    const countries = countryList.split(',').map(c => c.trim().toUpperCase()).filter(c => c);

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
  }, [countryList, isIncluded, getSDK, showProofResult, showProofReceived, showProofFailed, showProofTimeout]);

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
      background: 'rgba(234, 179, 8, 0.1)',
      border: '1px solid rgba(234, 179, 8, 0.3)',
    };

    const failedStyle: React.CSSProperties = {
      ...callbackBaseStyle,
      background: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
    };

    const receivedStyle: React.CSSProperties = {
      ...callbackBaseStyle,
      background: state.receivedClass === 'duplicate'
        ? 'rgba(234, 179, 8, 0.1)'
        : 'rgba(34, 197, 94, 0.1)',
      border: state.receivedClass === 'duplicate'
        ? '1px solid rgba(234, 179, 8, 0.3)'
        : '1px solid rgba(34, 197, 94, 0.3)',
    };

    const receivedH4Color = state.receivedClass === 'duplicate' ? '#eab308' : '#22c55e';

    // Verify result styles
    let verifyStyle: React.CSSProperties = {};
    if (state.verifyResultClass === 'verifying') {
      verifyStyle = {
        background: 'rgba(234, 179, 8, 0.1)',
        border: '1px solid rgba(234, 179, 8, 0.3)',
        color: '#eab308',
      };
    } else if (state.verifyResultClass === 'success') {
      verifyStyle = {
        background: 'rgba(34, 197, 94, 0.15)',
        border: '1px solid rgba(34, 197, 94, 0.4)',
        color: '#22c55e',
      };
    } else if (state.verifyResultClass === 'failure') {
      verifyStyle = {
        background: 'rgba(239, 68, 68, 0.15)',
        border: '1px solid rgba(239, 68, 68, 0.4)',
        color: '#ef4444',
      };
    }

    return (
      <>
        {/* Result Panel */}
        {state.showResult && (
          <div style={{
            marginTop: 24,
            padding: 20,
            background: 'rgba(6, 182, 212, 0.1)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            borderRadius: 12,
            animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}>
            <h4 style={{ fontSize: 16, marginBottom: 12, color: C.cyan }}>Request Generated</h4>

            {/* QR / Open App */}
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              {isMobile ? (
                <a
                  href={state.deepLink || '#'}
                  style={{
                    display: 'inline-block',
                    padding: '16px 32px',
                    background: `linear-gradient(135deg, ${C.purple}, ${C.cyan})`,
                    color: 'white',
                    textDecoration: 'none',
                    borderRadius: 12,
                    fontSize: 18,
                    fontWeight: 600,
                    textAlign: 'center',
                    width: '100%',
                    boxSizing: 'border-box',
                    transition: 'opacity 0.2s',
                  }}
                >
                  Open ZKProofport App
                </a>
              ) : state.qrHtml ? (
                <img
                  src={state.qrHtml}
                  alt="QR Code"
                  style={{ maxWidth: 200, borderRadius: 12, background: 'white', padding: 8 }}
                />
              ) : null}
            </div>

            {/* Deep link text (desktop only) */}
            {!isMobile && state.deepLink && (
              <div style={{
                marginTop: 12,
                padding: 12,
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: 8,
                fontFamily: "'Courier New', monospace",
                fontSize: 12,
                wordBreak: 'break-all',
                color: C.gray300,
              }}>
                {state.deepLink}
              </div>
            )}

            {/* Waiting */}
            {state.showWaiting && (
              <div style={waitingStyle}>
                <h4 style={{ fontSize: 14, marginBottom: 8, color: '#eab308' }}>
                  <Spinner />Waiting for proof...
                </h4>
                <p style={{ fontSize: 13, color: C.gray400 }}>
                  Scan the QR code with ZKProofport app to generate a proof
                </p>
              </div>
            )}

            {/* Failed */}
            {state.showFailed && (
              <div style={failedStyle}>
                <h4 style={{ fontSize: 14, marginBottom: 8, color: '#ef4444' }}>Proof Failed</h4>
                <p style={{ fontSize: 13, color: C.gray400 }}>{state.failedReason}</p>
              </div>
            )}

            {/* Received */}
            {state.showReceived && (
              <div style={receivedStyle}>
                <h4 style={{ fontSize: 14, marginBottom: 8, color: receivedH4Color }}>
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
                  color: C.gray300,
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
                      background: `linear-gradient(135deg, ${C.cyan}, #0891b2)`,
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
                      border: 'none',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      color: 'white',
                      background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
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
                        ? `linear-gradient(135deg, ${C.gray600}, ${C.gray400})`
                        : 'linear-gradient(135deg, #22c55e, #16a34a)',
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
      free: { background: 'rgba(34,197,94,0.15)', color: '#22c55e' },
      credit: { background: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
      plan1: { background: 'rgba(168,85,247,0.15)', color: '#a855f7' },
      plan2: { background: 'rgba(234,179,8,0.15)', color: '#eab308' },
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
    color: C.gray300,
    textDecoration: 'none',
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    border: `1px solid ${hovered ? C.cyan : C.gray600}`,
    borderRadius: 6,
    transition: 'border-color 0.2s',
    cursor: 'pointer',
  });

  /* ═════════════════════ RENDER ═════════════════════ */
  return (
    <>
      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES_CSS }} />

      {/* Background gradient mesh */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: `
          radial-gradient(circle at 20% 30%, rgba(37, 99, 235, 0.15) 0%, transparent 50%),
          radial-gradient(circle at 80% 70%, rgba(124, 58, 237, 0.15) 0%, transparent 50%)
        `,
        pointerEvents: 'none',
        zIndex: -1,
      }} />

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
      <header style={{ padding: '32px 0', position: 'relative' }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          {/* Logo */}
          <div style={{
            fontSize: 32,
            fontWeight: 700,
            background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
          }}>
            ZKProofport
          </div>

          {/* Auth section */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                        background: C.blue,
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

          {/* Nav */}
          <nav style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
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
        </div>
      </header>

      {/* ── HERO ── */}
      <section style={{ textAlign: 'center', padding: '80px 0 120px', position: 'relative' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{
            fontSize: 28,
            fontWeight: 600,
            marginBottom: 16,
            background: `linear-gradient(135deg, ${C.blue}, ${C.cyan})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Privacy-First Identity Verification
          </div>
          <h1 style={{
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.1,
            marginBottom: 24,
            letterSpacing: '-0.03em',
            background: `linear-gradient(135deg, ${C.white}, ${C.gray300})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Prove who you are<br />without revealing who you are
          </h1>
          <p style={{
            fontSize: 20,
            color: C.gray400,
            marginBottom: 48,
            maxWidth: 600,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Zero-knowledge proofs for identity verification. Verify credentials without exposing personal data.
          </p>
          <p style={{ color: C.gray400, fontSize: '0.95rem', marginTop: '1rem', marginBottom: '1.5rem' }}>
            See live integration example:{' '}
            <a href="/zkpswap" style={{ color: C.cyan, textDecoration: 'underline' }}>ZKPSwap</a>{' '}
            demonstrates a compliant DEX using ZK proofs.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a
              href="#demo-kyc"
              onClick={(e) => { e.preventDefault(); scrollTo('demo-kyc'); }}
              onMouseEnter={() => setHoveredBtn('hero-kyc')}
              onMouseLeave={() => setHoveredBtn(null)}
              style={{
                padding: '16px 32px',
                fontSize: 16,
                fontWeight: 600,
                border: 'none',
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textDecoration: 'none',
                display: 'inline-block',
                background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
                color: C.white,
                boxShadow: hoveredBtn === 'hero-kyc'
                  ? '0 12px 32px rgba(37, 99, 235, 0.4)'
                  : '0 8px 24px rgba(37, 99, 235, 0.3)',
                transform: hoveredBtn === 'hero-kyc' ? 'translateY(-2px)' : 'none',
              }}
            >
              Try KYC Demo
            </a>
            <a
              href="#demo-country"
              onClick={(e) => { e.preventDefault(); scrollTo('demo-country'); }}
              onMouseEnter={() => setHoveredBtn('hero-country')}
              onMouseLeave={() => setHoveredBtn(null)}
              style={{
                padding: '16px 32px',
                fontSize: 16,
                fontWeight: 600,
                border: 'none',
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textDecoration: 'none',
                display: 'inline-block',
                background: 'rgba(255, 255, 255, 0.1)',
                color: C.white,
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                transform: hoveredBtn === 'hero-country' ? 'translateY(-2px)' : 'none',
              }}
            >
              Try Country Demo
            </a>
            <a
              href="/zkpswap"
              onMouseEnter={() => setHoveredBtn('hero-zkpswap')}
              onMouseLeave={() => setHoveredBtn(null)}
              style={{
                padding: '16px 32px',
                fontSize: 16,
                fontWeight: 600,
                border: 'none',
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textDecoration: 'none',
                display: 'inline-block',
                background: 'rgba(255, 255, 255, 0.1)',
                color: C.white,
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                transform: hoveredBtn === 'hero-zkpswap' ? 'translateY(-2px)' : 'none',
              }}
            >
              ZKPSwap
            </a>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: '80px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ textAlign: 'center', fontSize: 48, fontWeight: 700, marginBottom: 64, letterSpacing: '-0.02em' }}>
            How It Works
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 32,
            marginBottom: 80,
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
                  background: hoveredStep === step.num ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: `1px solid ${hoveredStep === step.num ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)'}`,
                  borderRadius: 24,
                  padding: 40,
                  position: 'relative',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: hoveredStep === step.num ? 'translateY(-4px)' : 'none',
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: -16,
                  left: 32,
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  fontWeight: 700,
                  boxShadow: '0 4px 16px rgba(37, 99, 235, 0.4)',
                  color: C.white,
                }}>
                  {step.num}
                </div>
                <h3 style={{ fontSize: 24, margin: '16px 0 12px', fontWeight: 600 }}>{step.title}</h3>
                <p style={{ color: C.gray400, fontSize: 16 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LIVE DEMOS ── */}
      <section style={{ padding: '80px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ textAlign: 'center', fontSize: 48, fontWeight: 700, marginBottom: 64, letterSpacing: '-0.02em' }}>
            Live Demos
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 700, margin: '0 auto' }}>

            {/* ── KYC Demo Card ── */}
            <div
              id="demo-kyc"
              onMouseEnter={() => setHoveredDemoCard('kyc')}
              onMouseLeave={() => setHoveredDemoCard(null)}
              style={{
                background: hoveredDemoCard === 'kyc' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: `1px solid ${hoveredDemoCard === 'kyc' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)'}`,
                borderRadius: 24,
                padding: 40,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div style={{ fontSize: 48, filter: 'drop-shadow(0 4px 12px rgba(37, 99, 235, 0.4))' }}>
                  {'\uD83D\uDEE1\uFE0F'}
                </div>
                <div>
                  <h3 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Coinbase KYC Verification</h3>
                </div>
              </div>
              <p style={{ color: C.gray400, marginBottom: 24, fontSize: 15 }}>
                Prove your Coinbase identity verification status without revealing your personal information.
              </p>
              <div style={{ display: 'flex', gap: 24, marginBottom: 24, fontSize: 14 }}>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.cyan, display: 'block', marginBottom: 4 }}>Prove</strong>
                  KYC completion
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.cyan, display: 'block', marginBottom: 4 }}>Hide</strong>
                  Personal identity
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button
                  onClick={requestKycProof}
                  onMouseEnter={() => setHoveredBtn('kyc-request')}
                  onMouseLeave={() => setHoveredBtn(null)}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
                    color: C.white,
                    boxShadow: hoveredBtn === 'kyc-request'
                      ? '0 12px 32px rgba(37, 99, 235, 0.4)'
                      : '0 8px 24px rgba(37, 99, 235, 0.3)',
                    transform: hoveredBtn === 'kyc-request' ? 'translateY(-2px)' : 'none',
                  }}
                >
                  Request Proof
                </button>
              </div>
              {renderDemoCard('kyc', kycState)}
            </div>

            {/* ── Country Demo Card ── */}
            <div
              id="demo-country"
              onMouseEnter={() => setHoveredDemoCard('country')}
              onMouseLeave={() => setHoveredDemoCard(null)}
              style={{
                background: hoveredDemoCard === 'country' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: `1px solid ${hoveredDemoCard === 'country' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)'}`,
                borderRadius: 24,
                padding: 40,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div style={{ fontSize: 48, filter: 'drop-shadow(0 4px 12px rgba(37, 99, 235, 0.4))' }}>
                  {'\uD83C\uDF0D'}
                </div>
                <div>
                  <h3 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Coinbase Country Attestation</h3>
                </div>
              </div>
              <p style={{ color: C.gray400, marginBottom: 24, fontSize: 15 }}>
                Prove your country of residence eligibility without revealing your exact location.
              </p>
              <div style={{ display: 'flex', gap: 24, marginBottom: 24, fontSize: 14 }}>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.cyan, display: 'block', marginBottom: 4 }}>Prove</strong>
                  Country eligibility
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ color: C.cyan, display: 'block', marginBottom: 4 }}>Hide</strong>
                  Exact location
                </div>
              </div>

              {/* Country list input */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500, color: C.gray300 }}>
                  Country List (comma-separated ISO codes)
                </label>
                <input
                  type="text"
                  value={countryList}
                  onChange={(e) => setCountryList(e.target.value)}
                  placeholder="US,KR,JP,GB,FR"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 12,
                    color: C.white,
                    fontSize: 14,
                    transition: 'all 0.2s',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = C.blue;
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
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500, color: C.gray300 }}>
                  List Type
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => setIsIncluded(true)}
                    style={{
                      flex: 1,
                      padding: '8px 16px',
                      background: isIncluded ? C.blue : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${isIncluded ? C.blue : 'rgba(255, 255, 255, 0.1)'}`,
                      borderRadius: 8,
                      color: isIncluded ? C.white : C.gray400,
                      fontSize: 14,
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
                      padding: '8px 16px',
                      background: !isIncluded ? C.blue : 'rgba(255, 255, 255, 0.05)',
                      border: `1px solid ${!isIncluded ? C.blue : 'rgba(255, 255, 255, 0.1)'}`,
                      borderRadius: 8,
                      color: !isIncluded ? C.white : C.gray400,
                      fontSize: 14,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    Exclude
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button
                  onClick={requestCountryProof}
                  onMouseEnter={() => setHoveredBtn('country-request')}
                  onMouseLeave={() => setHoveredBtn(null)}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: 12,
                    cursor: 'pointer',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
                    color: C.white,
                    boxShadow: hoveredBtn === 'country-request'
                      ? '0 12px 32px rgba(37, 99, 235, 0.4)'
                      : '0 8px 24px rgba(37, 99, 235, 0.3)',
                    transform: hoveredBtn === 'country-request' ? 'translateY(-2px)' : 'none',
                  }}
                >
                  Request Proof
                </button>
              </div>
              {renderDemoCard('country', countryState)}
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ padding: '80px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ textAlign: 'center', fontSize: 48, fontWeight: 700, marginBottom: 64, letterSpacing: '-0.02em' }}>
            Why ZKProofport?
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 32,
          }}>
            {[
              { icon: '\uD83D\uDD12', title: 'Zero Knowledge', desc: "No personal data leaves the user's device. Verify credentials cryptographically." },
              { icon: '\u26D3\uFE0F', title: 'On-Chain Verified', desc: 'Proofs are verified by smart contracts on Base network for trustless verification.' },
              { icon: '\uD83D\uDCF1', title: 'Mobile Native', desc: 'Optimized for mobile proof generation with iOS and Android support.' },
              { icon: '\uD83C\uDF10', title: 'Open Source', desc: 'Fully auditable SDK and circuits built with cutting-edge cryptographic technology.' },
            ].map((feature, idx) => (
              <div
                key={idx}
                onMouseEnter={() => setHoveredFeature(idx)}
                onMouseLeave={() => setHoveredFeature(null)}
                style={{
                  textAlign: 'center',
                  padding: 32,
                  background: hoveredFeature === idx ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  border: `1px solid ${hoveredFeature === idx ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)'}`,
                  borderRadius: 20,
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: hoveredFeature === idx ? 'translateY(-4px)' : 'none',
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 16, filter: 'drop-shadow(0 4px 12px rgba(124, 58, 237, 0.4))' }}>
                  {feature.icon}
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>{feature.title}</h3>
                <p style={{ color: C.gray400, fontSize: 14 }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CODE SECTION ── */}
      <section style={{ padding: '80px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <h2 style={{ textAlign: 'center', fontSize: 48, fontWeight: 700, marginBottom: 64, letterSpacing: '-0.02em' }}>
            Quick Integration
          </h2>
          <p style={{ textAlign: 'center', color: C.gray400, fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            SDK is currently being prepared for public release. Stay tuned!
          </p>
          <div style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 16,
            padding: 32,
            overflowX: 'auto',
            position: 'relative',
          }}>
            <span style={{
              position: 'absolute',
              top: 12,
              right: 20,
              fontSize: 12,
              color: C.gray600,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              JavaScript
            </span>
            <pre style={{
              margin: 0,
              fontFamily: "'SF Mono', 'Monaco', 'Courier New', monospace",
              fontSize: 14,
              lineHeight: 1.8,
              color: C.gray300,
            }}>
              <span style={{ color: C.purple }}>import</span>{' '}
              {'{ ProofportSDK }'}{' '}
              <span style={{ color: C.purple }}>from</span>{' '}
              <span style={{ color: C.cyan }}>{`'@zkproofport-app/sdk'`}</span>;{'\n'}
              {'\n'}
              <span style={{ color: C.gray600 }}>{'// Initialize SDK'}</span>{'\n'}
              <span style={{ color: C.purple }}>const</span>{' '}sdk = ProofportSDK.<span style={{ color: C.blue }}>create</span>();{'\n'}
              {'\n'}
              <span style={{ color: C.gray600 }}>{'// Authenticate with your API credentials'}</span>{'\n'}
              <span style={{ color: C.purple }}>await</span>{' '}sdk.<span style={{ color: C.blue }}>login</span>{'({ clientId: '}<span style={{ color: C.cyan }}>{`'your-client-id'`}</span>{', apiKey: '}<span style={{ color: C.cyan }}>{`'your-api-key'`}</span>{' });'}{'\n'}
              {'\n'}
              <span style={{ color: C.gray600 }}>{'// Create a proof request via relay'}</span>{'\n'}
              <span style={{ color: C.purple }}>const</span>{' '}relay = <span style={{ color: C.purple }}>await</span>{' '}sdk.<span style={{ color: C.blue }}>createRelayRequest</span>(<span style={{ color: C.cyan }}>{`'coinbase_attestation'`}</span>{', {'}{'\n'}
              {'  scope: '}<span style={{ color: C.cyan }}>{`'myapp.com'`}</span>{'\n'}
              {'});'}{'\n'}
              {'\n'}
              <span style={{ color: C.gray600 }}>{'// Generate QR code for desktop users'}</span>{'\n'}
              <span style={{ color: C.purple }}>const</span>{' '}qrDataUrl = <span style={{ color: C.purple }}>await</span>{' '}sdk.<span style={{ color: C.blue }}>generateQRCode</span>{'(relay.deepLink);'}{'\n'}
              {'\n'}
              <span style={{ color: C.gray600 }}>{'// Wait for proof via WebSocket'}</span>{'\n'}
              <span style={{ color: C.purple }}>const</span>{' '}result = <span style={{ color: C.purple }}>await</span>{' '}sdk.<span style={{ color: C.blue }}>waitForProof</span>{'(relay.requestId);'}{'\n'}
              <span style={{ color: C.purple }}>if</span>{' (result.status === '}<span style={{ color: C.cyan }}>{`'completed'`}</span>{') {'}{'\n'}
              {'  console.'}<span style={{ color: C.blue }}>log</span>{'('}<span style={{ color: C.cyan }}>{`'Proof received:'`}</span>{', result.proof);'}{'\n'}
              {'}'}
            </pre>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        padding: '80px 0 40px',
        textAlign: 'center',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        marginTop: 80,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <p style={{ color: C.gray400, marginBottom: 16 }}>
            Built with zero-knowledge proofs by ZKProofport
          </p>
          <a
            href="https://github.com/zkproofport"
            target="_blank"
            rel="noreferrer"
            style={{ color: C.blue, textDecoration: 'none', transition: 'color 0.2s' }}
          >
            GitHub
          </a>
        </div>
      </footer>

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
              background: C.navyMid,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 16,
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
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#fff', margin: 0 }}>Closed Beta</h3>
              <button
                onClick={closeBetaModal}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.gray400,
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
              <p style={{ color: C.gray400, fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
                ZKProofport is currently in closed beta testing. Leave your email and preferred platform — we{"'"}ll send you an invite as soon as a spot opens up.
              </p>

              {/* Email */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.gray300, marginBottom: 6 }}>
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
                  onFocus={(e) => { e.target.style.borderColor = C.cyan; }}
                  onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
              </div>

              {/* Organization */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.gray300, marginBottom: 6 }}>
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
                  onFocus={(e) => { e.target.style.borderColor = C.cyan; }}
                  onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
              </div>

              {/* Platform */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.gray300, marginBottom: 6 }}>
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
                        background: betaPlatform === plat ? 'rgba(0, 212, 255, 0.08)' : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${betaPlatform === plat ? C.cyan : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 8,
                        color: betaPlatform === plat ? C.cyan : C.gray400,
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
                    padding: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    background: C.cyan,
                    color: '#000',
                    border: 'none',
                    borderRadius: 8,
                    cursor: betaSubmitting ? 'not-allowed' : 'pointer',
                    marginTop: 8,
                    transition: 'opacity 0.15s',
                    opacity: betaSubmitting ? 0.5 : 1,
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
                  background: 'rgba(34,197,94,0.1)',
                  border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 8,
                  color: '#22c55e',
                  fontSize: 13,
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
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 8,
                  color: '#ef4444',
                  fontSize: 13,
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
