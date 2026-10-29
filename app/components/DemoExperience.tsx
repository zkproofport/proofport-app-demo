'use client';

import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight, Check, Fingerprint, GlobeHemisphereWest, IdentificationCard, LockKey, ChatCircle, Prohibit } from '@phosphor-icons/react';
import type { DemoDefinition } from '@/lib/demo-catalog';
import type { DemoOptions } from '@/lib/demo-policy';
import MadangBenefits from './MadangBenefits';
import AccessLock from './AccessLock';
import type { DemoPhase } from '@/lib/useCredentialDemo';

type Props = { demo: DemoDefinition; options: DemoOptions; panel: ReactNode; verified: boolean; phase?: DemoPhase };

export default function DemoExperience({ demo, options, panel, verified, phase = 'idle' }: Props) {
  const [market, setMarket] = useState('Supply');
  const [topic, setTopic] = useState('Engineering');
  const header = <header className="experience-masthead"><div className="experience-wordmark">{demo.brand}{demo.id === 'email' && <span className="blind-period">.</span>}</div><span>{demo.category}</span><span className="experience-demo-label">{demo.experimental ? 'Experimental demo' : 'Example dApp'}</span></header>;

  if (demo.id === 'giwa') return <MadangBenefits panel={panel} verified={verified} />;

  if (demo.id === 'kyc') return <>
    {header}
    <section className="defi-opening"><div><h1>DeFi for<br /><span>verified people.</span></h1><p>Coinbase KYC gets you in.<br />The original KYC account address is not included in the proof.</p></div><div className={`defi-access-state${verified ? ' is-unlocked' : ''}`}><AccessLock unlocked={verified} size={36} /><span>Account access</span><strong>{verified ? 'Unlocked' : 'Locked'}</strong><span>{verified ? 'Eligibility verified with a proof.' : 'Verify eligibility with a proof.'}</span></div></section>
    <div className="defi-workspace">
      <section className="defi-markets" data-access={verified ? 'unlocked' : 'locked'} aria-label="Example markets">
        <div className="market-heading"><h2>Markets</h2><div className="scenario-switch" role="group" aria-label="Market action">{['Supply','Borrow'].map(label => <button key={label} aria-pressed={market === label} onClick={() => setMarket(label)}>{label}</button>)}</div></div>
        <p className="market-description">{market === 'Supply' ? 'A lending market reserved for verified participants.' : 'Borrowing access starts with the same private eligibility check.'}</p>
        <div className="market-access-banner" role="status" aria-live="polite" aria-atomic="true">
          <AccessLock unlocked={verified} size={26} />
          <div><strong>{verified ? 'Markets unlocked' : phase === 'verifying' ? 'Verifying access' : 'Markets locked'}</strong><span>{verified ? 'Your eligibility proof passed. The original KYC account address is not included in the proof.' : phase === 'received' ? 'Proof received. Verify it to open this workspace.' : phase === 'verifying' ? 'The markets stay locked until verification succeeds.' : 'A verified Coinbase account proof opens this workspace.'}</span></div>
          {phase === 'verifying' && !verified && <span className="market-verifying-indicator" aria-hidden="true" />}
        </div>
        <div className="market-table"><div className="market-table-head"><span>Asset</span><span>Market type</span><span>Access</span></div>{[{name:'USD Coin',symbol:'USDC',type:'Stablecoin'},{name:'Ether',symbol:'ETH',type:'Digital asset'},{name:'Coinbase Wrapped BTC',symbol:'cbBTC',type:'Wrapped asset'}].map(asset => <div className="market-row" key={asset.symbol}><div><span className="asset-symbol">{asset.symbol === 'USDC' ? '$' : asset.symbol === 'ETH' ? 'Ξ' : '₿'}</span><div><strong>{asset.symbol}</strong><span>{asset.name}</span></div></div><span>{asset.type}</span><span className="market-lock"><AccessLock unlocked={verified} size={18} /><span key={verified ? 'open' : 'locked'}>{verified ? 'Access granted' : 'Locked'}</span></span></div>)}</div>
        <div className="market-disclaimer"><span>Interface preview</span><p>No live balances, rates, deposits or borrowing. Only the eligibility proof is real.</p></div>
      </section>
      <div className="defi-verification"><div className="defi-credential">Coinbase KYC<ArrowUpRight size={25} /></div>{panel}</div>
    </div>
  </>;

  if (demo.id === 'country') return <>
    {header}
    <div className="country-layout"><section className="country-statement"><GlobeHemisphereWest size={56} weight="light" /><h1>Not on<br />the <span>blacklist.</span></h1><p>That’s all a service needs to know.<br />Your actual country stays private.</p><div className="country-rule"><span>The condition you prove</span><strong>My country <b>∉</b> this list.</strong></div><div className="country-blocklist"><div><Prohibit size={20} /><span>Example blocked countries</span></div><div className="country-code-list">{options.countries.split(',').filter(code => code.trim()).map((code, index) => <span key={index}>{code.trim().toUpperCase()}</span>)}</div><p>An editable demo policy, not a legal sanctions list.</p></div></section><div className="country-review"><div className="country-review-title"><span>Private eligibility check</span><span>{verified ? 'Passed' : 'Proof required'}</span></div>{panel}<div className="country-answer"><span>The service receives</span><strong>{verified ? 'Outside the blocklist.' : 'A yes-or-no answer.'}</strong><p>No country name. No passport. No original wallet.</p></div></div></div>
  </>;

  if (demo.id === 'email') return <>
    {header}
    <section className="blind-opening"><h1>Your company.<br /><span>Not your identity.</span></h1><p>Work email proves you belong.<br />Zero knowledge keeps you anonymous.</p></section>
    <div className="blind-workspace"><aside className="blind-sidebar"><strong>Off the record</strong><p>Example discussions</p>{['Engineering','Work culture','Career'].map(label => <button key={label} aria-pressed={topic === label} onClick={() => setTopic(label)}><ChatCircle size={20} />{label}</button>)}<div className="blind-sidebar-note"><LockKey size={22} /><p>Verified coworkers.<br />No email addresses.</p></div></aside><section className="blind-feed" aria-label="Example anonymous discussion feed"><div className="blind-feed-head"><h2>{topic}</h2><span>Preview</span></div>{(topic === 'Engineering' ? ['What makes a code review actually useful?','How much time should we protect for deep work?'] : topic === 'Work culture' ? ['Can a team be honest without being harsh?','What would you change about the Monday meeting?'] : ['What did you wish you knew before becoming a lead?','How do you decide what to learn next?']).map((title,index) => <article key={title}><div className="anonymous-author"><span>{index === 0 ? 'A' : 'B'}</span><div><strong>Anonymous colleague</strong><small>Illustrative post</small></div></div><h3>{title}</h3><p>{index === 0 ? 'A space to ask the question you might not ask in the company chat.' : 'Keep the discussion about the work, without attaching your identity.'}</p><div className="blind-locked"><LockKey size={16} />{verified ? 'Domain verified. Example space unlocked.' : 'Verify your work domain to enter.'}</div></article>)}</section><div className="blind-signin">{panel}<p className="blind-promise">Your email ends at the proof.<br /><strong>Your voice starts here.</strong></p></div></div>
  </>;

  /*
   * No fallthrough screen. The last `return` here used to be unconditional, so
   * any demo that matched none of the branches above rendered whichever screen
   * sat at the bottom. That happened on 2026-09-12: a new tab opened on another
   * demo's identity screen, beside a deposit form.
   */
  throw new Error(
    `No demo screen for '${demo.id}'. Known: giwa, kyc, country, email. Add a branch in DemoExperience, ` +
      'or list the demo in DEDICATED_SCREENS if it has a screen of its own.',
  );
}
