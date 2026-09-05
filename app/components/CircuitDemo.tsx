'use client';

import { useState } from 'react';
import { ArrowUpRight, Check } from '@phosphor-icons/react';
import { type DemoDefinition, type DemoId } from '@/lib/demo-catalog';
import { DEFAULT_OPTIONS, networkName, verifierLink } from '@/lib/demo-policy';
import { useCredentialDemo } from '@/lib/useCredentialDemo';
import ProofPanel from './ProofPanel';
import DemoExperience from './DemoExperience';

export default function CircuitDemo({ demo, onSelect }: { demo: DemoDefinition; onSelect: (id: DemoId) => void }) {
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS, ...(demo.id === 'country' ? { countries: 'KP, IR', inclusion: false } : {}) });
  const flow = useCredentialDemo(demo);
  const verified = flow.phase === 'verified';
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  return <main className={`circuit-demo demo-${demo.id}`} id={`content-${demo.id}`} tabIndex={-1}>
    <DemoExperience demo={demo} options={options} onSelect={onSelect} verified={verified} panel={<ProofPanel demo={demo} options={options} onOptions={setOptions} flow={flow} />} />
    {verified && demo.id !== 'giwa' ? <section className="demo-unlocked" aria-label={`${demo.brand} unlocked example content`}>
      <div className="unlocked-title"><Check size={26} /><div><h2>{demo.outcomeTitle}</h2><p>{demo.outcomeDescription}</p></div></div>
      <div className="unlocked-content">{demo.outcomeItems.map((item, index) => <article key={item.title}><h3>{item.title}</h3><p>{item.description}</p><button className="proof-text-button" aria-expanded={expandedItem === index} onClick={() => setExpandedItem(expandedItem === index ? null : index)}>{expandedItem === index ? 'Close details' : 'Explore space'}<ArrowUpRight size={15} /></button>{expandedItem === index && <p className="example-content-note">This is a sample {demo.brand} space, opened by your verified proof. No account, purchase or reservation has been created.</p>}</article>)}</div>
    </section> : null}
    {flow.proof && <details className="demo-receipt"><summary>View proof receipt</summary><dl><div><dt>Request</dt><dd>{flow.proof.requestId}</dd></div><div><dt>Circuit</dt><dd>{flow.proof.circuit}</dd></div><div><dt>Network</dt><dd>{networkName(flow.proof.chainId)}</dd></div><div><dt>Verifier</dt><dd><a href={verifierLink(flow.proof)} target="_blank" rel="noreferrer">Open explorer<ArrowUpRight size={14} /></a></dd></div><div><dt>Verification</dt><dd>{verified ? flow.method === 'onchain' ? 'Contract check passed' : 'Browser check passed' : 'Not yet verified'}</dd></div></dl><details><summary>Proof and public inputs</summary><pre>{JSON.stringify({ proof: flow.proof.proof, publicInputs: flow.proof.publicInputs }, null, 2)}</pre></details></details>}
    <footer className="demo-footer"><a href="https://zkproofport.com" target="_blank" rel="noreferrer"><img src="/logo.png" alt="" width={20} height={20} />Powered by ZKProofport<ArrowUpRight size={13} /></a><details><summary>{demo.id === 'giwa' ? 'GIWA Sepolia · Test demo' : 'About this demo'}</summary><p>{demo.note} Access is a browser demonstration, not server-enforced authorization. The service scenario is illustrative.</p></details></footer>
  </main>;
}
