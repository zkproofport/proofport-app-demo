export default function MadangLogo({ compact = false }: { compact?: boolean }) {
  return <span className={`madang-logo${compact ? ' madang-logo-compact' : ''}`} aria-label="Madang">
    <span className="madang-logo-mark" aria-hidden="true" />
    {!compact && <span className="madang-logo-word" aria-hidden="true">madang<span>.</span></span>}
  </span>;
}
