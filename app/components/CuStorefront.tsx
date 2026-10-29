import { useCuLanguage } from './CuLanguage';
import { ArrowRight, DeviceMobile, Fingerprint, LockKey, ShieldCheck } from '@phosphor-icons/react';

export function CuProduct() {
  const { t } = useCuLanguage();
  return (
    <section className="cu-product-stage" aria-label={t('버드와이저 상품')}>
      <div className="cu-stage-copy">
        <span className="cu-stage-eyebrow">NICE TO CU. NICE TO PRIVACY.</span>
        <h1>
          {t('인증은 간결하게.')}
          <br />
          <em>{t('결제는 한 번에.')}</em>
        </h1>
        <p>
          {t('개인정보 공개 없이 성인인증.')}
          <br />
          {t('dKRW로 이어지는 결제.')}
        </p>
      </div>
      <div className="cu-stage-orbit" aria-hidden="true" />
      <span className="cu-stage-word" aria-hidden="true">
        fresh.
      </span>
      <img
        className="cu-beer-product"
        src="/demo-assets/cu/budweiser.png"
        alt={t('버드와이저 맥주 제품 사진')}
        width={322}
        height={362}
        fetchPriority="high"
      />
      <span className="cu-age-seal">
        <b>19+</b>
        {t('성인인증 상품')}
      </span>
      <div className="cu-product-caption">
        <div>
          <span>FRESH SELECTION</span>
          <h2>{t('버드와이저')}</h2>
          <p>{t('Budweiser · 병맥주')}</p>
        </div>
        <span className="cu-cold-label">
          COLD
          <br />
          <b>& FRESH</b>
        </span>
      </div>
    </section>
  );
}

export function CuPrivacySummary() {
  const { t } = useCuLanguage();
  return (
    <section className="cu-privacy-story" aria-labelledby="cu-value-title">
      <div className="cu-value-heading">
        <span className="cu-eyebrow">LESS DATA. MORE PRIVACY.</span>
        <h2 id="cu-value-title">
          {t('구매 조건만 검증.')}
          <br />
          <em>{t('개인정보는 기기에 보관.')}</em>
        </h2>
        <p>
          {t('매장은 성인 여부를 확인하고,')}
          <br />
          {t('이름·생년월일·신분증 원본은 수신하지 않습니다.')}
        </p>
      </div>
      <div className="cu-value-flow">
        <div className="cu-phone-side">
          <DeviceMobile size={25} />
          <strong>{t('사용자 기기')}</strong>
          <span>{t('이름 · 생년월일 · 주소')}</span>
          <b>
            <LockKey size={12} />
            {t('개인정보 원본 보관')}
          </b>
        </div>
        <div className="cu-proof-bridge">
          <div>
            <span />
            <Fingerprint size={27} />
            <ArrowRight size={16} />
          </div>
          <strong>{t('영지식 증명')}</strong>
          <small>{t('+ 검증용 공개 입력')}</small>
        </div>
        <div className="cu-store-side">
          <img src="/brand/cu-symbol.svg" alt="CU" width={55} height={34} />
          <strong>{t('19세 이상 조건 검증')}</strong>
          <span>{t('인증 및 결제 처리')}</span>
          <b>
            <ShieldCheck size={13} />
            {t('원본 개인정보 미수신')}
          </b>
        </div>
      </div>
    </section>
  );
}
