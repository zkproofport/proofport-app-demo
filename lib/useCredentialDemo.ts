'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProofRequestContext, ProofResponse, ProofportSDK } from '@zkproofport-app/sdk';
import { createSDK, createVerifierSDK } from './sdk';
import type { DemoDefinition } from './demo-catalog';
import { buildDemoInputs, prepareDemoProof, verificationConditions, type DemoOptions, type VerificationConditions } from './demo-policy';
import { cardScope } from './demo-scopes';
import { DEMO_PROOF_WAIT_MS, NO_RELAY_ANSWER_MESSAGE, isWaitTimeout, settleRelayResult } from './relay-outcome';

/**
 * `declined` and `expired` are endings, not errors: the person said no in the
 * app, or nobody answered in time. Both return to the form with a neutral note.
 */
export type DemoPhase = 'idle' | 'requesting' | 'waiting' | 'received' | 'verifying' | 'verified' | 'error' | 'declined' | 'expired';
export type VerificationMethod = 'onchain' | 'offchain';

async function deadline<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

/** Keyed by outcome kind; settleRelayResult has already refused any status it does not name. */
const ENDING_PHASE: Record<'cancelled' | 'expired', DemoPhase> = { cancelled: 'declined', expired: 'expired' };

export function useCredentialDemo(demo: DemoDefinition) {
  const [phase, setPhase] = useState<DemoPhase>('idle');
  const [qrCode, setQrCode] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [notice, setNotice] = useState('');
  const [proof, setProof] = useState<ProofResponse | null>(null);
  const [method, setMethod] = useState<VerificationMethod>('onchain');
  const attempt = useRef(0);
  const busy = useRef(false);
  const sdkRef = useRef<ProofportSDK | null>(null);
  // The relay request the current proof answers. Every verify passes it, so an
  // OIDC proof's request-bound nonce, and a wallet proof's signal hash, OPRF
  // domain and scope, are checked against it on both paths -- both use a fresh
  // SDK (createVerifierSDK) that never saw the request.
  const requestRef = useRef<ProofRequestContext | null>(null);
  // What the request asked for (country list, score threshold), as it was when
  // the request was made: a fresh verifier SDK has to be told.
  const conditionsRef = useRef<VerificationConditions>({});

  useEffect(() => () => { attempt.current++; sdkRef.current?.disconnect(); }, []);

  function reset() {
    attempt.current++;
    sdkRef.current?.disconnect(); sdkRef.current = null; requestRef.current = null; conditionsRef.current = {};
    busy.current = false;
    setPhase('idle'); setError(''); setErrorCode(''); setNotice(''); setProof(null); setQrCode(''); setDeepLink('');
  }

  async function request(options: DemoOptions) {
    if (busy.current) return;
    busy.current = true;
    const current = ++attempt.current;
    setPhase('requesting'); setError(''); setErrorCode(''); setNotice(''); setProof(null); setQrCode(''); setDeepLink('');
    let sdk: ProofportSDK | undefined;
    try {
      const scope = cardScope(demo.id);
      const snapshot = { ...options };
      const inputs = buildDemoInputs(demo, snapshot, scope);
      sdkRef.current?.disconnect();
      sdk = createSDK(); sdkRef.current = sdk;
      const pending = await deadline(sdk.createRelayRequest(demo.circuit, inputs, {
        dappName: demo.brand,
        dappIcon: 'https://demo.zkproofport.app/icon.png',
        message: demo.actionDescription,
        // The SDK handles returning to the existing browser tab. No URL scheme override.
      }), 30000, 'The relay did not respond. Please try again.');
      if (current !== attempt.current) return;
      if (!pending.requestId || !pending.deepLink) throw new Error('The relay returned an incomplete request.');
      const oprfDomain = 'oprfDomain' in inputs ? inputs.oprfDomain : undefined;
      requestRef.current = oprfDomain === undefined ? { scope, requestId: pending.requestId } : { scope, requestId: pending.requestId, oprfDomain };
      conditionsRef.current = verificationConditions(demo, snapshot, scope);
      const qr = await sdk.generateQRCode(pending.deepLink, { width: 240 });
      if (current !== attempt.current) return;
      setDeepLink(pending.deepLink); setQrCode(qr); setPhase('waiting');
      const result = await sdk.waitForProof(pending.requestId, { timeoutMs: DEMO_PROOF_WAIT_MS });
      if (current !== attempt.current) return;
      const outcome = settleRelayResult(result);
      if (outcome.kind === 'proof') {
        setProof(prepareDemoProof(outcome.result, { demo, requestId: pending.requestId, scope, options: snapshot }));
        setPhase('received');
      } else if (outcome.kind === 'error') {
        setError(outcome.message); setErrorCode(outcome.errorCode ?? ''); setPhase('error');
      } else {
        setNotice(outcome.message); setPhase(ENDING_PHASE[outcome.kind]);
      }
    } catch (cause) {
      if (current !== attempt.current) return;
      if (isWaitTimeout(cause)) { setNotice(NO_RELAY_ANSWER_MESSAGE); setPhase('expired'); return; }
      setError(cause instanceof Error ? cause.message : 'The proof request failed. Please try again.'); setPhase('error');
    } finally {
      sdk?.disconnect();
      if (current === attempt.current) busy.current = false;
    }
  }

  async function verify(selectedMethod: VerificationMethod) {
    if (!proof || busy.current) return;
    busy.current = true;
    const current = attempt.current;
    setPhase('verifying'); setError(''); setMethod(selectedMethod);
    try {
      const request = requestRef.current;
      const conditions = conditionsRef.current;
      // The SDK refuses a request whose id is not the response's.
      if (!request) throw new Error('This proof does not answer a request this page made. Request a new proof.');
      // Both paths: an SDK on the proof's chain (createVerifierSDK) -- core's
      // pinned verifier on chain, and the OPRF key pinned for that chain.
      const verification = selectedMethod === 'onchain'
        ? createVerifierSDK(proof).verifyResponseOnChain(proof, undefined, { request, ...conditions })
        : createVerifierSDK(proof).verifyResponseOffChain(proof, { request, ...conditions });
      const result = await deadline(verification, selectedMethod === 'onchain' ? 30000 : 90000, 'Verification timed out. Retry with the same proof.');
      if (current !== attempt.current) return;
      if (!result.valid) throw new Error(result.error || 'The proof did not pass verification.');
      setPhase('verified');
    } catch (cause) {
      if (current !== attempt.current) return;
      setError(cause instanceof Error ? cause.message : 'Verification could not finish. Please try again.'); setPhase('received');
    } finally { if (current === attempt.current) busy.current = false; }
  }

  return { phase, qrCode, deepLink, error, errorCode, notice, proof, method, request, verify, reset };
}
