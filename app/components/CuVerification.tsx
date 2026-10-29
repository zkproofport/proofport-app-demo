'use client';

import { useCuLanguage } from './CuLanguage';

import { ArrowUpRight, CheckCircle, Cpu, Cube, SpinnerGap } from '@phosphor-icons/react';
import type { CuVerifications } from '@/lib/useCuProof';
import type { VerificationMethod } from '@/lib/kproof/verify';
import { formatCuAmount } from '@/lib/cu-checkout';
import { NETWORKS } from '@/lib/kproof/circuits';

const CHECK_NAMES: Record<string, string> = {
  status: '앱 응답',
  circuit: '성인인증 회로',
  public_input_count: '공개 입력 개수',
  public_input_format: '증명 형식',
  scope: '이번 구매 요청',
  age_threshold: '19세 조건',
  current_year: '기준 연도',
  region: '지역 조건',
  on_chain: '온체인 증명 검증',
  off_chain: '오프체인 증명 검증',
};

export default function CuVerification({
  results,
  onVerify,
  paid,
  total,
  preferredMethod,
}: {
  results: CuVerifications;
  onVerify: (method: VerificationMethod) => void;
  paid: boolean;
  total: number;
  preferredMethod: VerificationMethod;
}) {
  const { t } = useCuLanguage();
  const busy = Object.values(results).some((result) => result.state === 'checking');
  return (
    <section className="cu-verification-options" aria-label={t('증명 검증 방식 선택')}>
      <div className="cu-verification-heading">
        <h3>{t('인증 및 결제 처리')}</h3>
        <p>{t('동일한 증명을 온체인 또는 오프체인에서 검증할 수 있습니다.')}</p>
      </div>
      <div className="cu-verification-grid">
        {(['onchain', 'offchain'] as const).map((method) => {
          const result = results[method];
          const chain = method === 'onchain';
          return (
            <article
              key={method}
              className="cu-verifier-card"
              data-state={result.state}
              data-selected={preferredMethod === method}
            >
              <header>
                {chain ? <Cube size={21} /> : <Cpu size={21} />}
                <h4>{chain ? t('온체인 인증 및 결제') : t('오프체인 검증')}</h4>
                <span>{chain ? 'VERIFY & PAY' : 'VERIFY ONLY'}</span>
              </header>
              <p>
                {chain
                  ? t('성인 조건을 온체인에서 검증하고 dKRW로 결제합니다.')
                  : t('이 브라우저에서 성인 조건만 검증합니다. 결제는 진행하지 않습니다.')}
              </p>
              <small>
                {chain
                  ? t('결제 금액 {amount}', { amount: formatCuAmount(total) })
                  : t('개인정보 원본 미전송 · 로컬 검증')}
              </small>
              <button onClick={() => onVerify(method)} disabled={busy || (chain && paid)}>
                {chain && paid ? (
                  <>
                    <CheckCircle size={17} weight="fill" />
                    {t('인증 및 결제 완료')}
                  </>
                ) : result.state === 'checking' ? (
                  <>
                    <SpinnerGap className="cu-spin" size={16} />
                    {chain ? t('검증 및 결제 처리 중') : t('검증 중')}
                  </>
                ) : chain ? (
                  result.state === 'failed' ? (
                    t('온체인 검증 및 결제 재시도')
                  ) : (
                    t('온체인 검증 및 결제 실행')
                  )
                ) : result.state === 'passed' ? (
                  <>
                    <CheckCircle size={17} weight="fill" />
                    {t('오프체인 다시 검증하기')}
                  </>
                ) : (
                  t(result.state === 'failed' ? '오프체인 다시 검증하기' : '오프체인 검증하기')
                )}
              </button>
              {result.ms !== undefined && (
                <span className="cu-verifier-time">
                  {(result.ms / 1000).toFixed(2)}
                  {t('초 ·')} {result.state === 'passed' ? t('요청 조건과 증명 일치') : t('검증 실패')}
                </span>
              )}
              {result.error && (
                <p className="cu-verifier-error" role="alert">
                  {t(result.error)}
                </p>
              )}
              {chain && (
                <a
                  href={`https://sepolia.basescan.org/address/${NETWORKS.staging.verifiers.mdl_kr_age}#code`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('검증 컨트랙트 보기')}
                  <ArrowUpRight size={12} />
                </a>
              )}
              {result.outcome && (
                <details className="cu-verifier-checks">
                  <summary>{t('상세 검증 결과')}</summary>
                  <ul>
                    {result.outcome.checks.map((check) => (
                      <li key={check.name}>
                        <span>{t(CHECK_NAMES[check.name] ?? check.name)}</span>
                        <b data-ok={check.ok}>{check.ok ? t('통과') : t('실패')}</b>
                        {!check.ok && <small>{check.detail}</small>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
