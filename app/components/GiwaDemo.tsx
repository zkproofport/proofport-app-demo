'use client';

import AppDownloads from './AppDownloads';
import { useEffect, useState } from 'react';

import { ArrowDownLeft, ArrowRight, ArrowUpRight, ArrowsClockwise, Buildings, CheckCircle, LockKey, ShieldCheck, Wallet, WarningCircle } from '@phosphor-icons/react';
import { formatUnits } from 'ethers';
import { useGiwaVault } from '@/lib/useGiwaVault';
import { displayKRW, EXPLORER, TOKEN_ADDRESS, VAULT_ADDRESS } from '@/lib/giwa-vault';
import { GIWA_VERIFIER } from '@/lib/giwa-membership';
import { isMobileDevice } from '@/lib/device';
import GotganLogo, { GotganMark } from './GotganLogo';
import './giwa.css';

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const addressLink = (address: string) => `${EXPLORER}/address/${address}`;

export default function GiwaDemo() {
  const flow = useGiwaVault();
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(isMobileDevice()), []);
  const { balances, phase, proof, busy } = flow;
  const waiting = ['requesting', 'waiting', 'verifying'].includes(phase);
  const writing = ['approving', 'depositing', 'withdrawing'].includes(phase);
  const available = flow.mode === 'deposit' ? balances?.wallet : balances?.deposited;
  const completed = phase === 'success';
  const actionLabel = phase === 'checking' ? 'Checking eligibility…' : phase === 'approving' ? 'Approving dKRW…' : phase === 'depositing' ? 'Confirming deposit…' : phase === 'withdrawing' ? 'Confirming withdrawal…'
    : flow.mode === 'withdraw' ? 'Withdraw dKRW' : flow.approvalNeeded ? 'Approve dKRW' : 'Deposit dKRW';

  return <main className="giwa-vault" id="content-giwa" tabIndex={-1}>
    <div className="gv-container">
      <header className="gv-header">
        <a className="gv-brand" href="#content-giwa" aria-label="Gotgan home"><GotganLogo /></a>
        <div className="gv-header-actions"><span className="gv-network"><img src="/giwa-logo.jpg" width={20} height={20} alt="" />GIWA Sepolia<i /></span><button className="gv-wallet-button" onClick={() => void flow.connect()} disabled={flow.connecting || busy || !!flow.account} aria-label={flow.account ? 'Connected operational wallet' : 'Connect wallet'} title={flow.account || undefined}><Wallet size={18} /><span>{flow.connecting ? 'Connecting…' : flow.account ? short(flow.account) : 'Connect wallet'}</span>{flow.account && <span className="gv-connected-dot" aria-hidden="true" />}</button></div>
      </header>

      <section className="gv-heading" id="gv-overview"><div><h1>Institutional KRW vault.</h1><p>A KYC-gated vault on GIWA.</p></div></section>

      <div className="gv-workspace">
        <div className="gv-overview-column">
          <section className="gv-fund" aria-labelledby="gv-fund-title">
            <div className="gv-fund-top"><span className="gv-asset-mark"><GotganMark /></span><h2 id="gv-fund-title">Total vault deposits</h2><span className="gv-fund-tag">Test assets</span></div>
            <div className="gv-fund-balance"><div><strong>{displayKRW(balances?.total ?? null)}</strong><span>dKRW</span></div></div>
            <p className="gv-asset-caption">Demo Korean Won · dKRW</p>
            <div className="gv-fund-watermark" aria-hidden="true"><GotganMark /></div>
          </section>

          <section className="gv-position" aria-label="Operational wallet position">
            <div className="gv-section-heading"><h2><Buildings size={20} />Your position</h2><button className="gv-icon-button" onClick={() => void flow.refresh()} aria-label="Refresh live balances"><ArrowsClockwise size={18} /></button></div>
            <div className="gv-position-grid"><div><span>Wallet balance</span><strong>{displayKRW(balances?.wallet ?? null)} <small>dKRW</small></strong></div><div><span>Your deposits</span><strong>{displayKRW(balances?.deposited ?? null)} <small>dKRW</small></strong></div></div>
            <div className="gv-wallet-row"><span>Operational wallet</span><span className="gv-view-only">{flow.account ? <a href={addressLink(flow.account)} target="_blank" rel="noreferrer" title={flow.account}>{short(flow.account)} <ArrowUpRight size={14} /></a> : 'Not connected'}</span></div>
            {flow.readError && <p className="gv-read-error" role="status">{flow.readError}</p>}
          </section>

        </div>

        <section className="gv-action-card" aria-label="Manage vault deposits">
          <div className="gv-action-tabs" role="group" aria-label="Vault action"><button aria-pressed={flow.mode === 'deposit'} disabled={busy} onClick={() => flow.changeMode('deposit')}>Deposit<ArrowDownLeft size={18} /></button><button aria-pressed={flow.mode === 'withdraw'} disabled={busy} onClick={() => flow.changeMode('withdraw')}>Withdraw<ArrowUpRight size={18} /></button></div>
          <div className="gv-action-body">
            <label className="gv-amount-label" htmlFor="gv-amount">{flow.mode === 'deposit' ? 'Deposit amount' : 'Withdrawal amount'}<span>dKRW</span></label>
            <div className="gv-amount-box"><span className="gv-mini-won">₩</span><input id="gv-amount" inputMode="decimal" autoComplete="off" value={flow.amount} onChange={event => flow.changeAmount(event.target.value)} disabled={busy} aria-describedby="gv-available" /><button disabled={busy || available == null || available === BigInt(0)} onClick={() => available != null && flow.changeAmount(formatUnits(available, 6))}>MAX</button></div>
            <div className="gv-available" id="gv-available"><span>{flow.mode === 'deposit' ? 'Wallet balance' : 'Deposited balance'}</span><strong>{displayKRW(available ?? null)} dKRW</strong></div>

            {flow.mode === 'deposit' && !completed && <div className={`gv-policy ${proof ? 'gv-policy-verified' : ''}`}><div><ShieldCheck size={19} /><strong>Upbit KYC eligibility</strong><span>{proof ? 'Verified' : 'Required'}</span></div><p>Test attestation</p></div>}

            <div aria-live="polite" aria-atomic="true">
              {phase === 'blocked' && !flow.error && <div className="gv-result gv-blocked"><span className="gv-result-icon"><LockKey size={22} /></span><div><h3>Deposit blocked</h3><p>An eligibility proof is required.</p><small>No transaction sent.</small></div></div>}
              {completed && flow.receipt && <div className="gv-result gv-success"><CheckCircle size={29} weight="fill" /><div><h3>{flow.receipt.action === 'deposit' ? 'Deposit confirmed' : 'Withdrawal confirmed'}</h3><p>{displayKRW(flow.receipt.amount)} dKRW {flow.receipt.action === 'deposit' ? 'deposited into the vault.' : 'returned to your operational wallet.'}</p><a href={`${EXPLORER}/tx/${flow.receipt.hash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} /></a></div></div>}
              {waiting && <div className="gv-proof-request"><div className="gv-request-heading"><span className="gv-spinner" /><strong>{phase === 'requesting' ? 'Preparing proof request' : phase === 'verifying' ? 'Verifying proof on GIWA' : 'Continue on your phone'}</strong></div>{phase === 'waiting' && <>{!mobile && <img src={flow.qr} width={360} height={360} alt="Scan with ZKProofport to prove eligibility for this deposit" />}<p>{mobile ? 'Open ZKProofport and sign this action with your KYC-linked account.' : 'Scan with ZKProofport using your KYC-linked account.'}</p><a className="gv-open-app" href={flow.deepLink}>Open ZKProofport <ArrowUpRight size={14} /></a><AppDownloads compact /></>}<button className="gv-text-button" onClick={flow.reset}>Cancel proof request</button></div>}
              {writing && <p className="gv-pending"><span className="gv-spinner" />{flow.txHash ? 'Transaction submitted. Waiting for confirmation.' : 'Confirm the transaction in your wallet.'}</p>}
            </div>
            {flow.error && <div className="gv-error" role="alert"><WarningCircle size={19} /><p>{flow.error}</p></div>}
            {flow.txHash && !completed && <a className="gv-tx-link" href={`${EXPLORER}/tx/${flow.txHash}`} target="_blank" rel="noreferrer">Track transaction <ArrowUpRight size={14} /></a>}

            {!waiting && <div className="gv-action-buttons">
              {completed ? <button className="gv-primary" onClick={flow.reset}>Make another {flow.mode}<ArrowRight size={19} /></button>
                : <>
                  {flow.account && flow.mode === 'deposit' && !proof && <button className="gv-primary" disabled={busy || flow.connecting || flow.units === null} onClick={() => void flow.requestProof()}><ShieldCheck size={19} />Generate eligibility proof<ArrowRight size={18} /></button>}
                  {!flow.account ? <button className="gv-primary" onClick={() => void flow.connect()} disabled={flow.connecting || busy}><Wallet size={18} />{flow.connecting ? 'Connecting…' : 'Connect operational wallet'}<ArrowRight size={19} /></button>
                    : <button className={!proof && flow.mode === 'deposit' ? 'gv-secondary' : 'gv-primary'} disabled={busy || flow.units === null} onClick={() => void flow.act(flow.mode === 'withdraw' ? 'withdraw' : flow.approvalNeeded ? 'approve' : 'deposit')}>{busy ? <span className="gv-spinner" /> : flow.mode === 'deposit' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}{actionLabel}{!busy && <ArrowRight size={19} />}</button>}
                </>}
            </div>}
            {!flow.account && <p className="gv-action-note">{flow.mode === 'deposit' ? 'Connect the wallet you want to deposit from. Prove eligibility with your KYC-linked wallet on your phone.' : 'Connect the operational wallet to withdraw your deposits.'}</p>}
            <p className="gv-action-note"><LockKey size={13} />{flow.mode === 'deposit' ? 'Your KYC account is not sent to the vault.' : 'Withdrawals do not require a new KYC proof.'}</p>
          </div>
          <div className="gv-card-footer"><img src="/logo.png" width={21} height={21} alt="" /><span>Proofs by <strong>ZKProofport</strong></span></div>
        </section>
      </div>

      <details className="gv-details" id="gv-details">
        <summary>Demo details & contracts</summary>
        <div className="gv-contracts">
          <a href={addressLink(VAULT_ADDRESS)} target="_blank" rel="noreferrer">Vault<ArrowUpRight size={16} /></a>
          <a href={addressLink(TOKEN_ADDRESS)} target="_blank" rel="noreferrer">dKRW token<ArrowUpRight size={16} /></a>
          <a href={addressLink(GIWA_VERIFIER)} target="_blank" rel="noreferrer">Verifier<ArrowUpRight size={16} /></a>
        </div>
        <p>dKRW is a freely mintable test token with no KRW backing or monetary value. No yield is generated. Eligibility uses a test attestation modeling Upbit KYC; production KYC, current revocation and expiry are not verified. Transactions and public inputs remain public.</p>
      </details>
    </div>
  </main>;
}
