import { ArrowRight, DeviceMobile, Fingerprint, LockKey, ShieldCheck } from '@phosphor-icons/react';

export function CuProduct() {
  return (
    <section className="cu-product-stage" aria-label="카스 프레시 상품">
      <div className="cu-stage-copy">
        <span className="cu-stage-eyebrow">NICE TO CU. NICE TO PRIVACY.</span>
        <h1>
          인증은 간결하게.
          <br />
          <em>결제는 한 번에.</em>
        </h1>
        <p>
          개인정보 공개 없이 성인인증.
          <br />
          dKRW로 이어지는 결제.
        </p>
      </div>
      <div className="cu-stage-orbit" aria-hidden="true" />
      <span className="cu-stage-word" aria-hidden="true">
        fresh.
      </span>
      <img
        className="cu-cass-product"
        src="/demo-assets/cu/cass-fresh.png"
        alt="카스 프레시 맥주 제품 사진"
        width={920}
        height={1270}
        fetchPriority="high"
      />
      <span className="cu-age-seal">
        <b>19+</b>성인인증 상품
      </span>
      <div className="cu-product-caption">
        <div>
          <span>FRESH SELECTION</span>
          <h2>카스 프레시</h2>
          <p>Cass Fresh · 병맥주 500 mL</p>
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
  return (
    <section className="cu-privacy-story" aria-labelledby="cu-value-title">
      <div className="cu-value-heading">
        <span className="cu-eyebrow">LESS DATA. MORE PRIVACY.</span>
        <h2 id="cu-value-title">
          구매 조건만 검증.
          <br />
          <em>개인정보는 기기에 보관.</em>
        </h2>
        <p>
          매장은 성인 여부를 확인하고,
          <br />
          이름·생년월일·신분증 원본은 수신하지 않습니다.
        </p>
      </div>
      <div className="cu-value-flow">
        <div className="cu-phone-side">
          <DeviceMobile size={25} />
          <strong>사용자 기기</strong>
          <span>이름 · 생년월일 · 주소</span>
          <b>
            <LockKey size={12} />
            개인정보 원본 보관
          </b>
        </div>
        <div className="cu-proof-bridge">
          <div>
            <span />
            <Fingerprint size={27} />
            <ArrowRight size={16} />
          </div>
          <strong>영지식 증명</strong>
          <small>+ 검증용 공개 입력</small>
        </div>
        <div className="cu-store-side">
          <img src="/brand/cu-symbol.svg" alt="CU" width={55} height={34} />
          <strong>19세 이상 조건 검증</strong>
          <span>인증 및 결제 처리</span>
          <b>
            <ShieldCheck size={13} />
            원본 개인정보 미수신
          </b>
        </div>
      </div>
    </section>
  );
}
