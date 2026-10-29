'use client';

import { useCuLanguage } from './CuLanguage';

import { CheckCircle, Coins } from '@phosphor-icons/react';

import { CU_CURRENCY, type CuPaymentReceiptData } from '@/lib/cu-checkout';

export default function CuPaymentReceipt({ payment }: { payment: CuPaymentReceiptData }) {
  const { t, locale } = useCuLanguage();
  return (
    <section className="cu-payment-receipt" aria-label={t('결제 영수증')}>
      <header>
        <span>
          <Coins size={18} />
          dKRW PAYMENT
        </span>
        <b>
          <CheckCircle size={15} weight="fill" />
          {t('결제 완료')}
        </b>
      </header>
      <div className="cu-payment-amount">
        <span>{t('결제 금액')}</span>
        <strong>
          {payment.total.toLocaleString(locale)} <small>{CU_CURRENCY}</small>
        </strong>
      </div>
      <dl>
        <div>
          <dt>{t('구매 상품')}</dt>
          <dd>
            {t('버드와이저')} × {payment.quantity}
          </dd>
        </div>
        <div>
          <dt>{t('결제 수단')}</dt>
          <dd>{CU_CURRENCY}</dd>
        </div>
        <div>
          <dt>{t('성인인증')}</dt>
          <dd>{t('온체인 검증 완료 · 19세 이상')}</dd>
        </div>
        <div>
          <dt>{t('처리 시각')}</dt>
          <dd>
            {new Date(payment.completedAt).toLocaleString(locale, { timeZone: 'Asia/Seoul', hour12: false })}
          </dd>
        </div>
        <div>
          <dt>{t('요청 번호')}</dt>
          <dd className="cu-order-reference">{payment.requestId}</dd>
        </div>
      </dl>
    </section>
  );
}
