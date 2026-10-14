'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, ArrowsClockwise, CheckCircle, Info, LockKey, Plant, ShieldCheck, Wallet, WarningCircle } from '@phosphor-icons/react';
import { useSsiatDrop } from '@/lib/useSsiatDrop';
import { displaySeed, PLAYGROUND_FAUCET, SSIAT_VERIFIER } from '@/lib/ssiat-drop';
import { EXPLORER } from '@/lib/giwa-vault';
import { isMobileDevice } from '@/lib/device';
import AppDownloads from './AppDownloads';
import SsiatLogo, { SsiatMark } from './SsiatLogo';
import './ssiat.css';

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const addressLink = (address: string) => `${EXPLORER}/address/${address}`;

/** The wording for each waiting phase. Keyed, so a phase without words is an error, not another phase's words. */
const WAITING_HEADINGS: Partial<Record<string, string>> = {
  requesting: 'Preparing the claim request',
  waiting: 'Continue on your phone',
  verifying: 'Checking the proof on GIWA Sepolia',
};

export default function SsiatDemo() {
  const flow = useSsiatDrop();
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(isMobileDevice()), []);
  const { info, phase, proof, busy } = flow;
  const deployed = !flow.configError;
  const waiting = phase === 'requesting' || phase === 'waiting' || phase === 'verifying';
  const waitingHeading = waiting ? WAITING_HEADINGS[phase] : undefined;
  if (waiting && !waitingHeading) throw new Error(`No Ssiat wording for phase '${phase}'. Known: ${Object.keys(WAITING_HEADINGS).join(', ')}.`);

  return <main className="ssiat-drop" id="content-ssiat" tabIndex={-1}>
    <div className="sd-container">
      <header className="sd-header">
        <a className="sd-brand" href="#content-ssiat" aria-label="Ssiat home"><SsiatLogo /></a>
        <div className="sd-header-actions">
          <span className="sd-network">GIWA Sepolia testnet<i /></span>
          <button className="sd-wallet-button" onClick={() => void flow.connect()} disabled={flow.connecting || busy || !!flow.account || !deployed} aria-label={flow.account ? 'Connected recipient wallet' : 'Connect wallet'} title={flow.account || undefined}><Wallet size={18} /><span>{flow.connecting ? 'Connecting…' : flow.account ? short(flow.account) : 'Connect wallet'}</span></button>
        </div>
      </header>

      <p className="sd-disclaimer" role="note"><Info size={18} />Testnet demo. SEED has no value. Ssiat is a fictional brand; this is not a GIWA, Upbit or Dojang airdrop.</p>

      <section className="sd-heading"><h1>Plant a seed. Claim once.</h1><p>A seed drop for wallets that issued themselves a Dojang on the GIWA Playground faucet.</p></section>

      <div className="sd-workspace">
        <div className="sd-overview-column">
          <section className="sd-pool" aria-labelledby="sd-pool-title">
            <div className="sd-pool-top"><span className="sd-pool-mark"><SsiatMark /></span><h2 id="sd-pool-title">Seeds left in the drop</h2><span className="sd-pool-tag">Test token</span></div>
            <div className="sd-pool-balance"><strong>{displaySeed(info?.remaining ?? null)}</strong><span>SEED</span></div>
            <dl className="sd-pool-facts">
              <div><dt>Per faucet wallet</dt><dd>{displaySeed(info?.claimAmount ?? null)} SEED</dd></div>
              <div><dt>Claims so far</dt><dd>{info ? info.totalClaims.toLocaleString('en-US') : '—'}</dd></div>
              <div><dt>Your SEED</dt><dd>{flow.account ? `${displaySeed(info?.recipientBalance ?? null)} SEED` : 'Not connected'}</dd></div>
            </dl>
            <button className="sd-icon-button" onClick={() => void flow.refresh()} disabled={!deployed} aria-label="Refresh drop figures"><ArrowsClockwise size={18} /></button>
            {flow.readError && <p className="sd-read-error" role="status">{flow.readError}</p>}
          </section>

          <section className="sd-proves" aria-labelledby="sd-proves-title">
            <h2 id="sd-proves-title"><ShieldCheck size={20} />What the proof shows</h2>
            <ul className="sd-proves-yes">
              <li>The wallet on your phone signed a <code>payAndIssueEAS()</code> call to the GIWA Playground faucet.</li>
              <li>The same wallet signed this drop&rsquo;s claim for the recipient you connected, so a copied proof cannot be redirected.</li>
              <li>One claim per faucet wallet. The drop records a nullifier, never the faucet wallet&rsquo;s address.</li>
            </ul>
            <h3>What it does not show</h3>
            <ul className="sd-proves-no">
              <li>That the faucet transaction was mined or succeeded. The ZKProofport app checks that before proving, but a proof built by hand can use a signed transaction that was never sent, from a brand-new wallet.</li>
              <li>That one person holds only one faucet wallet. Anyone can make more wallets, which is why SEED carries no value.</li>
            </ul>
          </section>
        </div>

        <section className="sd-action-card" aria-label="Claim seeds">
          <div className="sd-action-body">
            <ol className="sd-steps">
              <li data-done={!!flow.account}><span>1</span>Connect the wallet that receives the seeds</li>
              <li data-done={!!proof || phase === 'claimed'}><span>2</span>Prove faucet participation with ZKProofport</li>
              <li data-done={phase === 'claimed'}><span>3</span>Claim {displaySeed(info?.claimAmount ?? null)} SEED</li>
            </ol>

            {!deployed && <div className="sd-result sd-neutral" role="status"><Info size={24} /><div><h3>Drop not deployed yet</h3><p>{flow.configError}</p></div></div>}

            <div aria-live="polite" aria-atomic="true">
              {waiting && <div className="sd-proof-request"><div className="sd-request-heading"><span className="sd-spinner" /><strong>{waitingHeading}</strong></div>{phase === 'waiting' && <>{!mobile && <img src={flow.qr} width={360} height={360} alt="Scan with ZKProofport to prove faucet participation for this claim" />}<p>{mobile ? 'Open ZKProofport and sign with the wallet you used on the Playground faucet.' : 'Scan with ZKProofport, using the wallet you used on the Playground faucet.'}</p><a className="sd-open-app" href={flow.deepLink}>Open ZKProofport <ArrowUpRight size={14} /></a><AppDownloads compact /></>}<button className="sd-text-button" onClick={flow.reset}>Cancel proof request</button></div>}
              {phase === 'ready' && proof && <div className="sd-result sd-ready"><ShieldCheck size={26} /><div><h3>Proof accepted by the drop</h3><p>Checked with <code>verifyClaim</code> on GIWA Sepolia. Send the claim from {short(proof.recipient)}.</p></div></div>}
              {phase === 'claiming' && <p className="sd-pending"><span className="sd-spinner" />{flow.txHash ? 'Claim submitted. Waiting for confirmation.' : 'Confirm the claim in your wallet.'}</p>}
              {phase === 'claimed' && flow.receipt && <div className="sd-result sd-success"><CheckCircle size={28} weight="fill" /><div><h3>Seeds claimed</h3><p>{displaySeed(flow.receipt.amount)} SEED sent to {short(flow.receipt.recipient)}.</p><a href={`${EXPLORER}/tx/${flow.receipt.hash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} /></a></div></div>}
              {phase === 'already-claimed' && <div className="sd-result sd-neutral"><LockKey size={24} /><div><h3>Already claimed</h3><p>This faucet wallet has already claimed its seeds. Each faucet wallet can claim once, whichever recipient it signed for.</p><small>No transaction sent.</small></div></div>}
              {phase === 'exhausted' && <div className="sd-result sd-neutral"><Plant size={24} /><div><h3>The drop is empty</h3><p>Every seed has been claimed.</p><small>No transaction sent.</small></div></div>}
              {phase === 'ended' && <div className="sd-result sd-neutral"><Info size={24} /><div><h3>Request ended</h3><p>{flow.notice}</p></div></div>}
            </div>
            {flow.error && <div className="sd-error" role="alert"><WarningCircle size={19} /><p>{flow.error}</p></div>}
            {flow.txHash && phase !== 'claimed' && <a className="sd-tx-link" href={`${EXPLORER}/tx/${flow.txHash}`} target="_blank" rel="noreferrer">Track transaction <ArrowUpRight size={14} /></a>}

            {!waiting && deployed && <div className="sd-action-buttons">
              {!flow.account ? <button className="sd-primary" onClick={() => void flow.connect()} disabled={flow.connecting || busy}><Wallet size={19} />{flow.connecting ? 'Connecting…' : 'Connect recipient wallet'}<ArrowRight size={19} /></button>
                : phase === 'ready' && proof ? <button className="sd-primary" onClick={() => void flow.claim()} disabled={busy}><Plant size={19} />Claim seeds<ArrowRight size={19} /></button>
                : phase === 'claiming' ? null
                : phase === 'claimed' || phase === 'already-claimed' || phase === 'exhausted' ? <button className="sd-secondary" onClick={flow.reset}>Start over<ArrowRight size={19} /></button>
                : <button className="sd-primary" onClick={() => void flow.requestProof()} disabled={busy || flow.connecting}><ShieldCheck size={19} />{phase === 'ended' || phase === 'blocked' ? 'Try again' : 'Prove faucet participation'}<ArrowRight size={18} /></button>}
            </div>}
            <p className="sd-action-note"><LockKey size={13} />The faucet wallet&rsquo;s address is not sent to the drop.</p>
          </div>
          <div className="sd-card-footer"><img src="/logo.png" width={21} height={21} alt="" /><span>Proofs by <strong>ZKProofport</strong></span></div>
        </section>
      </div>

      <details className="sd-details">
        <summary>Demo details &amp; contracts</summary>
        <div className="sd-contracts">
          {flow.dropAddress && <a href={addressLink(flow.dropAddress)} target="_blank" rel="noreferrer">Ssiat drop<ArrowUpRight size={16} /></a>}
          {info?.token && <a href={addressLink(info.token)} target="_blank" rel="noreferrer">SEED token<ArrowUpRight size={16} /></a>}
          <a href={addressLink(SSIAT_VERIFIER)} target="_blank" rel="noreferrer">Dojang Playground verifier<ArrowUpRight size={16} /></a>
          <a href={addressLink(PLAYGROUND_FAUCET)} target="_blank" rel="noreferrer">Playground faucet<ArrowUpRight size={16} /></a>
        </div>
        <p>Ssiat is a fictional brand on the GIWA Sepolia testnet. SEED is a fixed-supply test token with no value and no backing, and this drop is not operated or endorsed by GIWA, Upbit or Dojang. The proof binds a claim to the recipient it names and allows one claim per faucet wallet; it does not show that the faucet transaction was mined. Claim transactions, the recipient and the per-drop nullifier are public.</p>
      </details>
    </div>
  </main>;
}
