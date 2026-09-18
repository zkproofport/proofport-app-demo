/** Gotgan's original architectural G: an enclosed chamber with a controlled entry. */
export function GotganMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <path d="M54 10H10V54H54V30H32V40H44V44H20V20H54V10Z" fill="currentColor" />
    <path d="M54 20H44V30H54V20Z" fill="var(--gotgan-brass, #b99a61)" />
  </svg>;
}

export default function GotganLogo({ compact = false }: { compact?: boolean }) {
  return <span className={`gotgan-logo${compact ? ' gotgan-logo-compact' : ''}`}>
    <GotganMark className="gotgan-symbol" />
    <span className="gotgan-logotype">Gotgan</span>
  </span>;
}
