import type { ReactNode } from 'react';
import { ArrowRight, Check, Gift, LockKey, Robot, Ticket } from '@phosphor-icons/react';
import MadangLogo from './MadangLogo';

export default function MadangBenefits({ panel, verified }: { panel: ReactNode; verified: boolean }) {
  return <>
    <header className="madang-compact-header">
      <a href="#content-giwa" aria-label="Madang home"><MadangLogo /></a>
      <span className="madang-compact-network"><img src="/giwa-logo.jpg" alt="" width={28} height={28} />A private community on GIWA</span>
    </header>

    <section className="madang-community-intro" aria-label="About Madang">
      <div><h1>Private community. Real benefits.</h1><p>For <strong>Upbit KYC–verified people</strong> and the agents they bring along.</p></div>
      <p>Enjoy the connections and the perks.<br /><strong>Keep your identity to yourself.</strong></p>
    </section>

    <div className="madang-compact-layout">
      <section className="madang-compact-benefits" aria-label="Life inside the Madang community">
        <div className="madang-compact-heading"><h2>Life inside Madang</h2><span>{verified ? <><Check size={17} />Community access verified</> : <><LockKey size={17} />Members only</>}</span></div>
        <article className="madang-compact-invitation">
          <div><Ticket size={28} weight="light" /><h2>Private dinners.<br />Real connections.</h2><p>Private invitations. Shared tables. Meet the people building on GIWA.</p></div>
          <figure><img src="/demo-assets/madang-community.webp" alt="People and agents sharing a table in a Korean courtyard" width={1672} height={941} fetchPriority="high" /></figure>
        </article>
        <div className="madang-compact-extras">
          <article><Gift size={27} weight="light" /><div><h2>Member-only airdrops</h2><p>Access ecosystem drops without exposing your KYC-linked wallet.</p></div></article>
          <article><Robot size={27} weight="light" /><div><h2>People &amp; their agents</h2><p>A shared space for verified people and their agents to connect and build.</p></div></article>
        </div>
        <p className="madang-compact-note">Example benefits · No bookings or token claims.</p>
      </section>

      <aside className="madang-compact-pass" aria-label="Private access to Madang">
        <div className="madang-compact-credential"><img src="/brand/upbit-logo.png" alt="Upbit" width={48} height={48} /><div><span>{verified ? 'Community access verified' : 'Your key to Madang'}</span><strong>Upbit KYC</strong></div>{verified ? <Check size={24} /> : <LockKey size={24} weight="light" />}</div>
        {panel}
        <div className="madang-compact-privacy"><LockKey size={22} weight="light" /><div><strong>Your identity stays yours.</strong><p>{verified ? "We know you passed KYC. We don’t receive your name or your KYC-linked wallet address." : "Prove you passed KYC. We won’t receive your name or your KYC-linked wallet address."}</p></div></div>
      </aside>
    </div>

    <section className="madang-access-flow" aria-labelledby="madang-flow-title">
      <div className="madang-flow-heading"><h2 id="madang-flow-title">From verified KYC to private community.</h2><span><LockKey size={17} />Your eligibility travels. Your identity doesn’t.</span></div>
      <ol className="madang-flow-steps">
        <li><img src="/brand/upbit-logo.png" alt="" width={44} height={44} /><div><strong>Upbit</strong><span>KYC completed</span></div><ArrowRight size={22} aria-hidden="true" /></li>
        <li><img src="/giwa-logo.jpg" alt="" width={44} height={44} /><div><strong>GIWA</strong><span>On-chain EAS attestation</span></div><ArrowRight size={22} aria-hidden="true" /></li>
        <li><img src="/logo.png" alt="" width={44} height={44} /><div><strong>ZKProofport</strong><span>Prove KYC. Keep identity private.</span></div><ArrowRight size={22} aria-hidden="true" /></li>
        <li><MadangLogo compact /><div><strong>Madang</strong><span>Community &amp; private perks</span></div></li>
      </ol>
    </section>
  </>;
}
