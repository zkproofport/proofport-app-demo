/**
 * ZKProofport marks from the brand kit (2026-10-13), served from
 * `public/brand/zkproofport/`. Components take them from here, never by path.
 */
export const ZKPROOFPORT_SYMBOL = '/brand/zkproofport/zkproofport-symbol.png';

/** Wordmark per background: paper suffix on dark, navy suffix on light. */
export const ZKPROOFPORT_WORDMARK = {
  onDark: '/brand/zkproofport/zkproofport-wordmark-dark.svg',
  onLight: '/brand/zkproofport/zkproofport-wordmark-light.svg',
} as const;

/** Width / height of the wordmark artwork (812 × 180). */
export const WORDMARK_ASPECT = 812 / 180;
