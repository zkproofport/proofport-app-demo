import { WORDMARK_ASPECT, ZKPROOFPORT_WORDMARK } from '@/lib/brand';

/**
 * The brand-kit wordmark. Both versions are in the page and CSS shows the one
 * for the current background (demos.css, `.zkp-wordmark`), so a theme change
 * needs no re-render. `background` pins one where the backdrop never changes.
 */
export default function ZKProofportWordmark({ width = 160, background }: { width?: number; background?: 'dark' | 'light' }) {
  const height = Math.round(width / WORDMARK_ASPECT);
  if (background !== undefined) {
    const src = background === 'dark' ? ZKPROOFPORT_WORDMARK.onDark : ZKPROOFPORT_WORDMARK.onLight;
    return <img className="zkp-wordmark-fixed" src={src} alt="ZKProofport" width={width} height={height} />;
  }
  return <span className="zkp-wordmark" role="img" aria-label="ZKProofport">
    <img className="zkp-wordmark-on-light" src={ZKPROOFPORT_WORDMARK.onLight} alt="" width={width} height={height} />
    <img className="zkp-wordmark-on-dark" src={ZKPROOFPORT_WORDMARK.onDark} alt="" width={width} height={height} />
  </span>;
}
