'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Fingerprint, LockKey, X } from '@phosphor-icons/react';
import { isMobileDevice } from '@/lib/device';
import { type DemoDefinition } from '@/lib/demo-catalog';
import { networkName, type DemoOptions } from '@/lib/demo-policy';
import type { useCredentialDemo, VerificationMethod } from '@/lib/useCredentialDemo';
import DemoFields from './DemoFields';

type Props = { demo: DemoDefinition; options: DemoOptions; onOptions: (options: DemoOptions) => void; flow: ReturnType<typeof useCredentialDemo> };

export default function ProofPanel({ demo, options, onOptions, flow }: Props) {
  const [mobile, setMobile] = useState(false);
  const [method, setMethod] = useState<VerificationMethod>('onchain');
  useEffect(() => setMobile(isMobileDevice()), []);
  const idle = flow.phase === 'idle' || flow.phase === 'error';
  const received = flow.phase === 'received' || flow.phase === 'verifying';
  const verified = flow.phase === 'verified';
  const status = { idle: 'Private access', requesting: 'Preparing request', waiting: 'Waiting for your phone', received: 'Proof received', verifying: 'Checking your proof', verified: 'Access unlocked', error: 'Request needs attention' }[flow.phase];

  return <aside className={`proof-panel${verified ? ' is-verified' : ''}`} data-phase={flow.phase} aria-label={`${demo.brand} verification`}>
    <div className="proof-panel-top"><Fingerprint size={25} weight="light" /><span role="status">{status}</span>{flow.phase !== 'idle' && <button className="icon-button" onClick={flow.reset} aria-label={`Reset ${demo.tab} demo`} title="Reset demo"><X size={17} /></button>}</div>
    {idle && <>
      <h2>{demo.actionTitle}</h2><p className="panel-intro">{demo.id === 'giwa' ? 'Use ZKProofport to privately prove your KYC attestation on GIWA.' : demo.actionDescription}</p>
      <form onSubmit={event => { event.preventDefault(); void flow.request(options); }}>
        <DemoFields demo={demo} options={options} onChange={onOptions} disabled={false} />
        {flow.error && <p className="proof-error" role="alert">{flow.error}</p>}
        <button className="proof-primary" type="submit">{flow.phase === 'error' ? 'Try again' : demo.id === 'giwa' ? 'Get my Madang pass' : 'Get verified'}<ArrowUpRight size={19} /></button>
      </form>
      {demo.id !== 'giwa' && <p className="panel-provider"><LockKey size={14} />Verified with ZKProofport</p>}
    </>}
    {flow.phase === 'requesting' && <div className="proof-processing" role="status"><h2>Creating your request.</h2><p className="panel-intro">Preparing a secure connection to your phone.</p><div className="qr-skeleton" aria-hidden="true"><span /><span /><span /><span /></div><p className="field-help">This may take a few seconds.</p></div>}
    {flow.phase === 'waiting' && <div className="proof-waiting"><h2>Your phone. Your proof.</h2><p className="panel-intro">{mobile ? 'Open ZKProofport and approve the proof request.' : 'Scan with ZKProofport, then approve the request on your phone.'}</p>{mobile ? <a className="proof-primary" href={flow.deepLink}>Open app<ArrowUpRight size={19} /></a> : <img className="proof-qr" src={flow.qrCode} alt={`Scan with ZKProofport to generate a ${demo.tab} proof`} width={224} height={224} />}<p className="field-help">Keep this tab open. Your request expires after 3 minutes.</p><button className="proof-text-button" onClick={flow.reset}>Cancel request</button></div>}
    {received && <>
      <h2>{flow.phase === 'verifying' ? 'Checking the proof.' : 'Ready for a private check.'}</h2><p className="panel-intro">{flow.phase === 'verifying' ? 'Access opens only after your proof passes verification.' : 'Your proof arrived. Choose how to verify it.'}</p>
      <div className="verification-choice" role="group" aria-label="Verification method">
        <button type="button" aria-pressed={method === 'onchain'} onClick={() => setMethod('onchain')} disabled={flow.phase === 'verifying'}>On-chain</button>
        <button type="button" aria-pressed={method === 'offchain'} onClick={() => setMethod('offchain')} disabled={flow.phase === 'verifying'}>In browser</button>
      </div>
      <p className="field-help">{method === 'onchain' ? `Read-only check on ${networkName(flow.proof?.chainId)}. No transaction or gas payment.` : 'Check the proof locally using its verification key. Initial loading may take a moment.'}</p>
      <div className={`proof-check-summary${flow.phase === 'verifying' ? ' is-processing' : ''}`}><span>Request matched</span><Check size={16} /><span>Required condition matched</span><Check size={16} /><span>Cryptographic verification</span><span>{flow.phase === 'verifying' ? 'Checking' : 'Next'}</span></div>
      {flow.error && <p className="proof-error" role="alert">{flow.error}</p>}
      <button className="proof-primary" type="button" onClick={() => flow.verify(method)} disabled={flow.phase === 'verifying'}>{flow.phase === 'verifying' ? 'Verifying' : flow.error ? 'Retry verification' : 'Verify proof'}<ArrowRight size={19} /></button>
    </>}
    {verified && <div className="proof-success" role="status"><div className="proof-success-mark"><Check size={34} weight="light" /></div><h2>Proof accepted.</h2><p className="panel-intro">{demo.outcomeDescription}</p><div className="proof-check-summary"><span>Verified using</span><strong>{flow.method === 'onchain' ? networkName(flow.proof?.chainId) : 'Browser verification'}</strong><span>Personal data requested</span><strong>None</strong></div><button className="proof-text-button" onClick={flow.reset}>Start a new demo</button></div>}
    <div className="proof-progress" aria-label="Proof progress">{['Request', 'Prove', 'Verify'].map((label, index) => {
      const step = idle ? 0 : flow.phase === 'requesting' ? 0 : flow.phase === 'waiting' ? 1 : 2;
      return <span key={label} className={verified || index < step ? 'is-done' : index === step ? 'is-current' : ''}>{(verified || index < step) && <Check size={12} />}{label}</span>;
    })}</div>
  </aside>;
}
