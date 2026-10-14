/** Ssiat's original mark: a seed in the soil with its first two leaves. Not a third-party logo. */
export function SsiatMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <path d="M32 46V24" stroke="var(--ssiat-leaf, #5f9b4c)" strokeWidth="4" strokeLinecap="round" />
    <path d="M32 32C21 32 14 25 14 15C25 15 32 22 32 32Z" fill="var(--ssiat-leaf, #5f9b4c)" />
    <path d="M32 26C43 26 50 19 50 9C39 9 32 16 32 26Z" fill="var(--ssiat-leaf, #5f9b4c)" />
    <ellipse cx="32" cy="50" rx="13" ry="8" fill="var(--ssiat-seed, #c8923a)" />
  </svg>;
}

export default function SsiatLogo() {
  return <span className="ssiat-logo">
    <SsiatMark className="ssiat-symbol" />
    <span className="ssiat-logotype">Ssiat<small lang="ko">씨앗</small></span>
  </span>;
}
