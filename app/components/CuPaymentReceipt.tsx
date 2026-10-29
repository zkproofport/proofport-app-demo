'use client';

import { CheckCircle, Coins } from '@phosphor-icons/react';

import { CU_CURRENCY, type CuPaymentReceiptData } from '@/lib/cu-checkout';

export default function CuPaymentReceipt({ payment }: { payment: CuPaymentReceiptData }) {
  return (
    <section className="cu-payment-receipt" aria-label="결제 영수증">
      <header>
        <span>
          <Coins size={18} />
          dKRW PAYMENT
        </span>
        <b>
          <CheckCircle size={15} weight="fill" />
          결제 완료
        </b>
      </header>
      <div className="cu-payment-amount">
        <span>결제 금액</span>
        <strong>
          {payment.total.toLocaleString('ko-KR')} <small>{CU_CURRENCY}</small>
        </strong>
      </div>
      <dl>
        <div>
          <dt>구매 상품</dt>
          <dd>카스 프레시 500 mL × {payment.quantity}</dd>
        </div>
        <div>
          <dt>결제 수단</dt>
          <dd>{CU_CURRENCY}</dd>
        </div>
        <div>
          <dt>성인인증</dt>
          <dd>온체인 검증 완료 · 19세 이상</dd>
        </div>
        <div>
          <dt>처리 시각</dt>
          <dd>
            {new Date(payment.completedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}
          </dd>
        </div>
        <div>
          <dt>요청 번호</dt>
          <dd className="cu-order-reference">{payment.requestId}</dd>
        </div>
      </dl>
    </section>
  );
}
