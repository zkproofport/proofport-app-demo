'use client';

import { useState, useRef, useCallback } from 'react';
import { createSDK } from '@/lib/sdk';
import type { ProofportSDK as ProofportSDKType } from '@zkproofport-app/sdk';

type AuthToken = {
  token: string;
  clientId: string;
  dappId: string;
  tier: string;
  expiresIn: number;
  expiresAt: number;
};

type RelayRequest = {
  requestId: string;
  deepLink: string;
  circuit?: string;
  status?: string;
  pollUrl?: string;
};

export default function DemoPage() {
  const sdkRef = useRef<ProofportSDKType | null>(null);
  const [activeTab, setActiveTab] = useState<'kyc' | 'country'>('kyc');
  const [authToken, setAuthToken] = useState<AuthToken | null>(null);
  const credentialsRef = useRef<{ clientId: string; apiKey: string } | null>(null);
  const [authStatus, setAuthStatus] = useState('');
  const [authStatusColor, setAuthStatusColor] = useState('#666');
  const [authenticating, setAuthenticating] = useState(false);

  // Form fields
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [kycDappName, setKycDappName] = useState('');
  const [kycMessage, setKycMessage] = useState('');
  const [countryList, setCountryList] = useState('US,KR,JP');
  const [isIncluded, setIsIncluded] = useState(true);
  const [countryDappName, setCountryDappName] = useState('');
  const [countryMessage, setCountryMessage] = useState('');

  // Result state
  const [showResult, setShowResult] = useState(false);
  const [resultRequestId, setResultRequestId] = useState('');
  const [resultCircuit, setResultCircuit] = useState('');
  const [resultDeepLink, setResultDeepLink] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [statusText, setStatusText] = useState('Waiting for proof...');
  const [statusColor, setStatusColor] = useState('#f59e0b');
  const [proofReceived, setProofReceived] = useState(false);
  const [resultNullifier, setResultNullifier] = useState('');
  const [resultPublicInputs, setResultPublicInputs] = useState('');
  const [resultProof, setResultProof] = useState('');

  const currentRelayRef = useRef<RelayRequest | null>(null);

  const getSDK = useCallback(() => {
    if (!sdkRef.current) {
      sdkRef.current = createSDK();
    }
    return sdkRef.current;
  }, []);

  const handleAuthenticate = async () => {
    if (!clientId || !apiKey) {
      setAuthStatus('Both fields required');
      setAuthStatusColor('#ef4444');
      return;
    }

    try {
      setAuthenticating(true);
      setAuthStatus('Authenticating...');
      setAuthStatusColor('#f59e0b');

      const sdk = getSDK();
      credentialsRef.current = { clientId, apiKey };
      const token = await sdk.login({ clientId, apiKey });
      setAuthToken(token as AuthToken);
      setAuthStatus('Authenticated');
      setAuthStatusColor('#22c55e');
      console.log('Authenticated:', token);
    } catch (err) {
      setAuthStatus('Auth failed: ' + (err as Error).message);
      setAuthStatusColor('#ef4444');
      console.error('Authentication failed:', err);
    } finally {
      setAuthenticating(false);
    }
  };

  const handleClearAuth = () => {
    setAuthToken(null);
    setClientId('');
    setApiKey('');
    setAuthStatus('');
    credentialsRef.current = null;
    const sdk = sdkRef.current;
    if (sdk) sdk.logout();
  };

  const ensureAuth = async (): Promise<boolean> => {
    const creds = credentialsRef.current;
    if (!creds) return false;
    try {
      const sdk = getSDK();
      const token = await sdk.login(creds);
      setAuthToken(token as AuthToken);
      setAuthStatus('Authenticated');
      setAuthStatusColor('#22c55e');
      console.log('[Re-auth] Success');
      return true;
    } catch (err) {
      console.error('[Re-auth] Failed:', err);
      return false;
    }
  };

  const displayResult = async (relayRequest: RelayRequest) => {
    setResultRequestId(relayRequest.requestId);
    setResultCircuit(relayRequest.circuit || 'N/A');
    setResultDeepLink(relayRequest.deepLink);

    const sdk = getSDK();
    const dataUrl = await sdk.generateQRCode(relayRequest.deepLink, { width: 300 });
    setQrDataUrl(dataUrl);

    setShowResult(true);
    setStatusText('Waiting for proof...');
    setStatusColor('#f59e0b');
    setProofReceived(false);
  };

  const waitForProof = async (requestId: string) => {
    try {
      console.log('[waitForProof] Starting to wait for:', requestId);
      const sdk = getSDK();

      const result = await sdk.waitForProof(requestId, {
        onStatusChange: (statusUpdate: { status: string }) => {
          console.log('[waitForProof] Status update:', statusUpdate);
          if (statusUpdate.status === 'pending') {
            setStatusText('Pending...');
            setStatusColor('#f59e0b');
          } else if (statusUpdate.status === 'processing') {
            setStatusText('Processing...');
            setStatusColor('#3b82f6');
          }
        },
        timeoutMs: 300000,
      });

      console.log('[waitForProof] Proof received:', result);

      setStatusText('Proof completed!');
      setStatusColor('#22c55e');

      const nullifier = result.nullifier || (result.publicInputs && result.publicInputs[0]) || 'N/A';
      setResultNullifier(nullifier);
      setResultPublicInputs(result.publicInputs ? String(result.publicInputs.length) : '0');
      setResultProof(result.proof || 'N/A');
      setProofReceived(true);
    } catch (err) {
      console.error('[waitForProof] Error:', err);
      setStatusText('Failed: ' + (err as Error).message);
      setStatusColor('#ef4444');
    }
  };

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) {
      const reauthed = await ensureAuth();
      if (!reauthed) return;
    }

    try {
      const sdk = getSDK();
      const options: Record<string, string> = {};
      if (kycDappName) options.dappName = kycDappName;
      if (kycMessage) options.message = kycMessage;

      const relay = await sdk.createRelayRequest('coinbase_attestation', { scope: 'zkproofport:demo' }, options);
      currentRelayRef.current = relay;
      await displayResult(relay);
      await waitForProof(relay.requestId);
    } catch (err) {
      if ((err as Error).message.includes('Not authenticated')) {
        console.error('Authentication failed:', err);
      } else {
        console.error('KYC request failed:', err);
      }
    }
  };

  const handleKycOpen = async () => {
    if (!authToken) {
      const reauthed = await ensureAuth();
      if (!reauthed) return;
    }
    try {
      if (!currentRelayRef.current) {
        const sdk = getSDK();
        const options: Record<string, string> = {};
        if (kycDappName) options.dappName = kycDappName;
        if (kycMessage) options.message = kycMessage;
        currentRelayRef.current = await sdk.createRelayRequest('coinbase_attestation', { scope: 'zkproofport:demo' }, options);
      }
      window.location.href = currentRelayRef.current.deepLink;
    } catch (err) {
      if ((err as Error).message.includes('Not authenticated')) {
        console.error('Authentication failed:', err);
      } else {
        console.error('KYC open failed:', err);
      }
    }
  };

  const handleCountrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) {
      const reauthed = await ensureAuth();
      if (!reauthed) return;
    }

    try {
      const countries = countryList.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
      if (countries.length === 0) { console.error('Country list is required'); return; }

      const sdk = getSDK();
      const inputs = { countryList: countries, isIncluded, scope: 'zkproofport:demo' };
      const options: Record<string, string> = {};
      if (countryDappName) options.dappName = countryDappName;
      if (countryMessage) options.message = countryMessage;

      const relay = await sdk.createRelayRequest('coinbase_country_attestation', inputs, options);
      currentRelayRef.current = relay;
      await displayResult(relay);
      await waitForProof(relay.requestId);
    } catch (err) {
      if ((err as Error).message.includes('Not authenticated')) {
        console.error('Authentication failed:', err);
      } else {
        console.error('Country request failed:', err);
      }
    }
  };

  const handleCountryOpen = async () => {
    if (!authToken) {
      const reauthed = await ensureAuth();
      if (!reauthed) return;
    }
    try {
      if (!currentRelayRef.current) {
        const countries = countryList.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
        if (countries.length === 0) { console.error('Country list is required'); return; }
        const sdk = getSDK();
        const inputs = { countryList: countries, isIncluded, scope: 'zkproofport:demo' };
        const options: Record<string, string> = {};
        if (countryDappName) options.dappName = countryDappName;
        if (countryMessage) options.message = countryMessage;
        currentRelayRef.current = await sdk.createRelayRequest('coinbase_country_attestation', inputs, options);
      }
      window.location.href = currentRelayRef.current.deepLink;
    } catch (err) {
      if ((err as Error).message.includes('Not authenticated')) {
        console.error('Authentication failed:', err);
      } else {
        console.error('Country open failed:', err);
      }
    }
  };

  const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
  const isAuthed = !!authToken;

  return (
    <div style={{ background: '#f5f5f5', padding: 20, minHeight: '100vh' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ color: '#111', marginBottom: 10, fontSize: '2em' }}>ZKProofport SDK Demo</h1>
        <p style={{ color: '#666', marginBottom: 30 }}>Generate ZK proof requests using the ZKProofport SDK</p>

        {/* Auth Card */}
        <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', padding: 30, marginBottom: 20 }}>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16 }}>API Key Authentication (Required)</span>
            {isAuthed && (
              <span style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                Authenticated
              </span>
            )}
          </div>
          <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
            Enter your API credentials to authenticate. Get these from the{' '}
            <a href={`${dashboardUrl}/dashboard/dapps`} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>Dashboard</a>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                placeholder="Your client_id from dashboard"
                style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Your api_key (shown once)"
                style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={handleAuthenticate}
              disabled={authenticating}
              style={{ padding: '14px 24px', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: 'pointer', background: '#f3f4f6', color: '#374151' }}
            >
              Authenticate
            </button>
            {isAuthed && (
              <button
                onClick={handleClearAuth}
                style={{ padding: '14px 24px', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: 'pointer', background: '#f3f4f6', color: '#374151' }}
              >
                Clear Auth
              </button>
            )}
            <span style={{ fontSize: 13, color: authStatusColor }}>{authStatus}</span>
          </div>
        </div>

        {/* Circuit Card */}
        <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', padding: 30, marginBottom: 20 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 30, borderBottom: '2px solid #eee' }}>
            {(['kyc', 'country'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setShowResult(false); currentRelayRef.current = null; }}
                style={{
                  padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                  color: activeTab === tab ? '#2563eb' : '#666',
                  borderBottom: `3px solid ${activeTab === tab ? '#2563eb' : 'transparent'}`,
                  marginBottom: -2, fontWeight: activeTab === tab ? 600 : 400, transition: 'all 0.2s',
                }}
              >
                {tab === 'kyc' ? 'Coinbase KYC' : 'Coinbase Country'}
              </button>
            ))}
          </div>

          {/* KYC Tab */}
          {activeTab === 'kyc' && (
            <form onSubmit={handleKycSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>Dapp Name (optional)</label>
                <input type="text" value={kycDappName} onChange={e => setKycDappName(e.target.value)} placeholder="My Dapp"
                  style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>Message (optional)</label>
                <input type="text" value={kycMessage} onChange={e => setKycMessage(e.target.value)} placeholder="Please verify your Coinbase KYC"
                  style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 30 }}>
                <button type="submit" disabled={!isAuthed}
                  style={{ flex: 1, padding: '14px 24px', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: isAuthed ? 'pointer' : 'not-allowed', background: '#2563eb', color: 'white', opacity: isAuthed ? 1 : 0.5 }}>
                  Generate QR Code
                </button>
                <button type="button" onClick={handleKycOpen} disabled={!isAuthed}
                  style={{ flex: 1, padding: '14px 24px', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: isAuthed ? 'pointer' : 'not-allowed', background: '#f3f4f6', color: '#374151', opacity: isAuthed ? 1 : 0.5 }}>
                  Open in ZKProofport
                </button>
              </div>
            </form>
          )}

          {/* Country Tab */}
          {activeTab === 'country' && (
            <form onSubmit={handleCountrySubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>Country List *</label>
                <input type="text" value={countryList} onChange={e => setCountryList(e.target.value)} placeholder="US,KR,JP" required
                  style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Comma-separated ISO 3166-1 alpha-2 country codes</div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>List Type</label>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  {[{ value: true, label: 'Include List (user IN list)' }, { value: false, label: 'Exclude List (user NOT IN list)' }].map(opt => (
                    <div
                      key={String(opt.value)}
                      onClick={() => setIsIncluded(opt.value)}
                      style={{
                        flex: 1, padding: 10, border: `2px solid ${isIncluded === opt.value ? '#2563eb' : '#ddd'}`,
                        borderRadius: 6, cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                        background: isIncluded === opt.value ? '#eff6ff' : 'transparent',
                        color: isIncluded === opt.value ? '#2563eb' : 'inherit',
                        fontWeight: isIncluded === opt.value ? 600 : 400,
                      }}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Whether to check if user is in or not in the country list</div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>Dapp Name (optional)</label>
                <input type="text" value={countryDappName} onChange={e => setCountryDappName(e.target.value)} placeholder="My Dapp"
                  style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 500 }}>Message (optional)</label>
                <input type="text" value={countryMessage} onChange={e => setCountryMessage(e.target.value)} placeholder="Please verify your country"
                  style={{ width: '100%', padding: 12, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 30 }}>
                <button type="submit" disabled={!isAuthed}
                  style={{ flex: 1, padding: '14px 24px', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: isAuthed ? 'pointer' : 'not-allowed', background: '#2563eb', color: 'white', opacity: isAuthed ? 1 : 0.5 }}>
                  Generate QR Code
                </button>
                <button type="button" onClick={handleCountryOpen} disabled={!isAuthed}
                  style={{ flex: 1, padding: '14px 24px', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: isAuthed ? 'pointer' : 'not-allowed', background: '#f3f4f6', color: '#374151', opacity: isAuthed ? 1 : 0.5 }}>
                  Open in ZKProofport
                </button>
              </div>
            </form>
          )}

          {/* Result */}
          {showResult && (
            <div style={{ marginTop: 30, padding: 20, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <h3 style={{ marginBottom: 15, color: '#1e293b' }}>Generated Proof Request</h3>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 600, color: '#475569', display: 'inline-block', minWidth: 120 }}>Request ID:</span>
                <span style={{ color: '#1e293b', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13 }}>{resultRequestId}</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 600, color: '#475569', display: 'inline-block', minWidth: 120 }}>Circuit:</span>
                <span style={{ color: '#1e293b', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13 }}>{resultCircuit}</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 600, color: '#475569', display: 'inline-block', minWidth: 120 }}>Deep Link:</span>
                <span style={{ color: '#1e293b', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13 }}>{resultDeepLink}</span>
              </div>
              {qrDataUrl && (
                <div style={{ textAlign: 'center', marginTop: 20 }}>
                  <img src={qrDataUrl} alt="QR Code" style={{ maxWidth: 300, width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, background: 'white' }} />
                </div>
              )}
              <div style={{ marginTop: 20, padding: 16, background: '#f8fafc', borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>Status: </span>
                <span style={{ color: statusColor }}>{statusText}</span>
              </div>
              {proofReceived && (
                <div style={{ marginTop: 20, padding: 16, background: '#ecfdf5', border: '1px solid #10b981', borderRadius: 6 }}>
                  <h4 style={{ marginBottom: 12, color: '#059669' }}>Proof Received</h4>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, color: '#475569', display: 'inline-block', minWidth: 120 }}>Nullifier:</span>
                    <span style={{ color: '#1e293b', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13 }}>{resultNullifier}</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, color: '#475569', display: 'inline-block', minWidth: 120 }}>Public Inputs:</span>
                    <span style={{ color: '#1e293b', fontFamily: 'monospace', fontSize: 13 }}>{resultPublicInputs}</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, color: '#475569', display: 'inline-block', minWidth: 120 }}>Proof (hex):</span>
                    <span style={{ color: '#1e293b', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 11 }}>{resultProof}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
