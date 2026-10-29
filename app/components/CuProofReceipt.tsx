'use client';

import { useEffect, useRef } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle,
  Code,
  Fingerprint,
  LockKey,
  ShieldCheck,
  SpinnerGap,
  X,
} from '@phosphor-icons/react';
import type { CuPhase, CuReceipt, CuVerifications } from '@/lib/useCuProof';
import CuVerification from './CuVerification';
import CuPaymentReceipt from './CuPaymentReceipt';
import type { CuPaymentReceiptData } from '@/lib/cu-checkout';
import type { VerificationMethod } from '@/lib/kproof/verify';

export default function CuProofReceipt({
  receipt,
  phase,
  open,
  onClose,
  verifications,
  onVerify,
  payment,
  total,
  preferredMethod,
}: {
  payment: CuPaymentReceiptData | null;
  total: number;
  preferredMethod: VerificationMethod;
  verifications: CuVerifications;
  onVerify: (method: VerificationMethod) => void;
  receipt: CuReceipt;
  phase: CuPhase;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const verified = phase === 'verified';
  const checking = phase === 'verifying';
  const failed = Object.values(verifications).some((result) => result.state === 'failed');
  const proof = receipt.answer.proof;
  const bytes =
    typeof proof === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(proof) ? (proof.length - 2) / 2 : null;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [open]);
  useEffect(() => {
    if (payment && dialog.current) dialog.current.scrollTop = 0;
  }, [payment?.completedAt]);

  return (
    <dialog
      ref={dialog}
      className="cu-proof-dialog"
      aria-labelledby="cu-receipt-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cu-receipt-inner">
        <header className="cu-receipt-top">
          <span>
            <span className="cu-dot" /> LIVE PROOF RECEIPT ·{' '}
            {new Date(receipt.receivedAt).toLocaleTimeString('ko-KR', {
              timeZone: 'Asia/Seoul',
              hour12: false,
            })}
          </span>
          <button autoFocus onClick={onClose} aria-label="수신 내역 닫기">
            <X size={22} />
          </button>
        </header>
        <div className="cu-receipt-heading">
          <div className="cu-receipt-symbol">
            <Fingerprint size={35} />
          </div>
          <p className="cu-eyebrow">{payment ? 'CHECKOUT COMPLETE' : 'PROOF RECEIVED'}</p>
          <h2 id="cu-receipt-title">
            {payment ? '인증 및 결제 완료' : '성인인증 증명 수신'}
            <br />
            <em>개인정보 원본 미전송</em>
          </h2>
          <p>영지식 증명과 공개 입력으로 구매 조건을 검증합니다.</p>
        </div>
        {payment && <CuPaymentReceipt payment={payment} />}
        <div
          className="cu-receipt-status"
          data-status={verified ? 'verified' : checking ? 'checking' : failed ? 'failed' : 'received'}
          role="status"
        >
          {checking ? (
            <SpinnerGap size={22} className="cu-spin" />
          ) : verified ? (
            <CheckCircle size={23} weight="fill" />
          ) : (
            <ShieldCheck size={23} />
          )}
          <div>
            <strong>
              {checking
                ? verifications.onchain.state === 'checking'
                  ? '성인인증 및 결제 처리 중'
                  : '오프체인 증명 검증 중'
                : verified
                ? '검증 완료 · 19세 이상 조건 충족'
                : failed
                ? '검증 실패 · 인증 조건 불일치 또는 연결 오류'
                : '증명 수신 완료 · 처리 방식 선택'}
            </strong>
            <span>
              {checking
                ? verifications.onchain.state === 'checking'
                  ? '온체인 증명 검증과 dKRW 결제를 처리합니다.'
                  : '수신한 증명이 이번 요청의 조건과 일치하는지 확인합니다.'
                : verified
                ? '개인 신상정보 수신 없이 구매 조건을 확인했습니다.'
                : '온체인은 인증과 결제를, 오프체인은 성인인증을 수행합니다.'}
            </span>
          </div>
        </div>
        <CuVerification
          results={verifications}
          onVerify={onVerify}
          paid={!!payment}
          total={total}
          preferredMethod={preferredMethod}
        />
        <div className="cu-receipt-columns">
          <section className="cu-received-data">
            <h3>
              <Code size={18} />
              전달된 데이터
            </h3>
            <div className="cu-proof-byte">
              <span>ZERO-KNOWLEDGE PROOF</span>
              <b>{bytes === null ? '형식 확인 필요' : `${bytes.toLocaleString('ko-KR')} bytes`}</b>
              <code>{proof || 'proof 없음'}</code>
            </div>
            <dl>
              <div>
                <dt>proof</dt>
                <dd>영지식 증명</dd>
              </div>
              <div>
                <dt>publicInputs</dt>
                <dd>검증용 공개 입력 {receipt.answer.publicInputs?.length ?? 0}개</dd>
              </div>
              <div>
                <dt>요청 메타데이터</dt>
                <dd>요청 ID · 회로 · 상태</dd>
              </div>
            </dl>
            <p>공개 입력에는 요청 범위 해시, nullifier, 나이 기준, 기준 연도가 포함됩니다.</p>
          </section>
          <section className="cu-private-data">
            <h3>
              <LockKey size={18} />
              전달하지 않는 개인정보
            </h3>
            <ul>
              {['이름', '생년월일', '주소', '신분증 사진'].map((field) => (
                <li key={field}>
                  <span>{field}</span>
                  <b>
                    <LockKey size={13} />
                    미전송
                  </b>
                </li>
              ))}
            </ul>
            <div className="cu-receipt-value">
              <Check size={18} />
              <p>
                <strong>구매 자격만 검증합니다.</strong>
                <br />
                개인정보 원본의 수집과 보관을 최소화합니다.
              </p>
            </div>
          </section>
        </div>
        <details className="cu-payload">
          <summary>
            <Code size={16} />
            수신한 증명 응답 JSON 보기
          </summary>
          <pre data-testid="cu-received-json">{JSON.stringify(receipt.answer, null, 2)}</pre>
        </details>

        <button className="cu-primary" onClick={onClose}>
          {payment ? '결제 내역 확인' : '주문 화면으로'}
          <ArrowRight size={19} />
        </button>
      </div>
    </dialog>
  );
}
