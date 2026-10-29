'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { translateCu, type CuLanguage } from './cu-i18n';
import { toDataURL } from 'qrcode';
import { NETWORKS } from './kproof/circuits';
import { buildInputs } from './kproof/requests';
import { RelayClient, type RequestStatus } from './kproof/relay';
import { verifyAnswer, type VerificationMethod, type VerifyOutcome } from './kproof/verify';

export type CuPhase =
  | 'idle'
  | 'requesting'
  | 'waiting'
  | 'generating'
  | 'received'
  | 'verifying'
  | 'verified'
  | 'cancelled'
  | 'expired'
  | 'error';
export interface CuReceipt {
  answer: RequestStatus;
  receivedAt: number;
}
export type CuVerification = {
  state: 'idle' | 'checking' | 'passed' | 'failed';
  outcome?: VerifyOutcome;
  ms?: number;
  error?: string;
};
export type CuVerifications = Record<VerificationMethod, CuVerification>;
const emptyChecks = (): CuVerifications => ({ onchain: { state: 'idle' }, offchain: { state: 'idle' } });
export const CU_WAIT_MS = 5 * 60_000;
export const CU_VERIFY_MS = 90_000;
// Temporary presentation delay while the mobile app finishes its proof progress UI.
export const CU_RECEIPT_DELAY_MS = 2_000;
export const CU_SCOPE_PREFIX = 'kproof-demo:cu:checkout:';

/** Each checkout gets a fresh scope; either verifier must check that same request. */
export function useCuProof() {
  const [phase, setPhase] = useState<CuPhase>('idle');
  const [qr, setQr] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [error, setError] = useState('');
  const [received, setReceived] = useState<CuReceipt | null>(null);
  // Presentation-only checkout completion. No wallet, token transfer or settlement API.
  const [checkoutCompletedAt, setCheckoutCompletedAt] = useState<number | null>(null);
  const [verifications, setVerifications] = useState<CuVerifications>(emptyChecks);
  const checksRef = useRef<CuVerifications>(emptyChecks());
  const context = useRef<{ inputs: Record<string, unknown>; answer: RequestStatus } | null>(null);
  const [remaining, setRemaining] = useState(300);
  const run = useRef(0);
  const busy = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  const writeChecks = (checks: CuVerifications) => {
    checksRef.current = checks;
    setVerifications(checks);
  };

  const reset = useCallback(() => {
    run.current++;
    cleanup.current();
    busy.current = false;
    context.current = null;
    setPhase('idle');
    setQr('');
    setDeepLink('');
    setError('');
    setReceived(null);
    setCheckoutCompletedAt(null);
    writeChecks(emptyChecks());
  }, []);
  useEffect(
    () => () => {
      run.current++;
      cleanup.current();
    },
    []
  );

  const verify = useCallback(async (method: VerificationMethod) => {
    const saved = context.current;
    if (!saved || busy.current || !['onchain', 'offchain'].includes(method)) return;
    if (method === 'onchain' && checksRef.current.onchain.state === 'passed') return;
    cleanup.current();
    const generation = ++run.current;
    busy.current = true;
    setPhase('verifying');
    setError('');
    writeChecks({ ...checksRef.current, [method]: { state: 'checking' } });
    const controller = new AbortController();
    const started = Date.now();
    const finish = (check: CuVerification) => {
      if (run.current !== generation) return;
      run.current++;
      cleanup.current();
      busy.current = false;
      const next = { ...checksRef.current, [method]: check };
      writeChecks(next);
      if (method === 'onchain' && check.state === 'passed')
        setCheckoutCompletedAt((previous) => previous ?? Date.now());
      setPhase(Object.values(next).some((value) => value.state === 'passed') ? 'verified' : 'received');
    };
    const timeout = setTimeout(
      () => finish({ state: 'failed', error: '검증 시간이 초과되었습니다. 다시 시도하십시오.' }),
      CU_VERIFY_MS
    );
    cleanup.current = () => {
      clearTimeout(timeout);
      controller.abort();
    };
    const fetchImpl: typeof fetch = (url, init) =>
      fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
      });
    try {
      const result = await verifyAnswer({ circuitId: 'mdl_kr_age', inputs: saved.inputs }, saved.answer, {
        environment: 'staging',
        method,
        fetchImpl,
      });
      finish({
        state: result.valid ? 'passed' : 'failed',
        outcome: result,
        ms: Date.now() - started,
        ...(!result.valid && {
          error: '증명 또는 요청 조건을 검증하지 못했습니다. 검증 내역을 확인하십시오.',
        }),
      });
    } catch {
      finish({ state: 'failed', error: '검증기를 실행하지 못했습니다. 연결을 확인하고 다시 시도하십시오.' });
    }
  }, []);

  const request = useCallback(async (method: VerificationMethod = 'onchain', language: CuLanguage = 'ko') => {
    if (busy.current) return;
    cleanup.current();
    const generation = ++run.current;
    busy.current = true;
    context.current = null;
    setPhase('requesting');
    setError('');
    setQr('');
    setDeepLink('');
    setReceived(null);
    setCheckoutCompletedAt(null);
    setRemaining(300);
    writeChecks(emptyChecks());
    const controller = new AbortController();
    let stop: (() => void) | undefined;
    let clock: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let receiptTimer: ReturnType<typeof setTimeout> | undefined;
    let receiptPending = false;
    cleanup.current = () => {
      stop?.();
      clearInterval(clock);
      clearTimeout(timeout);
      clearTimeout(receiptTimer);
      controller.abort();
    };
    const current = () => generation === run.current;
    const finish = (next: CuPhase, message = '') => {
      if (!current()) return;
      run.current++;
      cleanup.current();
      busy.current = false;
      setPhase(next);
      setError(message);
    };
    const relay = new RelayClient({
      apiUrl: NETWORKS.staging.relayUrl,
      fetchImpl: (url, init) => fetch(url, { ...init, signal: controller.signal }),
    });
    timeout = setTimeout(() => finish('expired'), CU_WAIT_MS);
    try {
      const inputs = buildInputs('mdl_kr_age', {
        scope: CU_SCOPE_PREFIX + crypto.randomUUID(),
        ageThreshold: 19,
      });
      const created = await relay.createRequest(
        'mdl_kr_age',
        inputs,
        translateCu(language, method === 'onchain' ? 'CU 성인인증 및 dKRW 결제' : 'CU 성인인증')
      );
      if (!current()) return;
      const link = new URL(created.deepLink);
      if (link.protocol !== 'kproof:' || link.hostname !== 'proof-request')
        throw new Error('Invalid KProof link');
      const code = await toDataURL(created.deepLink, {
        width: 320,
        margin: 4,
        errorCorrectionLevel: 'L',
        color: { dark: '#291b39', light: '#ffffff' },
      });
      if (!current()) return;
      setQr(code);
      setDeepLink(created.deepLink);
      setPhase('waiting');
      const expires = Date.now() + CU_WAIT_MS;
      clearTimeout(timeout);
      timeout = setTimeout(() => finish('expired'), CU_WAIT_MS);
      clock = setInterval(() => {
        if (current()) setRemaining(Math.max(0, Math.ceil((expires - Date.now()) / 1000)));
      }, 1000);
      stop = relay.watch(
        created.requestId,
        (status) => {
          if (!current() || receiptPending) return;
          if (status.status === 'pending') return;
          if (status.status === 'generating') {
            setPhase('generating');
            return;
          }
          if (status.status === 'cancelled' || status.status === 'expired') {
            finish(status.status);
            return;
          }
          if (status.status === 'error') {
            finish(
              'error',
              '앱에서 증명을 완료하지 못했습니다. KProof 앱의 안내를 확인하고 다시 시도하십시오.'
            );
            return;
          }
          if (status.status !== 'completed') return;
          const answer = { ...status, publicInputs: status.publicInputs?.slice() };
          const receivedAt = Date.now();
          receiptPending = true;
          cleanup.current();
          setPhase('generating');
          receiptTimer = setTimeout(() => {
            if (!current()) return;
            context.current = { inputs, answer };
            setReceived({ answer, receivedAt });
            finish('received');
          }, CU_RECEIPT_DELAY_MS);
        },
        () => {
          if (!receiptPending) finish('error', '인증 요청 상태를 확인하지 못했습니다. 다시 시도하십시오.');
        }
      );
    } catch {
      finish('error', 'KProof 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도하십시오.');
    }
  }, []);

  return {
    phase,
    qr,
    deepLink,
    error,
    received,
    remaining,
    verifications,
    checkoutCompletedAt,
    verify,
    request,
    reset,
  };
}
