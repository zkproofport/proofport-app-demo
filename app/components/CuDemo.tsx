'use client';

import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowCounterClockwise,
  Check,
  CheckCircle,
  Coins,
  Cpu,
  Cube,
  DeviceMobile,
  Fingerprint,
  LockKey,
  Minus,
  Plus,
  QrCode,
  ShieldCheck,
  SpinnerGap,
} from '@phosphor-icons/react';
import { useCuProof } from '@/lib/useCuProof';
import type { VerificationMethod } from '@/lib/kproof/verify';
import CuProofReceipt from './CuProofReceipt';
import CuPaymentReceipt from './CuPaymentReceipt';
import { CU_UNIT_PRICE, CU_MAX_QUANTITY, formatCuAmount } from '@/lib/cu-checkout';
import { CuProduct, CuPrivacySummary } from './CuStorefront';
import './cu.css';

export default function CuDemo({ isActive = true }: { isActive?: boolean }) {
  const flow = useCuProof();
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<VerificationMethod>('onchain');
  const [dismissedReceipt, setDismissedReceipt] = useState<string | null>(null);
  const busy = ['requesting', 'waiting', 'generating', 'verifying'].includes(flow.phase);
  const verified = flow.phase === 'verified';
  const ended = ['error', 'expired', 'cancelled'].includes(flow.phase);
  const reset = () => {
    flow.reset();
    setDismissedReceipt(null);
  };
  const request = () => {
    setDismissedReceipt(null);
    void flow.request(method);
  };
  const verify = (selected: VerificationMethod) => {
    setMethod(selected);
    void flow.verify(selected);
  };
  const total = quantity * CU_UNIT_PRICE;
  const payment =
    flow.checkoutCompletedAt !== null && flow.received
      ? {
          requestId: flow.received.answer.requestId,
          total,
          quantity,
          completedAt: flow.checkoutCompletedAt,
        }
      : null;
  const chain = method === 'onchain';

  return (
    <main id="content-cu" className="cu-demo" lang="ko" tabIndex={-1}>
      <header className="cu-header">
        <div className="cu-brand">
          <img src="/brand/cu-symbol.svg" alt="CU" width={82} height={51} />
          <div>
            <strong>NICE TO CU</strong>
            <span>SMART CHECKOUT</span>
          </div>
        </div>
        <div className="cu-header-right">
          <span>
            <span className="cu-dot" />
            PRIVATE VERIFICATION & PAYMENT
          </span>
          <img src="/brand/kproof-wordmark.svg" alt="KProof" width={88} height={25} />
        </div>
      </header>
      <div className="cu-page">
        <div className="cu-page-label">
          <span>성인인증부터 dKRW 결제까지</span>
          <span>
            PRIVATE CHECKOUT <b>01</b>
          </span>
        </div>
        <div className="cu-checkout-grid">
          <CuProduct />
          <section className="cu-checkout-panel" aria-labelledby="cu-auth-title">
            <div className="cu-order-heading">
              <span>MY CHECKOUT</span>
              <span>
                {String(quantity).padStart(2, '0')} ITEM{quantity > 1 ? 'S' : ''}
              </span>
            </div>
            <div className="cu-order-row">
              <div>
                <h2>
                  카스 프레시 <span>19+</span>
                </h2>
                <p>500 mL · {formatCuAmount(CU_UNIT_PRICE)}</p>
              </div>
              <div className="cu-quantity">
                <button
                  aria-label="맥주 수량 줄이기"
                  disabled={quantity <= 1 || busy || !!flow.received}
                  onClick={() => {
                    reset();
                    setQuantity((q) => q - 1);
                  }}
                >
                  <Minus size={14} />
                </button>
                <output aria-label="맥주 수량">{quantity}</output>
                <button
                  aria-label="맥주 수량 늘리기"
                  disabled={quantity >= CU_MAX_QUANTITY || busy || !!flow.received}
                  onClick={() => {
                    reset();
                    setQuantity((q) => q + 1);
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <div className="cu-order-total">
              <span>구매 금액</span>
              <strong>{formatCuAmount(total)}</strong>
            </div>
            <div className="cu-auth-content" aria-live="polite">
              {flow.phase === 'idle' && (
                <>
                  <div className="cu-auth-label">
                    <ShieldCheck size={17} />
                    VERIFY & PAY
                  </div>
                  <h2 id="cu-auth-title">{chain ? '성인인증 및 결제' : '오프체인 성인인증'}</h2>
                  <p className="cu-auth-description">
                    {chain ? (
                      <>
                        19세 이상 조건을 증명하고
                        <br />
                        <strong>dKRW로 결제합니다.</strong>
                      </>
                    ) : (
                      <>
                        개인정보 원본을 전송하지 않고
                        <br />
                        <strong>브라우저에서 성인 조건을 검증합니다.</strong>
                      </>
                    )}
                  </p>
                  <div className="cu-checkout-methods" role="group" aria-label="인증 및 결제 방식">
                    <button aria-pressed={chain} onClick={() => setMethod('onchain')}>
                      <Cube size={18} />
                      <span>
                        <strong>온체인</strong>
                        <small>성인인증 + 결제</small>
                      </span>
                      <CheckCircle size={16} />
                    </button>
                    <button aria-pressed={!chain} onClick={() => setMethod('offchain')}>
                      <Cpu size={18} />
                      <span>
                        <strong>오프체인</strong>
                        <small>성인인증</small>
                      </span>
                      <CheckCircle size={16} />
                    </button>
                  </div>
                  <div className="cu-minimal-disclosure">
                    <div>
                      <LockKey size={18} />
                      <span>이름 · 생년월일 · 주소</span>
                      <b>미전송</b>
                    </div>
                    <div>
                      <Fingerprint size={18} />
                      <span>영지식 증명 · 공개 입력</span>
                      <b>전송</b>
                    </div>
                  </div>
                  <button className="cu-primary" onClick={request}>
                    {chain ? '성인인증 및 결제 시작' : '성인인증 시작'}
                    <ArrowRight size={20} />
                  </button>
                  <p className="cu-action-hint">
                    <DeviceMobile size={15} />
                    KProof 앱으로 QR 스캔
                  </p>
                </>
              )}
              {busy && !payment && (
                <>
                  <div className="cu-auth-label">
                    <span className="cu-dot" />
                    {flow.phase === 'verifying'
                      ? chain
                        ? 'VERIFYING & PAYING'
                        : 'VERIFYING PROOF'
                      : 'CONNECT TO KPROOF'}
                  </div>
                  <h2 id="cu-auth-title">
                    {flow.phase === 'requesting'
                      ? '요청 생성 중'
                      : flow.phase === 'generating'
                      ? '성인인증 증명 생성 중'
                      : flow.phase === 'verifying'
                      ? chain
                        ? '성인인증 및 결제 처리 중'
                        : '오프체인 검증 중'
                      : chain
                      ? 'QR 스캔으로 인증 및 결제'
                      : 'QR 스캔으로 성인인증'}
                  </h2>
                  <p className="cu-auth-description">
                    {flow.phase === 'verifying'
                      ? chain
                        ? '온체인 증명 검증과 dKRW 결제를 처리합니다.'
                        : '수신한 증명을 이 브라우저에서 검증합니다.'
                      : chain
                      ? 'KProof에서 성인인증을 승인하면 온체인 검증과 dKRW 결제로 이어집니다.'
                      : 'KProof에서 성인인증 요청을 확인하고 승인하십시오.'}
                  </p>
                  {chain && (
                    <div className="cu-payment-summary">
                      <Coins size={19} />
                      <span>dKRW 결제</span>
                      <b>{formatCuAmount(total)}</b>
                    </div>
                  )}
                  {flow.qr && flow.phase === 'waiting' ? (
                    <div className="cu-qr">
                      <img
                        src={flow.qr}
                        alt={chain ? 'KProof 성인인증 및 dKRW 결제 QR 코드' : 'KProof 성인인증 QR 코드'}
                        width={224}
                        height={224}
                      />
                      <span>
                        <QrCode size={14} />
                        KProof 앱 전용
                      </span>
                    </div>
                  ) : (
                    <div className="cu-progress">
                      <SpinnerGap className="cu-spin" size={70} />
                      <Fingerprint size={28} />
                    </div>
                  )}
                  {flow.phase === 'waiting' && (
                    <a className="cu-primary" href={flow.deepLink}>
                      KProof에서 {chain ? '인증 및 결제' : '성인인증'} 진행
                      <ArrowUpRight size={19} />
                    </a>
                  )}
                  <div className="cu-wait-footer">
                    <span>
                      {flow.phase === 'verifying'
                        ? '처리 중'
                        : `유효 시간 ${Math.floor(flow.remaining / 60)}:${String(
                            flow.remaining % 60
                          ).padStart(2, '0')}`}
                    </span>
                    <button onClick={reset}>요청 취소</button>
                  </div>
                </>
              )}
              {flow.phase === 'received' && !payment && (
                <>
                  <div className="cu-auth-label">
                    <Fingerprint size={18} />
                    PROOF RECEIVED
                  </div>
                  <h2 id="cu-auth-title">성인인증 증명 수신 완료</h2>
                  <p className="cu-auth-description">
                    온체인 검증으로 인증과 결제를 완료하거나,
                    <br />
                    오프체인 검증으로 성인 조건을 확인합니다.
                  </p>
                  <button className="cu-primary" onClick={() => setDismissedReceipt(null)}>
                    검증 및 결제 진행
                    <ArrowRight size={19} />
                  </button>
                  <button className="cu-text-button" onClick={reset}>
                    새 인증 요청
                  </button>
                </>
              )}
              {(verified || payment) && (
                <>
                  <div className="cu-complete-mark">
                    <Check size={30} weight="bold" />
                  </div>
                  <h2 id="cu-auth-title">{payment ? '인증 및 결제 완료' : '성인인증 완료'}</h2>
                  <p className="cu-auth-description">
                    {payment
                      ? '성인 조건 확인과 dKRW 결제가 완료되었습니다.'
                      : '오프체인 검증으로 19세 이상 조건을 확인했습니다. 결제는 온체인 검증에서 진행합니다.'}
                  </p>
                  {payment ? (
                    <CuPaymentReceipt payment={payment} />
                  ) : (
                    <div className="cu-verified-answer">
                      <span>오프체인 검증 완료 · 이 브라우저</span>
                      <b>
                        <CheckCircle size={19} weight="fill" />
                        19세 이상 조건 충족
                      </b>
                    </div>
                  )}
                  {flow.verifications.onchain.state === 'passed' &&
                    flow.verifications.offchain.state === 'passed' && (
                      <p className="cu-comparison-result">온체인 + 오프체인 검증 완료</p>
                    )}
                  <button className="cu-receipt-link" onClick={() => setDismissedReceipt(null)}>
                    <Fingerprint size={17} />
                    {payment ? '인증 데이터 및 영수증' : '인증 데이터 보기'}
                    <ArrowUpRight size={16} />
                  </button>
                  <button className="cu-primary" onClick={payment ? reset : () => setDismissedReceipt(null)}>
                    {payment ? '다음 주문' : '온체인 검증 및 결제'}
                    {payment ? <ArrowCounterClockwise size={19} /> : <ArrowRight size={19} />}
                  </button>
                  {!payment && (
                    <button className="cu-text-button" onClick={reset}>
                      새 인증 요청
                    </button>
                  )}
                </>
              )}
              {ended && (
                <>
                  <div className="cu-auth-label">
                    <ShieldCheck size={18} />
                    VERIFICATION
                  </div>
                  <h2 id="cu-auth-title">
                    {flow.phase === 'expired'
                      ? '인증 요청 만료'
                      : flow.phase === 'cancelled'
                      ? '인증 요청 취소'
                      : '인증 처리 실패'}
                  </h2>
                  <p className="cu-auth-description" role={flow.phase === 'error' ? 'alert' : undefined}>
                    {flow.error || '새 QR 코드로 인증을 다시 진행하십시오.'}
                  </p>
                  <button className="cu-primary" onClick={request}>
                    다시 인증하기
                    <ArrowCounterClockwise size={19} />
                  </button>
                  <button className="cu-text-button" onClick={reset}>
                    주문으로 돌아가기
                  </button>
                </>
              )}
            </div>
            <div className="cu-panel-signature">
              <LockKey size={14} />
              <span>개인정보 원본 미전송 · 영지식 증명 기반 인증</span>
            </div>
          </section>
        </div>
        <CuPrivacySummary />
        <footer className="cu-footer">
          <span>NICE TO CU, WITH KProof.</span>
          <span>개인정보 보호를 기본으로, 인증부터 결제까지.</span>
        </footer>
      </div>
      {flow.received && (
        <CuProofReceipt
          verifications={flow.verifications}
          onVerify={verify}
          receipt={flow.received}
          phase={flow.phase}
          payment={payment}
          total={total}
          preferredMethod={method}
          open={isActive && dismissedReceipt !== flow.received.answer.requestId}
          onClose={() => setDismissedReceipt(flow.received!.answer.requestId)}
        />
      )}
    </main>
  );
}
