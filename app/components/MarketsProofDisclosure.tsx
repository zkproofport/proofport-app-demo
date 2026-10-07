import { FileCode } from '@phosphor-icons/react';
import type { ProofResponse } from '@zkproofport-app/sdk';

/** Describes the Coinbase proof schema, without claiming to decode private data. */
export default function MarketsProofDisclosure({ proof }: { proof: ProofResponse }) {
  const size = proof.proof && /^0x(?:[0-9a-f]{2})+$/i.test(proof.proof) ? (proof.proof.length - 2) / 2 : null;
  return <section className="markets-proof-disclosure" aria-label="What this proof shares">
    <div className="proof-payload-heading"><FileCode size={22} aria-hidden="true" /><div><strong>What this app received</strong><span>A proof of Coinbase account eligibility</span></div></div>
    <div className="proof-payload-facts">
      <span>ZK proof <b>{size === null ? 'Received' : `${size.toLocaleString('en-US')} bytes`}</b></span>
      <span>Public inputs <b>{proof.publicInputs?.length ?? 0} values</b></span>
    </div>
    {proof.proof && <code className="proof-bytes-preview" aria-label="Received proof bytes, abbreviated">{proof.proof.length > 50 ? `${proof.proof.slice(0, 26)} … ${proof.proof.slice(-16)}` : proof.proof}</code>}
    <div className="proof-not-shared"><span>Not included in this proof</span><p>The original KYC account address</p></div>
    <details className="proof-public-details"><summary>What remains public?</summary><p>The challenge, issuer root, scope hash and nullifier are public. These values can be used to check a known wallet address. This proof does not guarantee wallet anonymity.</p><a href="#markets-proof-receipt">Inspect the received proof</a></details>
  </section>;
}
